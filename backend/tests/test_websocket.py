from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import state
from tests.conftest import receive_until_type


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

        # Unlock break voting by clearing the focus period lock
        state.SESSIONS[code].focus_period_ends_at = 0.0

        student_ws.send_json({"type": "break_vote", "payload": {}})
        msg2 = student_ws.receive_json()

        session = state.SESSIONS[code]
        assert len(session.break_votes) > 0
        assert any(c.confusion_signals_sent > 0 for c in session.clients.values() if c.role == "student")


def test_websocket_anonymous_question_submit_and_resolve(client: TestClient) -> None:
    create = client.post("/api/sessions", json={"teacher_name": "Teacher"})
    assert create.status_code == 200
    code = create.json()["code"]

    with client.websocket_connect(f"/ws/{code}?role=teacher&name=Teacher") as teacher_ws:
        receive_until_type(teacher_ws, "anonymous_questions")

        with client.websocket_connect(f"/ws/{code}?role=student&name=Alice") as student_ws:
            receive_until_type(student_ws, "session_state")

            student_ws.send_json({"type": "ask_question", "payload": {"text": "Can you repeat the last formula?"}})
            submitted = receive_until_type(student_ws, "anonymous_question_submitted")
            assert submitted["payload"]["question_id"]

            teacher_questions = receive_until_type(teacher_ws, "anonymous_questions")
            assert teacher_questions["payload"]["pending_count"] == 1
            assert len(teacher_questions["payload"]["questions"]) == 1
            question_item = teacher_questions["payload"]["questions"][0]
            assert question_item["text"] == "Can you repeat the last formula?"
            assert question_item["resolved"] is False

            teacher_ws.send_json(
                {
                    "type": "resolve_question",
                    "payload": {"question_id": question_item["id"]},
                }
            )
            resolved_state = receive_until_type(teacher_ws, "anonymous_questions")
            assert resolved_state["payload"]["pending_count"] == 0
            assert resolved_state["payload"]["questions"][0]["resolved"] is True

            session = state.SESSIONS[code]
            assert len(session.anonymous_questions) == 1
            assert session.anonymous_questions[0].resolved is True


def test_websocket_invalid_role_or_unknown_session(client: TestClient) -> None:
    create = client.post("/api/sessions", json={"teacher_name": "Teacher"})
    code = create.json()["code"]

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/{code}?role=bad&name=Nope"):
            pass

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/UNKNOWN?role=student&name=Nope"):
            pass
