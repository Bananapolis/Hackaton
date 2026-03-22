import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query

from app import config, database, state
from app.dependencies import require_user
from app.models import (
    QuizOption,
    QuizPayload,
    SavedQuizCreateRequest,
    SavedQuizItem,
    SavedQuizListItem,
)

router = APIRouter()


@router.post("/api/quizzes/save", response_model=SavedQuizItem)
def save_quiz(payload: SavedQuizCreateRequest, authorization: str | None = Header(default=None)) -> SavedQuizItem:
    user = require_user(authorization)
    quiz = QuizPayload(
        question=payload.question,
        options=payload.options,
        correct_option_id=payload.correct_option_id,
    )
    try:
        return database.save_quiz_for_user(
            user_id=user["id"],
            session_code=payload.session_code,
            quiz=quiz,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/quizzes")
def list_saved_quizzes(
    session_code: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    normalized_session_code = (session_code or "").strip().upper() or None

    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    if normalized_session_code:
        cursor.execute(
            "SELECT teacher_name, owner_user_id FROM sessions WHERE code = ?",
            (normalized_session_code,),
        )
        session_row = cursor.fetchone()
        if not session_row:
            conn.close()
            raise HTTPException(status_code=404, detail="Session not found")

        session_owner_id = session_row["owner_user_id"]
        is_session_owner = (
            (session_owner_id is not None and session_owner_id == user["id"])
            or (session_owner_id is None and session_row["teacher_name"] == user["display_name"])
        )

        if is_session_owner:
            cursor.execute(
                """
                SELECT id, session_code, question, options_json, correct_option_id, created_at
                FROM saved_quizzes
                WHERE user_id = ? AND session_code = ?
                ORDER BY datetime(created_at) DESC
                """,
                (user["id"], normalized_session_code),
            )
        else:
            cursor.execute(
                """
                SELECT q.id, q.session_code, q.question, q.options_json, q.correct_option_id, q.created_at
                FROM saved_quizzes q
                JOIN sessions s ON s.code = q.session_code
                JOIN users u ON u.id = q.user_id
                WHERE q.session_code = ?
                  AND (
                    (s.owner_user_id IS NOT NULL AND s.owner_user_id = u.id)
                    OR (s.owner_user_id IS NULL AND s.teacher_name = u.display_name)
                  )
                ORDER BY datetime(q.created_at) DESC
                """,
                (normalized_session_code,),
            )
    else:
        cursor.execute(
            """
            SELECT id, session_code, question, options_json, correct_option_id, created_at
            FROM saved_quizzes
            WHERE user_id = ?
            ORDER BY datetime(created_at) DESC
            """,
            (user["id"],),
        )

    rows = cursor.fetchall()
    conn.close()

    live_saved_quiz_ids = {
        live_session.current_quiz_saved_id
        for live_session in state.SESSIONS.values()
        if live_session.current_quiz_saved_id is not None
        and not live_session.quiz_voting_closed
        and not live_session.quiz_hidden
    }

    quizzes: list[dict[str, Any]] = []
    for row in rows:
        options_raw = json.loads(row["options_json"])
        is_live = row["id"] in live_saved_quiz_ids
        answer_revealed = not is_live
        quizzes.append(
            SavedQuizListItem(
                id=row["id"],
                session_code=row["session_code"],
                question=row["question"],
                options=[QuizOption(**item) for item in options_raw],
                correct_option_id=row["correct_option_id"] if answer_revealed else None,
                answer_revealed=answer_revealed,
                is_live=is_live,
                created_at=row["created_at"],
            ).model_dump()
        )

    return {"quizzes": quizzes}
