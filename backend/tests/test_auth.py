from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers, register_user


def test_auth_register_login_and_profile(client: TestClient) -> None:
    invalid = client.post(
        "/api/auth/register",
        json={"email": "bad", "display_name": "", "password": "123", "role": "admin"},
    )
    assert invalid.status_code == 400

    token, user = register_user(client, email="teacher@example.com", display_name="Teacher")
    assert user["email"] == "teacher@example.com"

    duplicate = client.post(
        "/api/auth/register",
        json={
            "email": "teacher@example.com",
            "display_name": "Teacher 2",
            "password": "secret123",
            "role": "teacher",
        },
    )
    assert duplicate.status_code == 409

    bad_login = client.post("/api/auth/login", json={"email": "teacher@example.com", "password": "wrong"})
    assert bad_login.status_code == 401

    login = client.post("/api/auth/login", json={"email": "teacher@example.com", "password": "secret123"})
    assert login.status_code == 200

    me = client.get("/api/auth/me", headers=auth_headers(token))
    assert me.status_code == 200
    assert me.json()["display_name"] == "Teacher"

    unauth = client.get("/api/auth/me")
    assert unauth.status_code == 401
