from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers, register_user


def test_health_endpoint(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_unauthenticated_endpoints_return_401(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/presentations").status_code == 401
    assert client.get("/api/quizzes").status_code == 401
    assert client.get("/api/library/sessions").status_code == 401


def test_full_user_flow(client: TestClient) -> None:
    token, user = register_user(client, email="smoke@test.com", display_name="Smoke")

    create = client.post(
        "/api/sessions",
        json={"teacher_name": "Smoke"},
        headers=auth_headers(token),
    )
    assert create.status_code == 200
    code = create.json()["code"]

    with client.websocket_connect(f"/ws/{code}?role=teacher&name=Smoke") as teacher_ws, \
         client.websocket_connect(f"/ws/{code}?role=student&name=Student1") as student_ws:
        teacher_ws.receive_json()
        student_ws.receive_json()

    end = client.post(f"/api/sessions/{code}/end")
    assert end.status_code == 200
