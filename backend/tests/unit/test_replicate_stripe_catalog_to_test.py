"""Dry-run / apply gates for replicate_stripe_catalog_to_test.py. No live Stripe."""

import json

import pytest

from scripts import replicate_stripe_catalog_to_test as repl


def _dump(tmp_path, amount=1499):
    path = tmp_path / "stripe-prod-catalog.json"
    path.write_text(
        json.dumps(
            {
                "current_prod_prices": [
                    {
                        "plan_id": "plus",
                        "display_name": "Plus",
                        "interval": "month",
                        "env_var": "STRIPE_PLUS_MONTHLY_PRICE_ID",
                        "price_id": "price_1TuH6z1F8wnoWYvw7Siv61SX",
                        "unit_amount": amount,
                        "currency": "usd",
                    },
                    {
                        "plan_id": "plus",
                        "display_name": "Plus",
                        "interval": "year",
                        "env_var": "STRIPE_PLUS_ANNUAL_PRICE_ID",
                        "price_id": "price_1TuHCw1F8wnoWYvwZvKu86sI",
                        "unit_amount": amount * 10,
                        "currency": "usd",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    return path


def test_dry_run_needs_no_key(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    assert repl.main(["--from-dump", str(_dump(tmp_path))]) == 0
    out = capsys.readouterr().out
    assert "[omi-test] Plus" in out
    assert "1499" in out
    assert "--apply" in out


def test_missing_amount_fails(tmp_path):
    path = _dump(tmp_path)
    payload = json.loads(path.read_text())
    payload["current_prod_prices"][0]["unit_amount"] = None
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(SystemExit, match="unit_amount"):
        repl.main(["--from-dump", str(path)])


def test_apply_refuses_live_key(tmp_path, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        repl.main(["--from-dump", str(_dump(tmp_path)), "--apply"])


def test_apply_creates_with_post_and_reuses(tmp_path, monkeypatch, capsys):
    store = {"products": [], "prices": []}

    def opener(req, timeout=0):
        method = req.get_method()
        url = req.full_url
        path = url.split("?")[0]
        if method == "GET" and path.endswith("/v1/products"):
            return _resp({"object": "list", "has_more": False, "data": store["products"]})
        if method == "GET" and path.endswith("/v1/prices"):
            return _resp({"object": "list", "has_more": False, "data": store["prices"]})
        if method == "POST" and path.endswith("/v1/products"):
            prod = {
                "id": "prod_test_plus",
                "name": "[omi-test] Plus",
                "metadata": {"omi_test_fixture": "1", "omi_plan_id": "plus"},
            }
            store["products"].append(prod)
            return _resp(prod)
        if method == "POST" and path.endswith("/v1/prices"):
            n = len(store["prices"]) + 1
            price = {
                "id": f"price_test_{n}",
                "product": "prod_test_plus",
                "currency": "usd",
                "unit_amount": 1499 if n == 1 else 14990,
                "recurring": {"interval": "month" if n == 1 else "year"},
                "metadata": {"omi_test_fixture": "1", "omi_plan_id": "plus"},
            }
            store["prices"].append(price)
            return _resp(price)
        raise AssertionError((method, url))

    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_not_live")
    monkeypatch.setattr(repl.urllib.request, "urlopen", opener)
    out = tmp_path / "created.json"
    assert repl.main(["--from-dump", str(_dump(tmp_path)), "--apply", "--output", str(out)]) == 0
    payload = json.loads(out.read_text())
    assert payload["_meta"]["wrote_ledger"] is False
    assert payload["_meta"]["livemode"] is False
    assert set(payload["_meta"]["http_methods"]) == {"GET", "POST"}
    assert payload["env"]["STRIPE_PLUS_MONTHLY_PRICE_ID"] == "price_test_1"
    printed = capsys.readouterr().out
    assert "created product prod_test_plus" in printed

    # second apply reuses
    assert repl.main(["--from-dump", str(_dump(tmp_path)), "--apply", "--output", str(out)]) == 0
    assert json.loads(out.read_text())["env"]["STRIPE_PLUS_MONTHLY_PRICE_ID"] == "price_test_1"
    assert len(store["products"]) == 1
    assert len(store["prices"]) == 2


def test_refuses_ledger_output(tmp_path, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_x")
    with pytest.raises(SystemExit, match="catalog/fixture/ledger"):
        repl.main(["--from-dump", str(_dump(tmp_path)), "--apply", "--output", str(tmp_path / "plan_catalog.json")])


class _Resp:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")
        self.status = 200

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _resp(payload):
    return _Resp(payload)
