import random
import string
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from app import config
from app.models import QuizPayload


@dataclass
class ClientState:
    client_id: str
    websocket: WebSocket
    role: str
    name: str
    participant_key: str = ""
    user_id: int | None = None
    joined_at: float = field(default_factory=time.time)
    last_break_vote_at: float = 0.0
    last_confusion_vote_at: float | None = None
    confusion_signals_sent: int = 0
    break_votes_cast: int = 0
    quiz_answers_submitted: int = 0
    quiz_correct_answers: int = 0
    last_active_at: float = field(default_factory=time.time)


@dataclass
class AnonymousQuestion:
    id: str
    text: str
    created_at: str
    resolved: bool = False
    resolved_at: str | None = None


@dataclass
class RecentPresence:
    participant_key: str
    role: str
    name: str
    disconnected_at: float
    last_active_at: float
    user_id: int | None = None


@dataclass
class RuntimeSession:
    code: str
    teacher_name: str
    created_at_epoch: float = field(default_factory=time.time)
    clients: dict[str, ClientState] = field(default_factory=dict)
    break_votes: set[str] = field(default_factory=set)
    break_active_until: float | None = None
    focus_period_ends_at: float = 0.0
    notes: str = ""
    current_quiz: QuizPayload | None = None
    current_quiz_saved_id: int | None = None
    quiz_answers: dict[str, str] = field(default_factory=dict)
    quiz_hidden: bool = False
    quiz_cover_mode: bool = True
    quiz_voting_closed: bool = False
    quiz_answer_revealed: bool = False
    anonymous_questions: list[AnonymousQuestion] = field(default_factory=list)
    active: bool = True
    ended_at_epoch: float | None = None
    final_report: dict[str, Any] | None = None
    final_report_insights: dict[str, Any] | None = None
    engagement_timeline: list[dict[str, Any]] = field(default_factory=list)
    recent_presence: dict[str, RecentPresence] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.focus_period_ends_at == 0.0:
            self.focus_period_ends_at = self.created_at_epoch + config.FOCUS_PERIOD_SECONDS

    @property
    def student_count(self) -> int:
        return sum(1 for c in self.clients.values() if c.role == "student")


SESSIONS: dict[str, RuntimeSession] = {}


def generate_session_code() -> str:
    from app import database

    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(alphabet, k=6))
        if code not in SESSIONS and not database.session_exists(code):
            return code


def get_teacher(session: RuntimeSession) -> ClientState | None:
    for c in session.clients.values():
        if c.role == "teacher":
            return c
    return None


def current_student_confusion_level(student: ClientState, now_epoch: float) -> float:
    if student.role != "student" or student.last_confusion_vote_at is None:
        return 0.0
    elapsed = max(0.0, now_epoch - student.last_confusion_vote_at)
    return max(0.0, 1.0 - (elapsed / config.CONFUSION_DECAY_SECONDS))


def confusion_snapshot(session: RuntimeSession, now_epoch: float | None = None) -> dict[str, Any]:
    now_epoch = now_epoch if now_epoch is not None else time.time()
    total_level = 0.0
    active_students = 0
    student_count = 0

    for client in session.clients.values():
        if client.role != "student":
            continue
        student_count += 1
        level = current_student_confusion_level(client, now_epoch)
        total_level += level
        if level >= config.CONFUSION_ACTIVE_THRESHOLD:
            active_students += 1

    average_level = (total_level / student_count) if student_count else 0.0
    level_percent = int(round(average_level * 100))
    return {
        "average_level": average_level,
        "level_percent": max(0, min(level_percent, 100)),
        "active_students": active_students,
        "student_count": student_count,
    }


def metrics_payload(session: RuntimeSession) -> dict[str, Any]:
    confusion = confusion_snapshot(session)
    student_count = confusion["student_count"]
    ratio = (len(session.break_votes) / student_count) if student_count else 0.0
    return {
        "confusion_count": confusion["level_percent"],
        "confusion_level_percent": confusion["level_percent"],
        "confusion_active_students": confusion["active_students"],
        "break_votes": len(session.break_votes),
        "student_count": student_count,
        "break_ratio": round(ratio, 3),
    }


def session_state_payload(session: RuntimeSession) -> dict[str, Any]:
    quiz_state_dict: dict[str, Any] = {
        "hidden": session.quiz_hidden,
        "cover_mode": session.quiz_cover_mode,
        "voting_closed": session.quiz_voting_closed,
        "answer_revealed": session.quiz_answer_revealed,
    }
    if session.quiz_answer_revealed and session.current_quiz:
        quiz_state_dict["correct_option_id"] = session.current_quiz.correct_option_id
        total = len(session.quiz_answers)
        per_option: dict[str, dict[str, Any]] = {}
        for opt in session.current_quiz.options:
            count = sum(1 for v in session.quiz_answers.values() if v == opt.id)
            per_option[opt.id] = {
                "count": count,
                "pct": round(count / total, 3) if total else 0.0,
            }
        quiz_state_dict["per_option"] = per_option
    return {
        "notes": session.notes,
        "break_active_until": session.break_active_until,
        "focus_period_ends_at": session.focus_period_ends_at,
        "quiz": session.current_quiz.model_dump() if session.current_quiz else None,
        "quiz_state": quiz_state_dict,
        "metrics": metrics_payload(session),
    }


def anonymous_questions_payload(session: RuntimeSession) -> dict[str, Any]:
    questions = [
        {
            "id": question.id,
            "text": question.text,
            "created_at": question.created_at,
            "resolved": question.resolved,
            "resolved_at": question.resolved_at,
        }
        for question in session.anonymous_questions
    ]
    pending_count = sum(1 for question in session.anonymous_questions if not question.resolved)
    return {
        "questions": questions,
        "pending_count": pending_count,
    }


def is_presence_rejoin_eligible(presence: RecentPresence, now_epoch: float | None = None) -> bool:
    now_epoch = now_epoch if now_epoch is not None else time.time()
    threshold = now_epoch - config.REJOIN_GRACE_SECONDS
    return presence.last_active_at >= threshold and presence.disconnected_at >= threshold
