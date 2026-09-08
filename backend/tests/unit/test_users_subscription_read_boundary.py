"""Subscriptions preserve strict corruption semantics at the Firestore read boundary."""

from unittest.mock import patch

import pytest

import database.read_boundary as read_boundary
import database.users as users_db


class _Snapshot:
    exists = True
    id = 'user-1'

    def to_dict(self):
        return {'subscription': ['not-a-mapping']}


class _Database:
    def collection(self, *_args):
        return self

    def document(self, *_args):
        return self

    def get(self, *_args, **_kwargs):
        return _Snapshot()


def test_existing_subscription_with_malformed_payload_raises_typed_error(monkeypatch):
    monkeypatch.setattr(users_db, 'db', _Database())

    with patch.object(read_boundary, 'record_fallback') as fallback:
        with pytest.raises(read_boundary.MalformedDocError):
            users_db.get_existing_user_subscription('user-1')

    fallback.assert_not_called()


class _PlanSnapshot(_Snapshot):
    def to_dict(self):
        return {'subscription': {'plan': 'plan_that_is_not_in_the_catalog', 'status': 'active'}}


class _PlanDatabase(_Database):
    def get(self, *_args, **_kwargs):
        return _PlanSnapshot()


def test_unrecognized_plan_reports_the_shape_the_subscription_endpoint_keys_on(monkeypatch):
    """`routers/users.py` presents ONLY `error_fields == ('plan',) and error_types == ('enum',)`.

    That predicate is only safe while the strict reader really reports a stored
    plan outside the catalog enum in exactly that shape.
    """
    monkeypatch.setattr(users_db, 'db', _PlanDatabase())

    with pytest.raises(read_boundary.MalformedDocError) as excinfo:
        users_db.get_existing_user_subscription('user-1')

    assert excinfo.value.error_fields == ('plan',)
    assert excinfo.value.error_types == ('enum',)
    # The rejected value must never travel on the error.
    assert 'plan_that_is_not_in_the_catalog' not in str(excinfo.value)


class _NoSubscriptionSnapshot:
    exists = True
    id = 'user-1'

    def to_dict(self):
        return {'name': 'legacy account'}


class _LegacyDatabase(_Database):
    def __init__(self):
        self.written = []

    def get(self, *_args, **_kwargs):
        return _NoSubscriptionSnapshot()

    def set(self, payload, **_kwargs):
        self.written.append(payload)


def test_legacy_account_without_a_subscription_doc_keeps_its_provisioning_fallback(monkeypatch):
    """Unmigrated principal: no `subscription` field at all is not corruption.

    This is the pre-existing intended behavior — `get_existing_user_subscription`
    reports "none" and `get_user_subscription` provisions the default free plan —
    and it must stay distinct from the unrecognized-plan path, which grants nothing.
    """
    fake_db = _LegacyDatabase()
    monkeypatch.setattr(users_db, 'db', fake_db)

    assert users_db.get_existing_user_subscription('user-1') is None

    provisioned = users_db.get_user_subscription('user-1')
    assert provisioned.plan is users_db.PlanType.basic
    assert fake_db.written and 'subscription' in fake_db.written[0]
