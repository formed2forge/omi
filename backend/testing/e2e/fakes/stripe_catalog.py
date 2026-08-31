"""Offline Stripe catalog fake driven by the snapshot fixture.

Loads ``backend/testing/fixtures/stripe_catalog_snapshot.json`` (produced by
``backend/scripts/snapshot_stripe_catalog.py``) and makes the backend's
`available_plans` paths render **without any live Stripe call**:

* sets the ``STRIPE_*_PRICE_ID`` env vars the plan definitions read
  (`utils/subscription._configured_plan_price_id`), and
* replaces ``stripe.Price.retrieve`` with a stub that serves the fixture, and
* (optionally) pre-seeds the ``stripe_price:{id}`` Redis cache the
  `routers/users.py` subscription builder reads before calling Stripe.

Both `routers/payment.py::get_available_plans_endpoint` and the
`routers/users.py` subscription `available_plans` builder call
``stripe.Price.retrieve``; stubbing it covers both. Unstubbed Stripe calls with
an empty api key raise locally (no network), so nothing here trips the hermetic
network guard.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "stripe_catalog_snapshot.json"


def load_snapshot(path: Path = FIXTURE_PATH) -> Dict[str, Any]:
    return json.loads(path.read_text())


class _FakeRecurring:
    def __init__(self, data: Dict[str, Any]):
        self.interval = data.get("interval")
        self.interval_count = data.get("interval_count", 1)
        self.usage_type = data.get("usage_type", "licensed")


class _FakePrice:
    """Minimal stand-in for a stripe.Price object.

    Supports the attribute access the endpoints use (``.id``, ``.unit_amount``,
    ``.recurring.interval``) and the dict conversions the cache path uses
    (``.to_dict()`` / ``.to_dict_recursive()``).
    """

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self.id = data.get("id")
        self.unit_amount = data.get("unit_amount")
        self.currency = data.get("currency")
        self.nickname = data.get("nickname")
        self.product = data.get("product")
        self.recurring = _FakeRecurring(data.get("recurring") or {})

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data)

    def to_dict_recursive(self) -> Dict[str, Any]:
        return json.loads(json.dumps(self._data))


class StripeCatalogFake:
    """Handle returned by :func:`install`; exposes the loaded price map."""

    def __init__(self, snapshot: Dict[str, Any]):
        self.snapshot = snapshot
        self.prices: Dict[str, Any] = snapshot.get("prices", {})
        self.env: Dict[str, str] = snapshot.get("env", {})
        self.plan_to_price: Dict[str, Dict[str, str]] = snapshot.get("plan_to_price", {})

    def retrieve(self, price_id: str, **_kwargs: Any) -> _FakePrice:
        data = self.prices.get(price_id)
        if data is None:
            raise Exception(f"No such price: {price_id}")
        return _FakePrice(data)


def install(monkeypatch, *, seed_cache: bool = True, path: Path = FIXTURE_PATH) -> StripeCatalogFake:
    """Wire the fixture into the process for the duration of a pytest monkeypatch.

    Sets the price-id env vars, stubs ``stripe.Price.retrieve``, and optionally
    pre-seeds the ``stripe_price:{id}`` cache. Returns the fake handle.
    """
    import stripe

    snapshot = load_snapshot(path)
    fake = StripeCatalogFake(snapshot)

    for env_var, price_id in fake.env.items():
        monkeypatch.setenv(env_var, price_id)

    monkeypatch.setattr(stripe.Price, "retrieve", staticmethod(fake.retrieve), raising=True)

    if seed_cache:
        try:
            from database.redis_db import set_generic_cache

            for price_id, data in fake.prices.items():
                set_generic_cache(f"stripe_price:{price_id}", data, ttl=3600)
        except Exception:
            # Cache seeding is a best-effort accelerator; the retrieve stub is
            # the source of truth and covers a cache miss anyway.
            pass

    return fake
