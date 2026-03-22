from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import state
from app.services import analytics, pdf_report
from tests.conftest import auth_headers, register_user


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
    session = state.SESSIONS[code]
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

    analytics_resp = client.get(f"/api/sessions/{code}/analytics")
    assert analytics_resp.status_code == 200

    end = client.post(f"/api/sessions/{code}/end")
    assert end.status_code == 200
    assert end.json()["analytics"]["session_code"] == code

    monkeypatch.setattr(analytics, "build_analytics_insights_with_ai", lambda report: {
        "title": "Insights",
        "executive_summary": "Summary",
        "key_findings": ["A"],
        "risks": ["B"],
        "recommendations": ["C"],
    })
    monkeypatch.setattr(pdf_report, "generate_session_report_pdf", lambda report, insights: b"%PDF-1.7\n")

    report = client.get(f"/api/sessions/{code}/report.pdf")
    assert report.status_code == 200
    assert report.headers["content-type"].startswith("application/pdf")
    assert report.content.startswith(b"%PDF")
