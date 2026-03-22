from __future__ import annotations

import pytest

from app import config, state, database
from app.utils import parse_bearer_token, hash_password


def test_parse_bearer_token_and_password_hashing_helpers() -> None:
    assert parse_bearer_token(None) is None
    assert parse_bearer_token("") is None
    assert parse_bearer_token("Basic abc") is None
    assert parse_bearer_token("Bearer token123") == "token123"

    salt1, hash1 = hash_password("abc123")
    salt2, hash2 = hash_password("abc123", salt1)

    assert salt1 == salt2
    assert hash1 == hash2
    assert len(salt1) == 32
    assert len(hash1) == 64


def test_parse_allowed_origins_and_generate_code_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    parsed = config.parse_allowed_origins("http://a.com/, http://b.com , ,http://c.com")
    assert parsed == ["http://a.com", "http://b.com", "http://c.com"]

    calls = iter([list("ABC123"), list("ZZZ999")])
    monkeypatch.setattr(state.random, "choices", lambda alphabet, k: next(calls))
    monkeypatch.setattr(database, "session_exists", lambda code: code == "ABC123")

    code = state.generate_session_code()
    assert code == "ZZZ999"
