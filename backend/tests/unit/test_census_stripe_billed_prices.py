"""GET-only billed-price census. No network in these tests."""

import io
import json
from urllib.error import HTTPError

import pytest

from scripts import census_stripe_billed_prices as census
from scripts.dump_stripe_live_readonly import KNOWN_PROD_PRICES


PLUS_MONTH = next(row["price_id"] for row in KNOWN_PROD_PRICES if row["plan_id"] == "plus" and row["interval"] == "month")
EXTRA_ARCHITECT = "price_1EXTRAArchitect200monthXX"


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


def _sub(price_id, *, status="active", cancel_at_period_end=False, expand=True):
    price = (
        {
            "id": price_id,
            "object": "price",
            "unit_amount": 1799 if price_id == PLUS_MONTH else 20000,
            "currency": "usd",
            "active": True,
            "livemode": True,
            "nickname": "fixture",
            "recurring": {"interval": "month"},
            "product": "prod_x",
        }
        if expand
        else price_id
    )
    return {
        "id": f"sub_{price_id[-8:]}",
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "items": {"data": [{"price": price}]},
    }


def test_dry_run_does_not_need_a_key(monkeypatch, capsys):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    assert census.main([]) == 0
    out = capsys.readouterr().out
    assert "Dry-run only" in out
    assert "GET /v1/subscriptions" in out
    assert "--live-readonly" in out


def test_refuses_live_key_without_flag(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        census.main(["--apply"])


def test_refuses_test_key_without_allow_flag(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_test_not_live_customers")
    with pytest.raises(SystemExit, match="test-mode key"):
        census.main(["--apply"])


def test_refuses_allow_test_mode_with_live_key(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    with pytest.raises(SystemExit, match="allow-test-mode"):
        census.main(["--apply", "--live-readonly", "--allow-test-mode"])


def test_refuses_ledger_output_names(tmp_path, monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_x")
    with pytest.raises(SystemExit, match="catalog/fixture/ledger"):
        census.main(["--apply", "--live-readonly", "--output", str(tmp_path / "plan_catalog.json")])


def test_resolve_price_retained_and_unresolved():
    ledger = {PLUS_MONTH: {"plan_id": "plus", "interval": "month", "environment": "prod"}}
    assert census.resolve_price(PLUS_MONTH, ledger, {})["resolution"] == "retained"
    extra = census.resolve_price(EXTRA_ARCHITECT, ledger, {})
    assert extra["resolution"] == "unresolved"
    assert extra["resolved_plan_id"] is None


def test_resolve_price_configured_env_and_conflict():
    ledger = {PLUS_MONTH: {"plan_id": "plus", "interval": "month", "environment": "prod"}}
    configured = {PLUS_MONTH: "architect", EXTRA_ARCHITECT: "architect"}
    assert census.resolve_price(PLUS_MONTH, ledger, configured)["resolution"] == "conflict"
    assert census.resolve_price(EXTRA_ARCHITECT, ledger, configured)["resolution"] == "configured"


def test_apply_flags_unresolved_billed_price(monkeypatch, tmp_path):
    catalog = tmp_path / "plan_catalog.json"
    catalog.write_text(
        json.dumps(
            {
                "recognized_stripe_prices": [
                    {"price_id": PLUS_MONTH, "plan_id": "plus", "interval": "month", "environment": "prod"}
                ]
            }
        ),
        encoding="utf-8",
    )
    pages = {"active": 0}

    def opener(req, timeout=0):
        assert req.get_method() == "GET"
        assert req.data is None
        assert "/v1/customers" not in req.full_url
        url = req.full_url
        if "/v1/subscriptions" in url:
            if "status=active" in url:
                pages["active"] += 1
                if "starting_after" not in url:
                    return FakeResponse(
                        {
                            "object": "list",
                            "has_more": True,
                            "data": [
                                _sub(PLUS_MONTH),
                                _sub(PLUS_MONTH, cancel_at_period_end=True),
                            ],
                        }
                    )
                return FakeResponse({"object": "list", "has_more": False, "data": [_sub(EXTRA_ARCHITECT)]})
            return FakeResponse({"object": "list", "has_more": False, "data": []})
        raise AssertionError(url)

    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    monkeypatch.setattr(census.urllib.request, "urlopen", opener)
    out = tmp_path / "stripe-billed-price-census.json"
    assert census.main(["--apply", "--live-readonly", "--catalog", str(catalog), "--output", str(out)]) == 1
    payload = json.loads(out.read_text())
    assert payload["_meta"]["http_methods"] == ["GET"]
    assert payload["_meta"]["wrote_ledger"] is False
    assert payload["_meta"]["live_readonly"] is True
    assert pages["active"] == 2
    plus = next(row for row in payload["prices"] if row["price_id"] == PLUS_MONTH)
    assert plus["resolution"] == "retained"
    assert plus["resolved_plan_id"] == "plus"
    assert plus["subscription_count"] == 2
    assert plus["cancel_at_period_end_count"] == 1
    assert EXTRA_ARCHITECT in payload["unresolved"]
    extra = next(row for row in payload["prices"] if row["price_id"] == EXTRA_ARCHITECT)
    assert extra["resolution"] == "unresolved"
    assert extra["subscription_count"] == 1


def test_client_refuses_non_census_get():
    client = census.StripeCensusClient("rk_live_x")
    with pytest.raises(SystemExit, match="only lists subscriptions"):
        client.get("/v1/customers")


def test_http_error_redacts_key_and_hints_subscriptions_read():
    secret = "rk_live_SUPERSECRETVALUE"

    def opener(req, timeout=0):
        raise HTTPError(
            req.full_url,
            403,
            "Forbidden",
            hdrs=None,
            fp=io.BytesIO(f"key {secret} denied".encode("utf-8")),
        )

    client = census.StripeCensusClient(secret, opener=opener)
    with pytest.raises(SystemExit) as exc:
        client.get("/v1/subscriptions")
    message = str(exc.value)
    assert secret not in message
    assert "Subscriptions Read" in message
