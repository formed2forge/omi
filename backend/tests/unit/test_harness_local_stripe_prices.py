"""Local-dev-harness Stripe catalog stubs must not reach live Stripe."""

from unittest.mock import MagicMock

import pytest
import stripe

from utils import stripe as stripe_utils


@pytest.fixture
def restore_retrieve():
    original = stripe.Price.retrieve
    yield
    stripe.Price.retrieve = original


def test_retrieve_price_stubs_local_ids_when_harness_flag_set(monkeypatch, restore_retrieve):
    monkeypatch.setenv("OMI_HARNESS_STRIPE_STUB", "1")
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    stripe.Price.retrieve = MagicMock(side_effect=AssertionError("live Stripe must not be called"))

    price = stripe_utils.retrieve_price("price_local_plus_month")

    assert price.id == "price_local_plus_month"
    assert price.unit_amount == 1900
    assert price.recurring.interval == "month"
    payload = price.to_dict_recursive()
    assert payload["id"] == "price_local_plus_month"
    assert payload["unit_amount"] == 1900
    assert payload["recurring"]["interval"] == "month"
    stripe.Price.retrieve.assert_not_called()


def test_retrieve_price_stubs_pro_v2_under_local_dev_harness_env(monkeypatch, restore_retrieve):
    monkeypatch.delenv("OMI_HARNESS_STRIPE_STUB", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "local-dev-harness")
    stripe.Price.retrieve = MagicMock(side_effect=AssertionError("live Stripe must not be called"))

    price = stripe_utils.retrieve_price("price_local_pro_v2_month")

    assert price.unit_amount == 4900
    assert price.recurring.interval == "month"
    stripe.Price.retrieve.assert_not_called()


def test_retrieve_price_does_not_stub_outside_harness(monkeypatch, restore_retrieve):
    monkeypatch.delenv("OMI_HARNESS_STRIPE_STUB", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "prod")
    live = MagicMock(name="live-price")
    stripe.Price.retrieve = MagicMock(return_value=live)

    assert stripe_utils.retrieve_price("price_local_plus_month") is live
    stripe.Price.retrieve.assert_called_once_with("price_local_plus_month")
