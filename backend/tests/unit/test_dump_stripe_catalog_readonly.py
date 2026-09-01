"""Ledger dump + live-readonly GET gate for dump_stripe_catalog_readonly.py."""

from unittest.mock import MagicMock

import pytest

from scripts import dump_stripe_catalog_readonly as dump
from scripts import snapshot_stripe_catalog as snap


def test_ledger_dump_lists_current_prod_and_dev_ids():
    catalog = snap._load_catalog()
    result = dump.build_ledger_dump(catalog)
    assert result["_meta"]["wrote_fixture"] is False
    assert result["_meta"]["wrote_ledger"] is False
    by_key = {(row["plan_id"], row["interval"]): row for row in result["current_by_plan_interval"]}
    plus_month = by_key[("plus", "month")]
    assert plus_month["prod_price_id"] == "price_1TuH6z1F8wnoWYvw7Siv61SX"
    assert plus_month["unit_amount"] is None
    assert plus_month["primary_env_var"] == "STRIPE_PLUS_MONTHLY_PRICE_ID"
    neo_month = by_key[("unlimited", "month")]
    assert neo_month["prod_price_id"] == "price_1TNIHd1F8wnoWYvwkIrekcQZ"
    assert neo_month["dev_price_id"] == "price_1RrxXL1F8wnoWYvwIddzR902"


def test_from_ledger_main_needs_no_key(monkeypatch, capsys):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    assert dump.main([]) == 0
    out = capsys.readouterr().out
    assert "price_1TuH6z1F8wnoWYvw7Siv61SX" in out
    assert "STRIPE_PLUS_MONTHLY_PRICE_ID" in out
    assert "prod_Uu5HDt3sygCK8N" in out


def test_from_stripe_refuses_live_without_flag(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    with pytest.raises(SystemExit, match="LIVE Stripe key"):
        dump.main(["--from-stripe"])


def test_from_stripe_live_readonly_retrieves_only(monkeypatch):
    monkeypatch.setenv("STRIPE_API_KEY", "rk_live_not_for_writes")
    price = MagicMock()
    price.to_dict_recursive.return_value = {
        "id": "price_1TuH6z1F8wnoWYvw7Siv61SX",
        "livemode": True,
        "active": True,
        "currency": "usd",
        "unit_amount": 1499,
        "nickname": "Plus month",
        "product": {"id": "prod_Uu5HDt3sygCK8N", "name": "Plus"},
    }

    class _Pager:
        def auto_paging_iter(self):
            return iter([])

    stripe = MagicMock()
    stripe.Price.retrieve.return_value = price
    stripe.Product.list.return_value = _Pager()
    stripe.Price.list.return_value = _Pager()

    def _fake_require(*, allow_live):
        assert allow_live is True
        return stripe, "live"

    monkeypatch.setattr(dump, "_require_readonly_key", _fake_require)
    result = dump.retrieve_live_readonly(snap._load_catalog(), allow_live=True)
    assert result["_meta"]["wrote_fixture"] is False
    plus = next(r for r in result["current_by_plan_interval"] if r["plan_id"] == "plus" and r["interval"] == "month")
    assert plus["unit_amount"] == 1499
    stripe.Price.create.assert_not_called()
    stripe.Product.create.assert_not_called()


def test_refuses_to_write_fixture_or_catalog(tmp_path, monkeypatch):
    monkeypatch.delenv("STRIPE_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="hermetic fixture"):
        dump.main(["--output", str(snap.FIXTURE_PATH)])
    with pytest.raises(SystemExit, match="catalog/ledger"):
        dump.main(["--output", str(snap.CATALOG_PATH)])
    out = tmp_path / "ids.json"
    assert dump.main(["--output", str(out), "--json"]) == 0
    assert out.is_file()
    assert "plus" in out.read_text()
