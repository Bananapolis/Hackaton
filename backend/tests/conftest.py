from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure `app` (backend/app) is importable regardless of current working directory.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import config, state, database
from app.main import app


@pytest.fixture(autouse=True)
def isolated_backend_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    db_path = tmp_path / "test.sqlite3"
    uploads_dir = tmp_path / "uploads"

    monkeypatch.setattr(config, "DB_PATH", db_path)
    monkeypatch.setattr(config, "UPLOADS_DIR", uploads_dir)

    state.SESSIONS.clear()
    database.init_db()
    yield
    state.SESSIONS.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def register_user(
    client: TestClient,
    *,
    email: str,
    display_name: str,
    password: str = "secret123",
    role: str = "teacher",
) -> tuple[str, dict]:
    response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "display_name": display_name,
            "password": password,
            "role": role,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    return payload["token"], payload["user"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def receive_until_type(ws, expected_type: str, max_messages: int = 20) -> dict:
    for _ in range(max_messages):
        message = ws.receive_json()
        if message.get("type") == expected_type:
            return message
    raise AssertionError(f"Message type {expected_type} not received within {max_messages} messages")
