#!/usr/bin/env python3
"""Create TEST-MODE Products/Prices from a live GET dump. Stdlib only.

Use after dump_stripe_live_readonly.py succeeds. Run this against the
*destination* Stripe account with a test-mode key (sk_test_ / rk_test_ with
Products + Prices write). Live keys are refused. Default is dry-run.

    python3 replicate_stripe_catalog_to_test.py --from-dump stripe-prod-catalog.json

    export STRIPE_API_KEY='sk_test_…'     # never live; do not put on argv
    python3 replicate_stripe_catalog_to_test.py --from-dump stripe-prod-catalog.json --apply \\
        --output stripe-test-created.json

Does not write recognized_stripe_prices. Source price ids are not copied —
Stripe mints new ids on the destination account.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

STRIPE_API_BASE = "https://api.stripe.com"
HTTP_TIMEOUT_SECONDS = 30
PAGE_SIZE = 100
MAX_PAGES = 50
TEST_FIXTURE_MARKER = "1"
FORBIDDEN_OUTPUT_NAMES = frozenset(
    {
        "plan_catalog.json",
        "plan_catalog_generated.py",
        "stripe_catalog_snapshot.json",
        "recognized_stripe_prices",
    }
)


def redact(text: str, api_key: str = "") -> str:
    out = text
    if api_key:
        out = out.replace(api_key, "[redacted]")
    for marker in ("sk_live_", "rk_live_", "sk_test_", "rk_test_", "pk_live_", "pk_test_"):
        while True:
            idx = out.find(marker)
            if idx < 0:
                break
            end = idx
            while end < len(out) and (out[end].isalnum() or out[end] in "_-"):
                end += 1
            out = out[:idx] + marker + "[redacted]" + out[end:]
    return out


def classify_key_kind(api_key: str) -> str:
    if api_key.startswith("sk_test_"):
        return "sk_test"
    if api_key.startswith("rk_test_"):
        return "rk_test"
    if any(marker in api_key.lower() for marker in ("sk_live_", "rk_live_", "pk_live_", "_live_")):
        return "live"
    if api_key.startswith("pk_test_"):
        return "pk_test"
    return "unknown"


def load_api_key(api_key_file: Optional[str]) -> str:
    if api_key_file:
        with open(api_key_file, encoding="utf-8") as fh:
            raw = fh.read().strip()
        if not raw:
            raise SystemExit(f"--api-key-file {api_key_file} is empty.")
        return raw.splitlines()[0].strip()
    api_key = os.getenv("STRIPE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Set STRIPE_API_KEY or pass --api-key-file. Do not put the key on argv.")
    return api_key


def require_test_mode_key(api_key: str) -> str:
    kind = classify_key_kind(api_key)
    if kind == "live":
        raise SystemExit("Refusing a LIVE Stripe key. Replicate with sk_test_ / rk_test_ (Products+Prices write).")
    if kind not in ("sk_test", "rk_test"):
        raise SystemExit("STRIPE_API_KEY must be sk_test_ or rk_test_ for --apply.")
    return kind


def load_dump(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        dump = json.load(fh)
    if not isinstance(dump, dict):
        raise SystemExit(f"{path} is not a JSON object.")
    rows = dump.get("current_prod_prices")
    if not isinstance(rows, list) or not rows:
        raise SystemExit(f"{path} has no current_prod_prices (expected dump_stripe_live_readonly.py output).")
    return dump


def build_creation_plan(dump: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Group dump rows into one product per plan_id with month/year prices."""
    by_plan: Dict[str, Dict[str, Any]] = {}
    missing_amounts: List[str] = []
    for row in dump["current_prod_prices"]:
        plan_id = row.get("plan_id")
        interval = row.get("interval")
        amount = row.get("unit_amount")
        if not plan_id or not interval:
            raise SystemExit("Dump row missing plan_id or interval.")
        if not isinstance(amount, int) or amount <= 0:
            missing_amounts.append(f"{plan_id}/{interval}")
            continue
        prod = by_plan.setdefault(
            plan_id,
            {
                "plan_id": plan_id,
                "display_name": row.get("display_name") or row.get("product_name") or plan_id,
                "prices": [],
            },
        )
        prod["prices"].append(
            {
                "interval": interval,
                "currency": (row.get("currency") or "usd").lower(),
                "unit_amount": amount,
                "nickname": row.get("nickname") or f"{prod['display_name']} {interval}",
                "env_var": row.get("env_var"),
                "source_price_id": row.get("price_id"),
            }
        )
    if missing_amounts:
        raise SystemExit(
            "Dump is missing unit_amount for: "
            + ", ".join(missing_amounts)
            + ". Re-run dump_stripe_live_readonly.py so amounts are retrieved."
        )
    return list(by_plan.values())


def print_plan(plan: List[Dict[str, Any]]) -> None:
    print("Destination TEST-MODE create plan (dry-run). Source ids will not be copied.")
    print("")
    for prod in plan:
        print(f"Product '[omi-test] {prod['display_name']}'  omi_plan_id={prod['plan_id']}  omi_test_fixture=1")
        for price in prod["prices"]:
            dollars = price["unit_amount"] / 100
            print(
                f"  {price['interval']:<6} {price['currency']} {price['unit_amount']} "
                f"(${dollars:.2f})  env={price.get('env_var') or '—'}  "
                f"from {price['source_price_id']}"
            )
    print("")
    print("Re-run with --apply and a sk_test_ / rk_test_ key to create these on the destination account.")


class StripeTestClient:
    def __init__(self, api_key: str, *, opener: Any = None):
        self.api_key = api_key
        self._opener = opener or urllib.request.urlopen
        self.calls: List[Tuple[str, str]] = []

    def _request(self, method: str, path: str, params: Optional[Sequence[Tuple[str, str]]] = None) -> Dict[str, Any]:
        if method not in ("GET", "POST"):
            raise SystemExit(f"Refusing HTTP {method}.")
        if not path.startswith("/v1/products") and not path.startswith("/v1/prices"):
            raise SystemExit(f"Refusing {method} {path}. Only products and prices.")
        url = f"{STRIPE_API_BASE}{path}"
        data = None
        if method == "GET":
            query = urllib.parse.urlencode(params or [], doseq=True)
            if query:
                url = f"{url}?{query}"
            req = urllib.request.Request(url, method="GET")
            req.data = None
        else:
            req = urllib.request.Request(url, method="POST")
            data = urllib.parse.urlencode(params or []).encode("utf-8")
            req.data = data
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Accept", "application/json")
        self.calls.append((method, path))
        try:
            with self._opener(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
                body = resp.read()
                status = getattr(resp, "status", 200)
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            raise SystemExit(
                redact(f"Stripe {method} {path} failed HTTP {exc.code}: {err_body}", self.api_key)
            ) from None
        except Exception as exc:  # noqa: BLE001
            raise SystemExit(redact(f"Stripe {method} {path} failed: {exc}", self.api_key)) from None
        if status >= 400:
            raise SystemExit(redact(f"Stripe {method} {path} failed HTTP {status}", self.api_key))
        parsed = json.loads(body.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise SystemExit(f"Stripe {method} {path} returned a non-object.")
        return parsed

    def get(self, path: str, params: Optional[Sequence[Tuple[str, str]]] = None) -> Dict[str, Any]:
        return self._request("GET", path, params)

    def post(self, path: str, params: Sequence[Tuple[str, str]]) -> Dict[str, Any]:
        return self._request("POST", path, params)

    def list_all(self, path: str, extra: Optional[Sequence[Tuple[str, str]]] = None) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        starting_after = None
        for _ in range(MAX_PAGES):
            params: List[Tuple[str, str]] = [("limit", str(PAGE_SIZE))]
            if extra:
                params.extend(extra)
            if starting_after:
                params.append(("starting_after", starting_after))
            page = self.get(path, params)
            data = page.get("data") or []
            items.extend(obj for obj in data if isinstance(obj, dict))
            if not page.get("has_more") or not data:
                break
            last_id = data[-1].get("id") if isinstance(data[-1], dict) else None
            if not last_id:
                break
            starting_after = last_id
        return items


def _metadata(obj: Dict[str, Any]) -> Dict[str, Any]:
    md = obj.get("metadata") or {}
    return md if isinstance(md, dict) else {}


def find_existing_product(client: StripeTestClient, plan_id: str) -> Optional[Dict[str, Any]]:
    for prod in client.list_all("/v1/products", [("active", "true")]):
        md = _metadata(prod)
        if md.get("omi_test_fixture") == TEST_FIXTURE_MARKER and md.get("omi_plan_id") == plan_id:
            return prod
    return None


def find_existing_price(
    client: StripeTestClient, product_id: str, interval: str, currency: str, unit_amount: int
) -> Optional[Dict[str, Any]]:
    for price in client.list_all("/v1/prices", [("active", "true"), ("product", product_id)]):
        md = _metadata(price)
        rec = price.get("recurring") or {}
        rec_interval = rec.get("interval") if isinstance(rec, dict) else None
        if (
            md.get("omi_test_fixture") == TEST_FIXTURE_MARKER
            and rec_interval == interval
            and price.get("currency") == currency
            and price.get("unit_amount") == unit_amount
        ):
            return price
    return None


def apply_plan(client: StripeTestClient, plan: List[Dict[str, Any]]) -> Dict[str, Any]:
    created: List[Dict[str, Any]] = []
    env: Dict[str, str] = {}
    for prod_spec in plan:
        plan_id = prod_spec["plan_id"]
        existing = find_existing_product(client, plan_id)
        if existing:
            product = existing
            print(f"reusing product {product['id']} for {plan_id}")
        else:
            product = client.post(
                "/v1/products",
                [
                    ("name", f"[omi-test] {prod_spec['display_name']}"),
                    ("metadata[omi_test_fixture]", TEST_FIXTURE_MARKER),
                    ("metadata[omi_plan_id]", plan_id),
                ],
            )
            print(f"created product {product.get('id')} for {plan_id}")
        product_id = product["id"]
        for price_spec in prod_spec["prices"]:
            found = find_existing_price(
                client, product_id, price_spec["interval"], price_spec["currency"], price_spec["unit_amount"]
            )
            if found:
                price = found
                print(f"  reusing {price_spec['interval']} price {price['id']}")
            else:
                price = client.post(
                    "/v1/prices",
                    [
                        ("product", product_id),
                        ("currency", price_spec["currency"]),
                        ("unit_amount", str(price_spec["unit_amount"])),
                        ("recurring[interval]", price_spec["interval"]),
                        ("nickname", price_spec["nickname"]),
                        ("metadata[omi_test_fixture]", TEST_FIXTURE_MARKER),
                        ("metadata[omi_plan_id]", plan_id),
                        ("metadata[omi_interval]", price_spec["interval"]),
                    ],
                )
                print(f"  created {price_spec['interval']} price {price.get('id')}")
            env_var = price_spec.get("env_var")
            if env_var and price.get("id"):
                env[env_var] = price["id"]
            created.append(
                {
                    "plan_id": plan_id,
                    "interval": price_spec["interval"],
                    "env_var": env_var,
                    "product_id": product_id,
                    "price_id": price.get("id"),
                    "unit_amount": price_spec["unit_amount"],
                    "currency": price_spec["currency"],
                    "source_price_id": price_spec["source_price_id"],
                }
            )
    methods = sorted({m for m, _p in client.calls})
    if "GET" not in methods:
        raise SystemExit("Apply did not GET existing objects; aborting.")
    return {
        "_meta": {
            "wrote_ledger": False,
            "wrote_fixture": False,
            "livemode": False,
            "http_methods": methods,
        },
        "env": dict(sorted(env.items())),
        "created": created,
    }


def print_env(result: Dict[str, Any]) -> None:
    print("")
    print("Set these on the destination / Cloud Agent environment (test-mode ids only):")
    for key, value in result["env"].items():
        print(f"  {key}={value}")


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from-dump", required=True, help="JSON from dump_stripe_live_readonly.py")
    parser.add_argument("--apply", action="store_true", help="Create on the destination TEST-MODE account.")
    parser.add_argument("--api-key-file", help="Read the destination test key from this file.")
    parser.add_argument("--output", help="Write created ids JSON here (never the repo ledger).")
    args = parser.parse_args(list(argv) if argv is not None else None)

    dump = load_dump(args.from_dump)
    plan = build_creation_plan(dump)
    if not args.apply:
        print_plan(plan)
        return 0

    if args.output and os.path.basename(args.output) in FORBIDDEN_OUTPUT_NAMES:
        raise SystemExit(f"Refusing to write {args.output} (catalog/fixture/ledger).")

    api_key = load_api_key(args.api_key_file)
    kind = require_test_mode_key(api_key)
    print(f"TEST-MODE apply (key_kind={kind}). Creating fixture-tagged Products/Prices.", file=sys.stderr)
    client = StripeTestClient(api_key)
    result = apply_plan(client, plan)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2)
            fh.write("\n")
        print(f"Wrote {args.output}", file=sys.stderr)
    print_env(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
