from __future__ import annotations

from app import state
from app.models import QuizOption, QuizPayload
from app.services.analytics import analytics_for_session


def test_confusion_metrics_and_analytics_payload() -> None:
    session = state.RuntimeSession(code="ROOM01", teacher_name="Teacher", created_at_epoch=10)
    teacher = state.ClientState(client_id="t", websocket=None, role="teacher", name="Teacher")
    student_a = state.ClientState(client_id="s1", websocket=None, role="student", name="Alice")
    student_b = state.ClientState(client_id="s2", websocket=None, role="student", name="Bob")

    student_a.last_confusion_vote_at = 100
    student_b.last_confusion_vote_at = 150
    session.clients = {"t": teacher, "s1": student_a, "s2": student_b}
    session.break_votes = {"s1"}

    snapshot = state.confusion_snapshot(session, now_epoch=160)
    assert snapshot["student_count"] == 2
    assert snapshot["active_students"] == 2
    assert 0 < snapshot["level_percent"] <= 100

    metrics = state.metrics_payload(session)
    assert metrics["break_votes"] == 1
    assert metrics["student_count"] == 2
    assert metrics["break_ratio"] == 0.5

    session.current_quiz = QuizPayload(
        question="Q",
        options=[
            QuizOption(id="A", text="1"),
            QuizOption(id="B", text="2"),
            QuizOption(id="C", text="3"),
            QuizOption(id="D", text="4"),
        ],
        correct_option_id="B",
    )
    session.quiz_answers = {"s1": "B", "s2": "A"}
    analytics = analytics_for_session(session)
    assert analytics["quiz"]["total_answers"] == 2
    assert analytics["quiz"]["correct_answers"] == 1
    assert analytics["engagement"]["score"] >= 0
