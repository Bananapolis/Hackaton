from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture(autouse=True)
def isolated_backend_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    db_path = tmp_path / "test.sqlite3"
    uploads_dir = tmp_path / "uploads"

    monkeypatch.setattr(main, "DB_PATH", db_path)
    monkeypatch.setattr(main, "UPLOADS_DIR", uploads_dir)

    main.SESSIONS.clear()
    main.init_db()
    yield
    main.SESSIONS.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


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


def test_parse_bearer_token_and_password_hashing_helpers() -> None:
    assert main.parse_bearer_token(None) is None
    assert main.parse_bearer_token("") is None
    assert main.parse_bearer_token("Basic abc") is None
    assert main.parse_bearer_token("Bearer token123") == "token123"

    salt1, hash1 = main.hash_password("abc123")
    salt2, hash2 = main.hash_password("abc123", salt1)

    assert salt1 == salt2
    assert hash1 == hash2
    assert len(salt1) == 32
    assert len(hash1) == 64


def test_parse_allowed_origins_and_generate_code_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    parsed = main.parse_allowed_origins("http://a.com/, http://b.com , ,http://c.com")
    assert parsed == ["http://a.com", "http://b.com", "http://c.com"]

    calls = iter([list("ABC123"), list("ZZZ999")])
    monkeypatch.setattr(main.random, "choices", lambda alphabet, k: next(calls))
    monkeypatch.setattr(main, "session_exists", lambda code: code == "ABC123")

    code = main.generate_session_code()
    assert code == "ZZZ999"


def test_confusion_metrics_and_analytics_payload() -> None:
    session = main.RuntimeSession(code="ROOM01", teacher_name="Teacher", created_at_epoch=10)
    teacher = main.ClientState(client_id="t", websocket=None, role="teacher", name="Teacher")
    student_a = main.ClientState(client_id="s1", websocket=None, role="student", name="Alice")
    student_b = main.ClientState(client_id="s2", websocket=None, role="student", name="Bob")

    student_a.last_confusion_vote_at = 100
    student_b.last_confusion_vote_at = 150
    session.clients = {"t": teacher, "s1": student_a, "s2": student_b}
    session.break_votes = {"s1"}

    snapshot = main.confusion_snapshot(session, now_epoch=160)
    assert snapshot["student_count"] == 2
    assert snapshot["active_students"] == 2
    assert 0 < snapshot["level_percent"] <= 100

    metrics = main.metrics_payload(session)
    assert metrics["break_votes"] == 1
    assert metrics["student_count"] == 2
    assert metrics["break_ratio"] == 0.5

    session.current_quiz = main.QuizPayload(
        question="Q",
        options=[
            main.QuizOption(id="A", text="1"),
            main.QuizOption(id="B", text="2"),
            main.QuizOption(id="C", text="3"),
            main.QuizOption(id="D", text="4"),
        ],
        correct_option_id="B",
    )
    session.quiz_answers = {"s1": "B", "s2": "A"}
    analytics = main.analytics_for_session(session)
    assert analytics["quiz"]["total_answers"] == 2
    assert analytics["quiz"]["correct_answers"] == 1
    assert analytics["engagement"]["score"] >= 0


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


def test_sessions_library_quizzes_end_and_report_pdf(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    token, user = register_user(client, email="owner@example.com", display_name="Owner")
    student_token, _ = register_user(
        client,
        email="quizstudent@example.com",
        display_name="Quiz Student",
        role="student",
    )

    create = client.post(
        "/api/sessions",
        json={"teacher_name": "Owner"},
        headers=auth_headers(token),
    )
    assert create.status_code == 200
    code = create.json()["code"]

    sessions = client.get("/api/library/sessions", headers=auth_headers(token))
    assert sessions.status_code == 200
    assert sessions.json()["sessions"][0]["code"] == code

    save_invalid = client.post(
        "/api/quizzes/save",
        headers=auth_headers(token),
        json={
            "session_code": code,
            "question": "Q",
            "options": [
                {"id": "A", "text": "One"},
                {"id": "B", "text": "Two"},
                {"id": "C", "text": "Three"},
                {"id": "D", "text": "Four"},
            ],
            "correct_option_id": "Z",
        },
    )
    assert save_invalid.status_code == 400

    save_ok = client.post(
        "/api/quizzes/save",
        headers=auth_headers(token),
        json={
            "session_code": code,
            "question": "What is 2+2?",
            "options": [
                {"id": "A", "text": "3"},
                {"id": "B", "text": "4"},
                {"id": "C", "text": "5"},
                {"id": "D", "text": "22"},
            ],
            "correct_option_id": "B",
        },
    )
    assert save_ok.status_code == 200
    saved_quiz_id = save_ok.json()["id"]

    list_quizzes = client.get("/api/quizzes", headers=auth_headers(token))
    assert list_quizzes.status_code == 200
    assert len(list_quizzes.json()["quizzes"]) == 1
    assert list_quizzes.json()["quizzes"][0]["answer_revealed"] is True

    # Simulate an active live quiz bound to the saved quiz id: answers must stay hidden.
    session = main.SESSIONS[code]
    session.current_quiz_saved_id = saved_quiz_id
    session.quiz_voting_closed = False
    session.quiz_hidden = False

    owner_live_view = client.get(f"/api/quizzes?session_code={code}", headers=auth_headers(token))
    assert owner_live_view.status_code == 200
    owner_live_quiz = owner_live_view.json()["quizzes"][0]
    assert owner_live_quiz["is_live"] is True
    assert owner_live_quiz["answer_revealed"] is False
    assert owner_live_quiz["correct_option_id"] is None

    student_live_view = client.get(f"/api/quizzes?session_code={code}", headers=auth_headers(student_token))
    assert student_live_view.status_code == 200
    student_live_quiz = student_live_view.json()["quizzes"][0]
    assert student_live_quiz["is_live"] is True
    assert student_live_quiz["answer_revealed"] is False
    assert student_live_quiz["correct_option_id"] is None

    # Once host closes/finishes voting, correct answer becomes visible again.
    session.quiz_voting_closed = True
    student_closed_view = client.get(f"/api/quizzes?session_code={code}", headers=auth_headers(student_token))
    assert student_closed_view.status_code == 200
    student_closed_quiz = student_closed_view.json()["quizzes"][0]
    assert student_closed_quiz["is_live"] is False
    assert student_closed_quiz["answer_revealed"] is True
    assert student_closed_quiz["correct_option_id"] == "B"

    analytics = client.get(f"/api/sessions/{code}/analytics")
    assert analytics.status_code == 200

    end = client.post(f"/api/sessions/{code}/end")
    assert end.status_code == 200
    assert end.json()["analytics"]["session_code"] == code

    monkeypatch.setattr(main, "build_analytics_insights_with_ai", lambda report: {
        "title": "Insights",
        "executive_summary": "Summary",
        "key_findings": ["A"],
        "risks": ["B"],
        "recommendations": ["C"],
    })
    monkeypatch.setattr(main, "generate_session_report_pdf", lambda report, insights: b"%PDF-1.7\n")

    report = client.get(f"/api/sessions/{code}/report.pdf")
    assert report.status_code == 200
    assert report.headers["content-type"].startswith("application/pdf")
    assert report.content.startswith(b"%PDF")


def test_upload_list_download_and_notes_png_access_control(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    owner_token, owner_user = register_user(client, email="owner2@example.com", display_name="Host")
    student_token, student_user = register_user(
        client,
        email="student@example.com",
        display_name="Learner",
        role="student",
    )

    create = client.post(
        "/api/sessions",
        json={"teacher_name": "Host"},
        headers=auth_headers(owner_token),
    )
    code = create.json()["code"]

    upload = client.post(
        "/api/presentations",
        headers=auth_headers(owner_token),
        data={"session_code": code},
        files={"file": ("lesson.txt", b"This is lesson content.", "text/plain")},
    )
    assert upload.status_code == 200, upload.text
    item = upload.json()
    presentation_id = item["id"]

    own_list = client.get(f"/api/presentations?session_code={code}", headers=auth_headers(owner_token))
    assert own_list.status_code == 200
    assert len(own_list.json()["presentations"]) == 1

    student_list = client.get(f"/api/presentations?session_code={code}", headers=auth_headers(student_token))
    assert student_list.status_code == 200
    assert len(student_list.json()["presentations"]) == 1

    download = client.get(
        f"/api/presentations/{presentation_id}/download?session_code={code}",
        headers=auth_headers(student_token),
    )
    assert download.status_code == 200
    assert download.content == b"This is lesson content."

    monkeypatch.setattr(main, "extract_text_from_presentation", lambda *args, **kwargs: "Extracted")
    monkeypatch.setattr(main, "build_student_notes_with_ai", lambda *args, **kwargs: "Notes")
    monkeypatch.setattr(main, "render_notes_png", lambda *args, **kwargs: b"PNGDATA")

    notes_png = client.post(
        f"/api/presentations/{presentation_id}/notes-png?session_code={code}",
        headers=auth_headers(owner_token),
    )
    assert notes_png.status_code == 200
    assert notes_png.headers["content-type"].startswith("image/png")
    assert notes_png.content == b"PNGDATA"


def test_websocket_join_confusion_and_break_vote_signals(client: TestClient) -> None:
    create = client.post("/api/sessions", json={"teacher_name": "Teacher"})
    code = create.json()["code"]

    with client.websocket_connect(f"/ws/{code}?role=student&name=Alice") as student_ws:
        # read welcome and initial states
        student_ws.receive_json()
        student_ws.receive_json()
        student_ws.receive_json()
        student_ws.receive_json()

        student_ws.send_json({"type": "confusion", "payload": {}})
        msg1 = student_ws.receive_json()
        
        student_ws.send_json({"type": "break_vote", "payload": {}})
        msg2 = student_ws.receive_json()
        
        session = main.SESSIONS[code]
        assert len(session.break_votes) > 0
        assert any(c.confusion_signals_sent > 0 for c in session.clients.values() if c.role == "student")



from starlette.websockets import WebSocketDisconnect

def test_websocket_invalid_role_or_unknown_session(client: TestClient) -> None:
    create = client.post("/api/sessions", json={"teacher_name": "Teacher"})
    code = create.json()["code"]

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/{code}?role=bad&name=Nope"):
            pass

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/UNKNOWN?role=student&name=Nope"):
            pass
