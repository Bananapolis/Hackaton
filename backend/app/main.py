import json
import os
import random
import sqlite3
import string
import time
import uuid
from base64 import b64decode
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH = BASE_DIR / "data.sqlite3"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
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


class QuizOption(BaseModel):
    id: str
    text: str


class QuizPayload(BaseModel):
    question: str
    options: list[QuizOption]
    correct_option_id: str


@dataclass
class ClientState:
    client_id: str
    websocket: WebSocket
    role: str
    name: str
    joined_at: float = field(default_factory=time.time)
    last_break_vote_at: float = 0.0


@dataclass
class RuntimeSession:
    code: str
    teacher_name: str
    clients: dict[str, ClientState] = field(default_factory=dict)
    confusion_count: int = 0
    break_votes: set[str] = field(default_factory=set)
    break_active_until: float | None = None
    notes: str = ""
    current_quiz: QuizPayload | None = None
    quiz_answers: dict[str, str] = field(default_factory=dict)
    quiz_hidden: bool = False
    quiz_cover_mode: bool = True
    quiz_voting_closed: bool = False

    @property
    def student_count(self) -> int:
        return sum(1 for c in self.clients.values() if c.role == "student")


SESSIONS: dict[str, RuntimeSession] = {}
BREAK_COOLDOWN_SECONDS = 30
BREAK_THRESHOLD_PERCENT = 0.4


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


def build_quiz_with_ai(notes: str, screenshot_data_url: str | None = None) -> QuizPayload:
    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    errors: list[str] = []

    if gemini_api_key:
        prompt = (
            "Generate exactly one multiple choice question with 4 options based on lecture notes and screenshot context. "
            "Return JSON only with keys: question, options, correct_option_id. "
            "options must be an array of objects with keys id (A/B/C/D) and text."
        )

        parts: list[dict[str, Any]] = [
            {
                "text": f"Lecture notes:\n{notes or 'No notes provided.'}\n\n{prompt}",
            }
        ]

        if screenshot_data_url and screenshot_data_url.startswith("data:"):
            try:
                header, b64_payload = screenshot_data_url.split(",", 1)
                mime_type = header.split(";")[0].replace("data:", "") or "image/jpeg"
                # Validate base64 payload before sending.
                b64decode(b64_payload, validate=True)
                parts.append(
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": b64_payload,
                        }
                    }
                )
            except Exception:
                pass

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

        prompt = (
            "Generate exactly one multiple choice question with 4 options based on lecture notes. "
            "Return JSON only with keys: question, options, correct_option_id. "
            "options must be an array of objects with keys id (A/B/C/D) and text."
        )

        user_content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": f"Lecture notes:\n{notes or 'No notes provided.'}\n\n{prompt}",
            }
        ]
        if screenshot_data_url:
            user_content.append(
                {
                    "type": "input_image",
                    "image_url": screenshot_data_url,
                    "detail": "low",
                }
            )

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


def analytics_for_session(session: RuntimeSession) -> dict[str, Any]:
    answers = session.quiz_answers.values()
    total_answers = len(session.quiz_answers)
    correct_answers = 0
    if session.current_quiz:
        correct_answers = sum(1 for answer in answers if answer == session.current_quiz.correct_option_id)

    accuracy = (correct_answers / total_answers) if total_answers else 0.0

    return {
        "session_code": session.code,
        "teacher_name": session.teacher_name,
        "student_count": session.student_count,
        "confusion_count": session.confusion_count,
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
        "notes": session.notes,
    }


app = FastAPI(title="Edu Engagement MVP API", version="1.0.0")

allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]
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


@app.websocket("/ws/{code}")
async def websocket_room(websocket: WebSocket, code: str, role: str, name: str) -> None:
    code = code.upper()
    role = role.lower().strip()
    name = name.strip()

    if role not in {"teacher", "student"} or not name:
        await websocket.close(code=1008, reason="Invalid role or name")
        return

    session = SESSIONS.get(code)
    if not session:
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
                "notes": session.notes,
                "break_active_until": session.break_active_until,
                "quiz": session.current_quiz.model_dump() if session.current_quiz else None,
                "quiz_state": {
                    "hidden": session.quiz_hidden,
                    "cover_mode": session.quiz_cover_mode,
                    "voting_closed": session.quiz_voting_closed,
                },
            },
        },
    )

    await broadcast(
        session,
        {
            "type": "participant_joined",
            "payload": {"client_id": client_id, "role": role, "name": name},
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
                session.confusion_count += 1
                insert_event(code, "confusion", {"client_id": client_id})
                await broadcast(
                    session,
                    {
                        "type": "metrics",
                        "payload": {
                            "confusion_count": session.confusion_count,
                            "break_votes": len(session.break_votes),
                            "student_count": session.student_count,
                        },
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
                session.break_votes.add(client_id)
                insert_event(code, "break_vote", {"client_id": client_id})

                student_count = max(session.student_count, 1)
                ratio = len(session.break_votes) / student_count

                await broadcast(
                    session,
                    {
                        "type": "metrics",
                        "payload": {
                            "confusion_count": session.confusion_count,
                            "break_votes": len(session.break_votes),
                            "student_count": session.student_count,
                            "break_ratio": round(ratio, 3),
                        },
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
                screenshot_data_url = str(payload.get("screenshot_data_url", "")).strip() or None
                try:
                    quiz = build_quiz_with_ai(notes_input, screenshot_data_url=screenshot_data_url)
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
                insert_event(code, "quiz_generated", quiz.model_dump())
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

                session.quiz_answers[client_id] = option_id
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
