import json
import sqlite3
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any

from app import config
from app.utils import create_auth_token, now_iso
from app.models import QuizPayload, SavedQuizItem


def init_db() -> None:
    config.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            code TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            teacher_name TEXT NOT NULL,
            owner_user_id INTEGER,
            active INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    cursor.execute("PRAGMA table_info(sessions)")
    session_columns = {row[1] for row in cursor.fetchall()}
    if "owner_user_id" not in session_columns:
        cursor.execute("ALTER TABLE sessions ADD COLUMN owner_user_id INTEGER")
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_code TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_code) REFERENCES sessions(code)
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_tokens (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS presentations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_code TEXT,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            mime_type TEXT,
            size_bytes INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    cursor.execute("PRAGMA table_info(presentations)")
    presentation_columns = {row[1] for row in cursor.fetchall()}
    if "session_code" not in presentation_columns:
        cursor.execute("ALTER TABLE presentations ADD COLUMN session_code TEXT")
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS saved_quizzes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_code TEXT,
            question TEXT NOT NULL,
            options_json TEXT NOT NULL,
            correct_option_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_cache (
            cache_key TEXT PRIMARY KEY,
            response TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.commit()
    conn.close()


def ai_cache_key(prefix: str, *parts: str) -> str:
    payload = prefix + "|" + "|".join(parts)
    return sha256(payload.encode("utf-8")).hexdigest()


def ai_cache_get(cache_key: str) -> str | None:
    conn = sqlite3.connect(config.DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT response FROM ai_cache WHERE cache_key = ? AND expires_at > ?",
            (cache_key, now_iso()),
        )
        row = cursor.fetchone()
        if row:
            cursor.execute(
                "UPDATE ai_cache SET hit_count = hit_count + 1 WHERE cache_key = ?",
                (cache_key,),
            )
            conn.commit()
            return row[0]
        return None
    finally:
        conn.close()


def ai_cache_set(cache_key: str, response: str, ttl_seconds: int = 3600) -> None:
    conn = sqlite3.connect(config.DB_PATH)
    try:
        cursor = conn.cursor()
        now = datetime.now(timezone.utc)
        expires = (now + timedelta(seconds=ttl_seconds)).isoformat()
        cursor.execute(
            """
            INSERT INTO ai_cache(cache_key, response, created_at, expires_at, hit_count)
            VALUES (?, ?, ?, ?, 0)
            ON CONFLICT(cache_key) DO UPDATE SET
                response = excluded.response,
                created_at = excluded.created_at,
                expires_at = excluded.expires_at,
                hit_count = 0
            """,
            (cache_key, response, now.isoformat(), expires),
        )
        conn.commit()
    finally:
        conn.close()


def insert_session(code: str, teacher_name: str, owner_user_id: int | None = None) -> None:
    conn = sqlite3.connect(config.DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO sessions(code, created_at, teacher_name, owner_user_id, active) VALUES (?, ?, ?, ?, 1)",
        (code, now_iso(), teacher_name, owner_user_id),
    )
    conn.commit()
    conn.close()


def insert_event(session_code: str, event_type: str, payload: dict[str, Any]) -> None:
    conn = sqlite3.connect(config.DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO events(session_code, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
        (session_code, event_type, json.dumps(payload), now_iso()),
    )
    conn.commit()
    conn.close()


def get_user_by_token(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT u.id, u.email, u.display_name, u.role
        FROM auth_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token = ?
        """,
        (token,),
    )
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def set_session_active(code: str, active: bool) -> None:
    conn = sqlite3.connect(config.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("UPDATE sessions SET active = ? WHERE code = ?", (1 if active else 0, code))
    conn.commit()
    conn.close()


def session_exists(code: str) -> bool:
    conn = sqlite3.connect(config.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT code FROM sessions WHERE code = ?", (code,))
    row = cursor.fetchone()
    conn.close()
    return row is not None


def upsert_oauth_user(email: str, display_name: str) -> tuple[dict[str, Any], str]:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, display_name, role FROM users WHERE email = ?", (email,))
    row = cursor.fetchone()
    if row:
        user_id = row["id"]
        user = dict(row)
    else:
        cursor.execute(
            "INSERT INTO users(email, display_name, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (email, display_name, "teacher", "", "", now_iso()),
        )
        user_id = cursor.lastrowid
        cursor.execute("SELECT id, email, display_name, role FROM users WHERE id = ?", (user_id,))
        user = dict(cursor.fetchone())
    token = create_auth_token()
    cursor.execute(
        "INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user_id, now_iso()),
    )
    conn.commit()
    conn.close()
    return user, token


def save_quiz_for_user(
    *,
    user_id: int,
    session_code: str | None,
    quiz: QuizPayload,
) -> SavedQuizItem:
    question = quiz.question.strip()
    if not question:
        raise ValueError("question is required")

    correct_option_id = quiz.correct_option_id.strip().upper()
    options = quiz.options
    valid_option_ids = {option.id.upper() for option in options}
    if correct_option_id not in valid_option_ids:
        raise ValueError("correct_option_id must match an option id")

    serialized_options = json.dumps([option.model_dump() for option in options])
    normalized_session_code = (session_code or "").strip().upper() or None

    conn = sqlite3.connect(config.DB_PATH)
    cursor = conn.cursor()
    created_at = now_iso()
    cursor.execute(
        """
        INSERT INTO saved_quizzes(user_id, session_code, question, options_json, correct_option_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, normalized_session_code, question, serialized_options, correct_option_id, created_at),
    )
    quiz_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return SavedQuizItem(
        id=quiz_id,
        session_code=normalized_session_code,
        question=question,
        options=options,
        correct_option_id=correct_option_id,
        created_at=created_at,
    )
