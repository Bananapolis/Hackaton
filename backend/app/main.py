import json
import os
import random
import secrets
import sqlite3
import string
import time
import uuid
from hashlib import pbkdf2_hmac
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


BASE_DIR = Path(__file__).resolve().parents[1]
# Always read the backend-local .env file, regardless of the process working directory.
load_dotenv(BASE_DIR / ".env")
DB_PATH = BASE_DIR / "data.sqlite3"
UPLOADS_DIR = BASE_DIR / "uploads"


def parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    password_hash = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return salt.hex(), password_hash.hex()


def create_auth_token() -> str:
    return secrets.token_urlsafe(32)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            code TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            teacher_name TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1
        )
        """
    )
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
    conn.commit()
    conn.close()


def insert_session(code: str, teacher_name: str) -> None:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO sessions(code, created_at, teacher_name, active) VALUES (?, ?, ?, 1)",
        (code, now_iso(), teacher_name),
    )
    conn.commit()
    conn.close()


def insert_event(session_code: str, event_type: str, payload: dict[str, Any]) -> None:
    conn = sqlite3.connect(DB_PATH)
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
    conn = sqlite3.connect(DB_PATH)
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


def require_user(authorization: str | None) -> dict[str, Any]:
    token = parse_bearer_token(authorization)
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def set_session_active(code: str, active: bool) -> None:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("UPDATE sessions SET active = ? WHERE code = ?", (1 if active else 0, code))
    conn.commit()
    conn.close()


def session_exists(code: str) -> bool:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT code FROM sessions WHERE code = ? AND active = 1", (code,))
    row = cursor.fetchone()
    conn.close()
    return row is not None


class SessionCreateRequest(BaseModel):
    teacher_name: str


class SessionCreateResponse(BaseModel):
    code: str


class AuthRegisterRequest(BaseModel):
    email: str
    display_name: str
    password: str
    role: str


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class UserPublic(BaseModel):
    id: int
    email: str
    display_name: str
    role: str


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class PresentationItem(BaseModel):
    id: int
    session_code: str | None
    original_name: str
    mime_type: str
    size_bytes: int
    created_at: str
    download_url: str


class QuizOption(BaseModel):
    id: str
    text: str


class QuizPayload(BaseModel):
    question: str
    options: list[QuizOption]
    correct_option_id: str


class SavedQuizCreateRequest(BaseModel):
    session_code: str | None = None
    question: str
    options: list[QuizOption]
    correct_option_id: str


class SavedQuizItem(BaseModel):
    id: int
    session_code: str | None
    question: str
    options: list[QuizOption]
    correct_option_id: str
    created_at: str


@dataclass
class ClientState:
    client_id: str
    websocket: WebSocket
    role: str
    name: str
    joined_at: float = field(default_factory=time.time)
    last_break_vote_at: float = 0.0
    last_confusion_vote_at: float | None = None
    confusion_signals_sent: int = 0
    break_votes_cast: int = 0
    quiz_answers_submitted: int = 0
    quiz_correct_answers: int = 0
    last_active_at: float = field(default_factory=time.time)


@dataclass
class RuntimeSession:
    code: str
    teacher_name: str
    created_at_epoch: float = field(default_factory=time.time)
    clients: dict[str, ClientState] = field(default_factory=dict)
    break_votes: set[str] = field(default_factory=set)
    break_active_until: float | None = None
    notes: str = ""
    current_quiz: QuizPayload | None = None
    quiz_answers: dict[str, str] = field(default_factory=dict)
    quiz_hidden: bool = False
    quiz_cover_mode: bool = True
    quiz_voting_closed: bool = False
    active: bool = True
    ended_at_epoch: float | None = None
    final_report: dict[str, Any] | None = None

    @property
    def student_count(self) -> int:
        return sum(1 for c in self.clients.values() if c.role == "student")


CONFUSION_DECAY_SECONDS = 90.0
CONFUSION_ACTIVE_THRESHOLD = 0.2


def current_student_confusion_level(student: ClientState, now_epoch: float) -> float:
    if student.role != "student" or student.last_confusion_vote_at is None:
        return 0.0

    elapsed = max(0.0, now_epoch - student.last_confusion_vote_at)
    return max(0.0, 1.0 - (elapsed / CONFUSION_DECAY_SECONDS))


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
        if level >= CONFUSION_ACTIVE_THRESHOLD:
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
    return {
        "notes": session.notes,
        "break_active_until": session.break_active_until,
        "quiz": session.current_quiz.model_dump() if session.current_quiz else None,
        "quiz_state": {
            "hidden": session.quiz_hidden,
            "cover_mode": session.quiz_cover_mode,
            "voting_closed": session.quiz_voting_closed,
        },
        "metrics": metrics_payload(session),
    }


SESSIONS: dict[str, RuntimeSession] = {}
BREAK_COOLDOWN_SECONDS = 30
BREAK_THRESHOLD_PERCENT = 0.4
MAX_BREAK_DURATION_SECONDS = 3600


def generate_session_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(alphabet, k=6))
        if code not in SESSIONS and not session_exists(code):
            return code


def get_teacher(session: RuntimeSession) -> ClientState | None:
    for c in session.clients.values():
        if c.role == "teacher":
            return c
    return None


async def send_json(ws: WebSocket, payload: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(payload))


async def broadcast(session: RuntimeSession, payload: dict[str, Any], *, role: str | None = None) -> None:
    dead_clients: list[str] = []
    for client_id, client in session.clients.items():
        if role is not None and client.role != role:
            continue
        try:
            await send_json(client.websocket, payload)
        except Exception:
            dead_clients.append(client_id)

    for dead in dead_clients:
        session.clients.pop(dead, None)


def build_quiz_fallback(notes: str) -> QuizPayload:
    topic = (notes or "the current lecture").strip()
    if len(topic) > 70:
        topic = topic[:70] + "..."

    correct_id = "B"
    return QuizPayload(
        question=f"Which statement best summarizes {topic}?",
        options=[
            QuizOption(id="A", text="It is unrelated to the lesson topic."),
            QuizOption(id="B", text="It captures a key concept from the current lecture."),
            QuizOption(id="C", text="It should be ignored because it has no practical use."),
            QuizOption(id="D", text="It only applies to historical systems and not today."),
        ],
        correct_option_id=correct_id,
    )


QUIZ_PRESET_INSTRUCTIONS = {
    "default": "Create a clear concept-check question focused on the most important idea from the current context.",
    "funny": "Write a light, classroom-safe question with a subtle playful tone, while staying educational and accurate.",
    "challenge": "Write a challenging question that requires deeper reasoning, not just recall.",
    "misconception": "Target a common misconception and use plausible distractors that reveal misunderstanding.",
    "real_world": "Frame the question around a practical real-world scenario or application.",
}


def compose_quiz_generation_prompt(style_preset: str, custom_prompt: str) -> str:
    normalized_preset = (style_preset or "default").strip().lower()
    style_instruction = QUIZ_PRESET_INSTRUCTIONS.get(
        normalized_preset,
        QUIZ_PRESET_INSTRUCTIONS["default"],
    )
    custom_instruction = custom_prompt.strip()

    prompt = (
        "Generate exactly one multiple choice question with 4 options (A, B, C, D) based on lecture notes. "
        "Use the selected style instruction below. "
        "Keep all options similarly sized and similarly specific, so the correct answer is NOT obvious from option length, detail level, wording style, or formatting cues. "
        "Distractors must be plausible and non-joke unless style explicitly allows a playful tone. "
        "Do not add explanations.")

    prompt += f"\n\nStyle instruction:\n{style_instruction}"
    if custom_instruction:
        prompt += f"\n\nAdditional teacher instruction:\n{custom_instruction}"

    prompt += (
        "\n\nReturn JSON only with keys: question, options, correct_option_id. "
        "options must be an array of exactly 4 objects with keys id and text, and ids must be A, B, C, D. "
        "correct_option_id must be one of A, B, C, D."
    )
    return prompt


def build_quiz_with_ai(
    notes: str,
    style_preset: str = "default",
    custom_prompt: str = "",
) -> QuizPayload:
    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    errors: list[str] = []

    if gemini_api_key:
        prompt = compose_quiz_generation_prompt(style_preset, custom_prompt)

        parts: list[dict[str, Any]] = [
            {
                "text": f"Lecture notes:\n{notes or 'No notes provided.'}\n\n{prompt}",
            }
        ]

        models_to_try = [gemini_model]
        if gemini_model != "gemini-2.5-flash":
            models_to_try.append("gemini-2.5-flash")

        for model_name in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_api_key}"
            body = {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                },
            }

            try:
                req = Request(
                    url,
                    data=json.dumps(body).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urlopen(req, timeout=20) as resp:
                    response_text = resp.read().decode("utf-8")
                response_json = json.loads(response_text)
                text_output = (
                    response_json.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                    .strip()
                )
                if not text_output:
                    raise ValueError("Gemini returned an empty response")

                if text_output.startswith("```"):
                    text_output = text_output.strip("`")
                    if text_output.lower().startswith("json"):
                        text_output = text_output[4:].strip()

                parsed = json.loads(text_output)
                return QuizPayload(**parsed)
            except HTTPError as exc:
                details = ""
                try:
                    details = exc.read().decode("utf-8", errors="ignore")
                except Exception:
                    details = ""
                details = (details or exc.reason or "request failed")
                errors.append(f"Gemini model {model_name} HTTP {exc.code}: {details[:300]}")
            except (URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError) as exc:
                errors.append(f"Gemini model {model_name} error: {str(exc)[:300]}")

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    base_url = os.getenv("OPENAI_BASE_URL", "").strip() or None

    if api_key and OpenAI is not None:
        client = OpenAI(api_key=api_key, base_url=base_url)

        prompt = compose_quiz_generation_prompt(style_preset, custom_prompt)

        user_content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": f"Lecture notes:\n{notes or 'No notes provided.'}\n\n{prompt}",
            }
        ]
        try:
            response = client.responses.create(
                model=model,
                input=[
                    {
                        "role": "system",
                        "content": "You produce concise, educational quizzes in strict JSON.",
                    },
                    {
                        "role": "user",
                        "content": user_content,
                    },
                ],
                temperature=0.2,
            )

            text_output = response.output_text.strip()
            if not text_output:
                raise ValueError("OpenAI-compatible provider returned an empty response")

            if text_output.startswith("```"):
                text_output = text_output.strip("`")
                if text_output.lower().startswith("json"):
                    text_output = text_output[4:].strip()

            parsed = json.loads(text_output)
            return QuizPayload(**parsed)
        except Exception as exc:
            errors.append(f"OpenAI-compatible error: {str(exc)[:300]}")
    elif api_key and OpenAI is None:
        errors.append("OpenAI-compatible API key is set but OpenAI SDK is unavailable")

    if not gemini_api_key and not api_key:
        raise RuntimeError("No AI provider configured. Set GEMINI_API_KEY (recommended).")

    if errors:
        raise RuntimeError("; ".join(errors))

    raise RuntimeError("Quiz generation failed with unknown AI error")


def build_screen_explanation_with_ai(notes: str) -> str:
    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    errors: list[str] = []

    if gemini_api_key:
        prompt = (
            "Explain what the teacher is currently showing in simple student-friendly language. "
            "Keep it concise (about 4-7 sentences), include the likely goal of the slide/screen, "
            "and suggest one practical thing the student should focus on next."
        )

        parts: list[dict[str, Any]] = [
            {
                "text": f"Lecture notes:\n{notes or 'No notes provided.'}\n\n{prompt}",
            }
        ]

        models_to_try = [gemini_model]
        if gemini_model != "gemini-2.5-flash":
            models_to_try.append("gemini-2.5-flash")

        for model_name in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_api_key}"
            body = {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {
                    "temperature": 0.2,
                },
            }

            try:
                req = Request(
                    url,
                    data=json.dumps(body).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urlopen(req, timeout=20) as resp:
                    response_text = resp.read().decode("utf-8")
                response_json = json.loads(response_text)
                text_output = (
                    response_json.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                    .strip()
                )
                if text_output:
                    return text_output[:1400]
                raise ValueError("Gemini returned an empty explanation")
            except HTTPError as exc:
                details = ""
                try:
                    details = exc.read().decode("utf-8", errors="ignore")
                except Exception:
                    details = ""
                details = (details or exc.reason or "request failed")
                errors.append(f"Gemini model {model_name} HTTP {exc.code}: {details[:300]}")
            except (URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError) as exc:
                errors.append(f"Gemini model {model_name} error: {str(exc)[:300]}")

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    base_url = os.getenv("OPENAI_BASE_URL", "").strip() or None

    if api_key and OpenAI is not None:
        client = OpenAI(api_key=api_key, base_url=base_url)

        user_content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": (
                    "Explain what the teacher is currently showing in simple student-friendly language. "
                    "Keep it concise (about 4-7 sentences), include the likely goal of the slide/screen, "
                    "and suggest one practical thing the student should focus on next.\n\n"
                    f"Lecture notes:\n{notes or 'No notes provided.'}"
                ),
            }
        ]
        try:
            response = client.responses.create(
                model=model,
                input=[
                    {
                        "role": "system",
                        "content": "You explain live lecture visuals in concise and supportive language.",
                    },
                    {
                        "role": "user",
                        "content": user_content,
                    },
                ],
                temperature=0.2,
            )

            text_output = response.output_text.strip()
            if text_output:
                return text_output[:1400]
            raise ValueError("OpenAI-compatible provider returned an empty explanation")
        except Exception as exc:
            errors.append(f"OpenAI-compatible error: {str(exc)[:300]}")
    elif api_key and OpenAI is None:
        errors.append("OpenAI-compatible API key is set but OpenAI SDK is unavailable")

    if not gemini_api_key and not api_key:
        raise RuntimeError("No AI provider configured. Set GEMINI_API_KEY (recommended).")

    if errors:
        raise RuntimeError("; ".join(errors))

    raise RuntimeError("Screen explanation failed with unknown AI error")


def analytics_for_session(session: RuntimeSession) -> dict[str, Any]:
    confusion = confusion_snapshot(session)
    answers = session.quiz_answers.values()
    total_answers = len(session.quiz_answers)
    correct_answers = 0
    if session.current_quiz:
        correct_answers = sum(1 for answer in answers if answer == session.current_quiz.correct_option_id)

    accuracy = (correct_answers / total_answers) if total_answers else 0.0
    active_students = confusion["student_count"]
    break_vote_rate = (len(session.break_votes) / active_students) if active_students else 0.0
    quiz_participation_rate = (total_answers / active_students) if active_students else 0.0
    confusion_per_student = confusion["average_level"] if active_students else 0.0

    score_raw = (
        min(quiz_participation_rate, 1.0) * 0.55
        + min(break_vote_rate / BREAK_THRESHOLD_PERCENT, 1.0) * 0.25
        + min(confusion_per_student, 1.0) * 0.20
    )
    engagement_score = int(round(score_raw * 100))

    end_epoch = session.ended_at_epoch if session.ended_at_epoch is not None else time.time()
    duration_seconds = max(0, int(end_epoch - session.created_at_epoch))

    return {
        "session_code": session.code,
        "teacher_name": session.teacher_name,
        "session_active": session.active,
        "duration_seconds": duration_seconds,
        "student_count": active_students,
        "confusion_count": confusion["level_percent"],
        "confusion_level_percent": confusion["level_percent"],
        "confusion_active_students": confusion["active_students"],
        "break_votes": len(session.break_votes),
        "break_active": bool(session.break_active_until and session.break_active_until > time.time()),
        "quiz": {
            "total_answers": total_answers,
            "correct_answers": correct_answers,
            "accuracy": round(accuracy, 3),
            "hidden": session.quiz_hidden,
            "cover_mode": session.quiz_cover_mode,
            "voting_closed": session.quiz_voting_closed,
        },
        "engagement": {
            "score": engagement_score,
            "quiz_participation_rate": round(quiz_participation_rate, 3),
            "break_vote_rate": round(break_vote_rate, 3),
            "confusion_per_student": round(confusion_per_student, 3),
        },
        "notes": session.notes,
    }


def build_full_analytics_report(session: RuntimeSession) -> dict[str, Any]:
    analytics = analytics_for_session(session)
    students_connected = []
    now_epoch = time.time()
    for client in session.clients.values():
        if client.role != "student":
            continue
        students_connected.append(
            {
                "client_id": client.client_id,
                "name": client.name,
                "joined_at_epoch": round(client.joined_at, 3),
                "time_in_session_seconds": max(0, int(now_epoch - client.joined_at)),
            }
        )

    return {
        "report_type": "session_engagement",
        "generated_at": now_iso(),
        "analytics": analytics,
        "students_connected": students_connected,
    }


app = FastAPI(title="Edu Engagement MVP API", version="1.0.0")


def parse_allowed_origins(raw: str) -> list[str]:
    origins: list[str] = []
    for origin in raw.split(","):
        normalized = origin.strip().rstrip("/")
        if normalized:
            origins.append(normalized)
    return origins


allowed_origins = parse_allowed_origins(
    os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": now_iso()}


@app.post("/api/auth/register", response_model=AuthResponse)
def register(payload: AuthRegisterRequest) -> AuthResponse:
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip()
    password = payload.password
    role = payload.role.strip().lower()

    if role not in {"teacher", "student"}:
        raise HTTPException(status_code=400, detail="role must be teacher or student")
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name is required")

    salt_hex, password_hash_hex = hash_password(password)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO users(email, display_name, role, password_salt, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (email, display_name, role, salt_hex, password_hash_hex, now_iso()),
        )
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=409, detail="Email is already registered")

    user_id = cursor.lastrowid
    token = create_auth_token()
    cursor.execute(
        "INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user_id, now_iso()),
    )
    conn.commit()

    cursor.execute("SELECT id, email, display_name, role FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=500, detail="User creation failed")
    user = UserPublic(**dict(row))
    return AuthResponse(token=token, user=user)


@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: AuthLoginRequest) -> AuthResponse:
    email = payload.email.strip().lower()
    password = payload.password

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, email, display_name, role, password_salt, password_hash FROM users WHERE email = ?",
        (email,),
    )
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    salt_hex, expected_hash_hex = row["password_salt"], row["password_hash"]
    _, actual_hash_hex = hash_password(password, salt_hex)
    if actual_hash_hex != expected_hash_hex:
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_auth_token()
    cursor.execute(
        "INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)",
        (token, row["id"], now_iso()),
    )
    conn.commit()
    conn.close()

    user = UserPublic(
        id=row["id"],
        email=row["email"],
        display_name=row["display_name"],
        role=row["role"],
    )
    return AuthResponse(token=token, user=user)


@app.get("/api/auth/me", response_model=UserPublic)
def auth_me(authorization: str | None = Header(default=None)) -> UserPublic:
    user = require_user(authorization)
    return UserPublic(**user)


@app.get("/api/library/sessions")
def list_library_sessions(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT code, created_at, teacher_name, active
        FROM sessions
        WHERE teacher_name = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 100
        """,
        (user["display_name"],),
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"sessions": rows}


@app.post("/api/presentations", response_model=PresentationItem)
async def upload_presentation(
    file: UploadFile = File(...),
    session_code: str = Form(""),
    authorization: str | None = Header(default=None),
) -> PresentationItem:
    user = require_user(authorization)
    if user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can upload files")

    normalized_session_code = session_code.strip().upper()
    if not normalized_session_code:
        raise HTTPException(status_code=400, detail="session_code is required")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT code, teacher_name FROM sessions WHERE code = ?",
        (normalized_session_code,),
    )
    session_row = cursor.fetchone()
    conn.close()
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")
    if session_row["teacher_name"] != user["display_name"]:
        raise HTTPException(status_code=403, detail="You can only upload files for your own sessions")

    original_name = (file.filename or "presentation").strip() or "presentation"
    extension = Path(original_name).suffix
    safe_extension = extension[:10] if extension else ""
    stored_name = f"{uuid.uuid4().hex}{safe_extension}"
    file_path = UPLOADS_DIR / stored_name

    raw = await file.read()
    size_bytes = len(raw)
    if size_bytes <= 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if size_bytes > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 50MB limit")

    file_path.write_bytes(raw)
    created_at = now_iso()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO presentations(user_id, session_code, original_name, stored_name, mime_type, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user["id"],
            normalized_session_code,
            original_name,
            stored_name,
            file.content_type or "application/octet-stream",
            size_bytes,
            created_at,
        ),
    )
    presentation_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return PresentationItem(
        id=presentation_id,
        session_code=normalized_session_code,
        original_name=original_name,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        created_at=created_at,
        download_url=f"/api/presentations/{presentation_id}/download",
    )


@app.get("/api/presentations")
def list_presentations(
    session_code: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    normalized_session_code = (session_code or "").strip().upper() or None

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    if user["role"] == "teacher":
        if normalized_session_code:
            cursor.execute(
                """
                SELECT p.id, p.session_code, p.original_name, p.mime_type, p.size_bytes, p.created_at
                FROM presentations p
                JOIN sessions s ON s.code = p.session_code
                WHERE p.user_id = ?
                  AND p.session_code = ?
                  AND s.teacher_name = ?
                ORDER BY datetime(p.created_at) DESC
                """,
                (user["id"], normalized_session_code, user["display_name"]),
            )
        else:
            cursor.execute(
                """
                SELECT id, session_code, original_name, mime_type, size_bytes, created_at
                FROM presentations
                WHERE user_id = ?
                ORDER BY datetime(created_at) DESC
                """,
                (user["id"],),
            )
    else:
        if not normalized_session_code:
            conn.close()
            raise HTTPException(status_code=400, detail="Students must provide session_code")
        cursor.execute(
            """
            SELECT p.id, p.session_code, p.original_name, p.mime_type, p.size_bytes, p.created_at
            FROM presentations p
            JOIN sessions s ON s.code = p.session_code
            JOIN users u ON u.id = p.user_id
            WHERE p.session_code = ?
              AND u.role = 'teacher'
              AND s.teacher_name = u.display_name
            ORDER BY datetime(p.created_at) DESC
            """,
            (normalized_session_code,),
        )

    items = [
        PresentationItem(
            id=row["id"],
            session_code=row["session_code"],
            original_name=row["original_name"],
            mime_type=row["mime_type"] or "application/octet-stream",
            size_bytes=row["size_bytes"],
            created_at=row["created_at"],
            download_url=f"/api/presentations/{row['id']}/download",
        ).model_dump()
        for row in cursor.fetchall()
    ]
    conn.close()
    return {"presentations": items}


@app.get("/api/presentations/{presentation_id}/download")
def download_presentation(
    presentation_id: int,
    session_code: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> FileResponse:
    user = require_user(authorization)
    normalized_session_code = (session_code or "").strip().upper() or None

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    if user["role"] == "teacher":
        cursor.execute(
            """
            SELECT id, session_code, original_name, stored_name, mime_type
            FROM presentations
            WHERE id = ? AND user_id = ?
            """,
            (presentation_id, user["id"]),
        )
    else:
        if not normalized_session_code:
            conn.close()
            raise HTTPException(status_code=400, detail="Students must provide session_code")
        cursor.execute(
            """
            SELECT p.id, p.session_code, p.original_name, p.stored_name, p.mime_type
            FROM presentations p
            JOIN sessions s ON s.code = p.session_code
            JOIN users u ON u.id = p.user_id
            WHERE p.id = ?
              AND p.session_code = ?
              AND u.role = 'teacher'
              AND s.teacher_name = u.display_name
            """,
            (presentation_id, normalized_session_code),
        )

    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Presentation not found")

    file_path = UPLOADS_DIR / row["stored_name"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Stored file is missing")

    return FileResponse(
        path=file_path,
        filename=row["original_name"],
        media_type=row["mime_type"] or "application/octet-stream",
    )


@app.post("/api/quizzes/save", response_model=SavedQuizItem)
def save_quiz(payload: SavedQuizCreateRequest, authorization: str | None = Header(default=None)) -> SavedQuizItem:
    user = require_user(authorization)
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    correct_option_id = payload.correct_option_id.strip().upper()
    options = payload.options
    valid_option_ids = {option.id.upper() for option in options}
    if correct_option_id not in valid_option_ids:
        raise HTTPException(status_code=400, detail="correct_option_id must match an option id")

    serialized_options = json.dumps([option.model_dump() for option in options])
    normalized_session_code = (payload.session_code or "").strip().upper() or None

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    created_at = now_iso()
    cursor.execute(
        """
        INSERT INTO saved_quizzes(user_id, session_code, question, options_json, correct_option_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user["id"], normalized_session_code, question, serialized_options, correct_option_id, created_at),
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


@app.get("/api/quizzes")
def list_saved_quizzes(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
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

    quizzes: list[dict[str, Any]] = []
    for row in rows:
        options_raw = json.loads(row["options_json"])
        options = [QuizOption(**item).model_dump() for item in options_raw]
        quizzes.append(
            {
                "id": row["id"],
                "session_code": row["session_code"],
                "question": row["question"],
                "options": options,
                "correct_option_id": row["correct_option_id"],
                "created_at": row["created_at"],
            }
        )

    return {"quizzes": quizzes}


@app.post("/api/sessions", response_model=SessionCreateResponse)
def create_session(payload: SessionCreateRequest) -> SessionCreateResponse:
    teacher_name = payload.teacher_name.strip()
    if not teacher_name:
        raise HTTPException(status_code=400, detail="teacher_name is required")

    code = generate_session_code()
    SESSIONS[code] = RuntimeSession(code=code, teacher_name=teacher_name)
    insert_session(code, teacher_name)
    return SessionCreateResponse(code=code)


@app.get("/api/sessions/{code}/analytics")
def session_analytics(code: str) -> dict[str, Any]:
    session = SESSIONS.get(code.upper())
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return analytics_for_session(session)


@app.post("/api/sessions/{code}/end")
async def end_session(code: str) -> dict[str, Any]:
    code = code.upper()
    session = SESSIONS.get(code)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.final_report is not None:
        return session.final_report

    session.active = False
    session.ended_at_epoch = time.time()
    set_session_active(code, False)

    report = build_full_analytics_report(session)
    session.final_report = report

    insert_event(
        code,
        "session_end",
        {
            "generated_at": report["generated_at"],
            "engagement_score": report["analytics"]["engagement"]["score"],
        },
    )

    await broadcast(
        session,
        {
            "type": "session_ended",
            "payload": report,
        },
    )

    for client in list(session.clients.values()):
        try:
            await client.websocket.close(code=1000, reason="Session ended by teacher")
        except Exception:
            pass
    session.clients.clear()

    return report


@app.websocket("/ws/{code}")
async def websocket_room(websocket: WebSocket, code: str, role: str, name: str) -> None:
    code = code.upper()
    role = role.lower().strip()
    name = name.strip()

    if role not in {"teacher", "student"} or not name:
        await websocket.close(code=1008, reason="Invalid role or name")
        return

    session = SESSIONS.get(code)
    if not session or not session.active:
        await websocket.close(code=1008, reason="Unknown session code")
        return

    await websocket.accept()

    if role == "teacher" and get_teacher(session):
        await websocket.close(code=1008, reason="Teacher already connected")
        return

    client_id = str(uuid.uuid4())
    state = ClientState(client_id=client_id, websocket=websocket, role=role, name=name)
    session.clients[client_id] = state

    insert_event(code, "join", {"client_id": client_id, "role": role, "name": name})

    await send_json(
        websocket,
        {
            "type": "welcome",
            "payload": {
                "client_id": client_id,
                "session_code": code,
                **session_state_payload(session),
            },
        },
    )

    await send_json(
        websocket,
        {
            "type": "session_state",
            "payload": session_state_payload(session),
        },
    )

    await broadcast(
        session,
        {
            "type": "participant_joined",
            "payload": {"client_id": client_id, "role": role, "name": name},
        },
    )

    await broadcast(
        session,
        {
            "type": "metrics",
            "payload": metrics_payload(session),
        },
    )

    if role == "student":
        teacher = get_teacher(session)
        if teacher:
            await send_json(
                teacher.websocket,
                {
                    "type": "student_joined",
                    "payload": {"student_id": client_id, "name": name},
                },
            )

    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)
            msg_type = message.get("type")
            payload = message.get("payload", {})

            if msg_type == "signal":
                target_id = payload.get("target_id")
                target = session.clients.get(target_id)
                if target:
                    await send_json(
                        target.websocket,
                        {
                            "type": "signal",
                            "payload": {
                                "from_id": client_id,
                                "description": payload.get("description"),
                                "candidate": payload.get("candidate"),
                            },
                        },
                    )

            elif msg_type == "confusion":
                if role != "student":
                    continue
                now_epoch = time.time()
                state.last_confusion_vote_at = now_epoch
                state.confusion_signals_sent += 1
                state.last_active_at = now_epoch
                insert_event(code, "confusion", {"client_id": client_id, "level": 1.0})
                await broadcast(
                    session,
                    {
                        "type": "metrics",
                        "payload": metrics_payload(session),
                    },
                )

            elif msg_type == "break_vote":
                if role != "student":
                    continue

                now = time.time()
                if now - state.last_break_vote_at < BREAK_COOLDOWN_SECONDS:
                    await send_json(
                        websocket,
                        {
                            "type": "error",
                            "payload": {
                                "message": f"Break vote cooldown active ({BREAK_COOLDOWN_SECONDS}s)."
                            },
                        },
                    )
                    continue

                state.last_break_vote_at = now
                state.break_votes_cast += 1
                state.last_active_at = now
                session.break_votes.add(client_id)
                insert_event(code, "break_vote", {"client_id": client_id})

                student_count = max(session.student_count, 1)
                ratio = len(session.break_votes) / student_count

                await broadcast(
                    session,
                    {
                        "type": "metrics",
                        "payload": metrics_payload(session),
                    },
                )

                if ratio >= BREAK_THRESHOLD_PERCENT:
                    teacher = get_teacher(session)
                    if teacher:
                        await send_json(
                            teacher.websocket,
                            {
                                "type": "break_threshold_reached",
                                "payload": {"ratio": round(ratio, 3), "votes": len(session.break_votes)},
                            },
                        )

            elif msg_type == "start_break":
                if role != "teacher":
                    continue

                duration = int(payload.get("duration_seconds", 300))
                duration = max(30, min(duration, 1800))
                session.break_active_until = time.time() + duration
                session.break_votes.clear()
                insert_event(code, "break_start", {"duration_seconds": duration})

                await broadcast(
                    session,
                    {
                        "type": "break_started",
                        "payload": {"end_time_epoch": session.break_active_until},
                    },
                )

            elif msg_type == "break_control":
                if role != "teacher":
                    continue

                action = str(payload.get("action", "")).strip().lower()

                if action == "cancel":
                    if not session.break_active_until:
                        continue
                    session.break_active_until = None
                    session.break_votes.clear()
                    insert_event(code, "break_cancelled", {"by": client_id})
                    await broadcast(session, {"type": "break_ended", "payload": {"reason": "cancelled"}})
                    await broadcast(
                        session,
                        {
                            "type": "metrics",
                            "payload": metrics_payload(session),
                        },
                    )
                    continue

                if action == "adjust":
                    if not session.break_active_until:
                        continue

                    try:
                        delta_seconds = int(payload.get("delta_seconds", 0))
                    except Exception:
                        delta_seconds = 0

                    if delta_seconds == 0:
                        continue

                    now_epoch = time.time()
                    current_end = max(session.break_active_until, now_epoch)
                    updated_end = max(now_epoch, current_end + delta_seconds)
                    updated_end = min(updated_end, now_epoch + MAX_BREAK_DURATION_SECONDS)

                    if updated_end <= now_epoch + 1:
                        session.break_active_until = None
                        session.break_votes.clear()
                        insert_event(code, "break_adjusted", {"delta_seconds": delta_seconds, "ended": True})
                        await broadcast(session, {"type": "break_ended", "payload": {"reason": "adjusted_to_zero"}})
                        await broadcast(
                            session,
                            {
                                "type": "metrics",
                                "payload": metrics_payload(session),
                            },
                        )
                    else:
                        session.break_active_until = updated_end
                        insert_event(
                            code,
                            "break_adjusted",
                            {
                                "delta_seconds": delta_seconds,
                                "end_time_epoch": session.break_active_until,
                            },
                        )
                        await broadcast(
                            session,
                            {
                                "type": "break_started",
                                "payload": {"end_time_epoch": session.break_active_until},
                            },
                        )
                    continue

            elif msg_type == "note_update":
                if role != "teacher":
                    continue
                session.notes = str(payload.get("text", ""))
                insert_event(code, "note_update", {"len": len(session.notes)})
                await broadcast(session, {"type": "notes", "payload": {"text": session.notes}})

            elif msg_type == "generate_quiz":
                if role != "teacher":
                    continue
                notes_override = str(payload.get("notes", "")).strip()
                notes_input = notes_override if notes_override else session.notes
                style_preset = str(payload.get("quiz_preset", "default")).strip().lower() or "default"
                custom_prompt = str(payload.get("quiz_custom_prompt", "")).strip()
                try:
                    quiz = build_quiz_with_ai(
                        notes_input,
                        style_preset=style_preset,
                        custom_prompt=custom_prompt,
                    )
                except Exception as exc:
                    reason = str(exc)[:500]
                    insert_event(code, "quiz_generation_failed", {"reason": reason})
                    await send_json(
                        websocket,
                        {
                            "type": "error",
                            "payload": {
                                "message": f"Quiz generation failed: {reason}",
                            },
                        },
                    )
                    continue
                session.current_quiz = quiz
                session.quiz_answers.clear()
                session.quiz_hidden = False
                session.quiz_cover_mode = True
                session.quiz_voting_closed = False
                insert_event(
                    code,
                    "quiz_generated",
                    {
                        **quiz.model_dump(),
                        "preset": style_preset,
                        "custom_prompt": custom_prompt,
                    },
                )
                await broadcast(session, {"type": "quiz", "payload": quiz.model_dump()})
                await broadcast(
                    session,
                    {
                        "type": "quiz_state",
                        "payload": {
                            "hidden": session.quiz_hidden,
                            "cover_mode": session.quiz_cover_mode,
                            "voting_closed": session.quiz_voting_closed,
                        },
                    },
                )

            elif msg_type == "quiz_control":
                if role != "teacher":
                    continue
                if not session.current_quiz:
                    continue

                if "hidden" in payload:
                    session.quiz_hidden = bool(payload.get("hidden"))
                if "cover_mode" in payload:
                    session.quiz_cover_mode = bool(payload.get("cover_mode"))
                if "voting_closed" in payload:
                    session.quiz_voting_closed = bool(payload.get("voting_closed"))

                insert_event(
                    code,
                    "quiz_control",
                    {
                        "hidden": session.quiz_hidden,
                        "cover_mode": session.quiz_cover_mode,
                        "voting_closed": session.quiz_voting_closed,
                    },
                )

                await broadcast(
                    session,
                    {
                        "type": "quiz_state",
                        "payload": {
                            "hidden": session.quiz_hidden,
                            "cover_mode": session.quiz_cover_mode,
                            "voting_closed": session.quiz_voting_closed,
                        },
                    },
                )

            elif msg_type == "quiz_answer":
                if role != "student" or not session.current_quiz or session.quiz_voting_closed:
                    continue

                option_id = str(payload.get("option_id", "")).upper()
                if option_id not in {"A", "B", "C", "D"}:
                    continue

                if client_id in session.quiz_answers:
                    continue

                session.quiz_answers[client_id] = option_id
                state.quiz_answers_submitted += 1
                if option_id == session.current_quiz.correct_option_id:
                    state.quiz_correct_answers += 1
                state.last_active_at = time.time()
                insert_event(code, "quiz_answer", {"client_id": client_id, "option_id": option_id})

                summary = analytics_for_session(session)["quiz"]
                await broadcast(
                    session,
                    {
                        "type": "quiz_progress",
                        "payload": summary,
                    },
                    role="teacher",
                )

            elif msg_type == "request_analytics":
                if role != "teacher":
                    continue
                await send_json(
                    websocket,
                    {
                        "type": "analytics",
                        "payload": analytics_for_session(session),
                    },
                )

            elif msg_type == "request_state":
                await send_json(
                    websocket,
                    {
                        "type": "session_state",
                        "payload": session_state_payload(session),
                    },
                )

            elif msg_type == "explain_screen":
                if role != "student":
                    continue

                notes_override = str(payload.get("notes", "")).strip()
                notes_input = notes_override if notes_override else session.notes

                try:
                    explanation = build_screen_explanation_with_ai(notes_input)
                except Exception as exc:
                    reason = str(exc)[:500]
                    insert_event(code, "screen_explanation_failed", {"client_id": client_id, "reason": reason})
                    await send_json(
                        websocket,
                        {
                            "type": "error",
                            "payload": {
                                "message": f"Screen explanation failed: {reason}",
                            },
                        },
                    )
                    continue

                insert_event(code, "screen_explanation_generated", {"client_id": client_id})
                await send_json(
                    websocket,
                    {
                        "type": "screen_explanation",
                        "payload": {
                            "text": explanation,
                            "generated_at": now_iso(),
                        },
                    },
                )

    except WebSocketDisconnect:
        pass
    finally:
        session.clients.pop(client_id, None)
        insert_event(code, "leave", {"client_id": client_id, "role": role, "name": name})
        await broadcast(
            session,
            {
                "type": "participant_left",
                "payload": {"client_id": client_id, "role": role, "name": name},
            },
        )

        await broadcast(
            session,
            {
                "type": "metrics",
                "payload": metrics_payload(session),
            },
        )

        if role == "student":
            teacher = get_teacher(session)
            if teacher:
                await send_json(
                    teacher.websocket,
                    {
                        "type": "student_left",
                        "payload": {"student_id": client_id},
                    },
                )
