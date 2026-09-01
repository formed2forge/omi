"""Stdlib GET-only live Stripe catalog dump. No network in these tests."""

import io
import json
from urllib.error import HTTPError

import pytest

from scripts import dump_stripe_live_readonly as dump


class FakeResponse:
    def __init__(self, payload, status=200):
        self._body = json.dumps(payload).encode("utf-8") if not isinstance(payload, bytes) else payload
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_refuses_live_key_without_flag(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        dump.main(["--output", "stripe-prod-catalog.json"])


def test_missing_key_fails_closed(monkeypatch, tmp_path):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="STRIPE_API_KEY"):
        dump.main(["--live-readonly", "--output", str(tmp_path / "out.json")])


def test_refuses_catalog_and_fixture_output_names(tmp_path, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_x")
    with pytest.raises(SystemExit, match="catalog/fixture/ledger"):
        dump.main(["--live-readonly", "--output", str(tmp_path / "plan_catalog.json")])
    with pytest.raises(SystemExit, match="catalog/fixture/ledger"):
        dump.main(["--live-readonly", "--output", str(tmp_path / "stripe_catalog_snapshot.json")])


def test_redact_strips_live_key():
    secret = "rk_live_SUPERSECRETVALUE"
    redacted = dump.redact(f"Authorization Bearer {secret} boom", secret)
    assert secret not in redacted
    assert "[redacted]" in redacted


def test_redact_does_not_loop_when_stripe_echoes_truncated_live_prefix():
    """Stripe 403 bodies echo a truncated rk_live_… that is not the full secret.

    Replacing that prefix with rk_live_[redacted] and searching from index 0
    rematches forever. This is the hang Tim hit on the billed-price census.
    """
    secret = "rk_live_SUPERSECRETVALUE"
    truncated = "rk_live_" + ("A" * 40)
    masked = "rk_live_" + ("*" * 64) + "xyz"
    for echo in (truncated, masked):
        redacted = dump.redact(f"The provided key '{echo}' does not have access", secret)
        assert echo not in redacted
        assert secret not in redacted
        assert "rk_live_[redacted]" in redacted


def test_stripe_error_detail_parses_code_and_caps_length():
    body = json.dumps(
        {
            "error": {
                "code": "more_permissions_needed",
                "type": "invalid_request_error",
                "message": "Missing permission: Subscriptions.",
            }
        }
    )
    detail = dump.stripe_error_detail(body)
    assert "more_permissions_needed" in detail
    assert "Missing permission: Subscriptions." in detail
    assert dump.stripe_error_detail("not-json " + ("x" * 400)) == ("not-json " + ("x" * 400))[:300]


def test_get_only_retrieve_known_ids(monkeypatch, tmp_path):
    requests = []

    def opener(req, timeout=0):
        requests.append((req.get_method(), req.full_url, req.data))
        path = req.full_url.split("?")[0]
        if "/v1/prices/" in path and path.rstrip("/").split("/")[-1].startswith("price_"):
            price_id = path.rstrip("/").split("/")[-1]
            return FakeResponse(
                {
                    "id": price_id,
                    "object": "price",
                    "active": True,
                    "livemode": True,
                    "currency": "usd",
                    "unit_amount": 1499,
                    "nickname": "test",
                    "recurring": {"interval": "month", "interval_count": 1},
                    "product": {"id": "prod_Uu5HDt3sygCK8N", "name": "Plus"},
                    "metadata": {},
                }
            )
        if "/v1/products/" in path:
            product_id = path.rstrip("/").split("/")[-1]
            return FakeResponse({"id": product_id, "name": "Plus", "active": True, "livemode": True, "metadata": {}})
        raise AssertionError(f"unexpected url {req.full_url}")

    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    monkeypatch.setattr(dump.urllib.request, "urlopen", opener)
    out = tmp_path / "stripe-prod-catalog.json"
    assert dump.main(["--live-readonly", "--known-ids-only", "--output", str(out)]) == 0
    payload = json.loads(out.read_text())
    assert payload["_meta"]["http_methods"] == ["GET"]
    assert payload["_meta"]["wrote_ledger"] is False
    plus = next(r for r in payload["current_prod_prices"] if r["plan_id"] == "plus" and r["interval"] == "month")
    assert plus["unit_amount"] == 1499
    assert plus["price_id"] == "price_1TuH6z1F8wnoWYvw7Siv61SX"
    assert requests
    assert all(method == "GET" for method, _url, _data in requests)
    assert all(data is None for _method, _url, data in requests)
    assert all("/v1/customers" not in url for _method, url, _data in requests)


def test_list_pagination_and_no_post(monkeypatch, tmp_path):
    pages = {"/v1/products": 0, "/v1/prices": 0}

    def opener(req, timeout=0):
        assert req.get_method() == "GET"
        assert req.data is None
        url = req.full_url
        path = url.split("?")[0].rstrip("/")
        if path == "https://api.stripe.com/v1/products":
            pages["/v1/products"] += 1
            if "starting_after" not in url:
                return FakeResponse(
                    {
                        "object": "list",
                        "has_more": True,
                        "data": [{"id": "prod_1", "name": "A", "active": True, "livemode": True}],
                    }
                )
            return FakeResponse(
                {"object": "list", "has_more": False, "data": [{"id": "prod_2", "name": "B", "active": True}]}
            )
        if url.startswith("https://api.stripe.com/v1/prices?") or url.endswith("/v1/prices"):
            pages["/v1/prices"] += 1
            return FakeResponse(
                {
                    "object": "list",
                    "has_more": False,
                    "data": [
                        {
                            "id": "price_1TuH6z1F8wnoWYvw7Siv61SX",
                            "unit_amount": 1999,
                            "currency": "usd",
                            "active": True,
                            "livemode": True,
                            "recurring": {"interval": "month"},
                            "product": {"id": "prod_Uu5HDt3sygCK8N", "name": "Plus"},
                        }
                    ],
                }
            )
        if "/v1/prices/" in url:
            return FakeResponse(
                {
                    "id": url.split("/")[-1].split("?")[0],
                    "unit_amount": 100,
                    "currency": "usd",
                    "active": True,
                    "livemode": True,
                    "recurring": {"interval": "year"},
                    "product": "prod_x",
                }
            )
        if "/v1/products/" in url:
            return FakeResponse({"id": url.split("/")[-1], "name": "x", "active": True})
        raise AssertionError(url)

    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    monkeypatch.setattr(dump.urllib.request, "urlopen", opener)
    out = tmp_path / "out.json"
    assert dump.main(["--live-readonly", "--output", str(out)]) == 0
    payload = json.loads(out.read_text())
    assert pages["/v1/products"] == 2
    ids = {p["id"] for p in payload["products"]}
    assert "prod_1" in ids and "prod_2" in ids
    plus = next(r for r in payload["current_prod_prices"] if r["plan_id"] == "plus" and r["interval"] == "month")
    assert plus["unit_amount"] == 1999


def test_http_error_redacts_key(monkeypatch):
    secret = "rk_live_SUPERSECRETVALUE"

    def opener(req, timeout=0):
        raise HTTPError(
            req.full_url,
            403,
            "Forbidden",
            hdrs=None,
            fp=io.BytesIO(f"key {secret} denied".encode("utf-8")),
        )

    client = dump.StripeReadonlyClient(secret, opener=opener)
    with pytest.raises(SystemExit) as exc:
        client.get("/v1/prices/price_1TuH6z1F8wnoWYvw7Siv61SX")
    assert secret not in str(exc.value)


def test_http_error_truncated_live_prefix_does_not_hang():
    secret = "rk_live_SUPERSECRETVALUE"
    truncated = "rk_live_" + ("B" * 48)
    body = json.dumps(
        {
            "error": {
                "code": "more_permissions_needed",
                "type": "invalid_request_error",
                "message": f"The provided key '{truncated}' does not have access to this endpoint.",
            }
        }
    )

    def opener(req, timeout=0):
        raise HTTPError(req.full_url, 403, "Forbidden", hdrs=None, fp=io.BytesIO(body.encode("utf-8")))

    client = dump.StripeReadonlyClient(secret, opener=opener)
    with pytest.raises(SystemExit) as exc:
        client.get("/v1/prices/price_1TuH6z1F8wnoWYvw7Siv61SX")
    message = str(exc.value)
    assert secret not in message
    assert truncated not in message
    assert "more_permissions_needed" in message
    assert "HTTP 403" in message


def test_api_key_file(tmp_path, monkeypatch):
    key_file = tmp_path / "key"
    key_file.write_text("rk_live_fromfile\n", encoding="utf-8")
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        dump.main(["--api-key-file", str(key_file), "--output", str(tmp_path / "out.json")])
    # with the flag, missing network is fine as long as we don't refuse the key
    monkeypatch.setattr(
        dump.urllib.request,
        "urlopen",
        lambda req, timeout=0: FakeResponse({"object": "list", "has_more": False, "data": []}),
    )
    out = tmp_path / "out.json"
    assert (
        dump.main(["--live-readonly", "--api-key-file", str(key_file), "--known-ids-only", "--output", str(out)]) == 0
    )
    payload = json.loads(out.read_text())
    assert payload["_meta"]["key_kind"] == "live"
