import asyncio
import json
import sqlite3
import time
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import config, database, state
from app.services import ai, analytics
from app.utils import now_iso

router = APIRouter()


async def send_json(ws: WebSocket, payload: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(payload))


async def broadcast(session: state.RuntimeSession, payload: dict[str, Any], *, role: str | None = None) -> None:
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


@router.websocket("/ws/{code}")
async def websocket_room(websocket: WebSocket, code: str, role: str, name: str, token: str | None = None) -> None:
    code = code.upper()
    role = role.lower().strip()
    name = name.strip()

    if role not in {"teacher", "student"} or not name:
        await websocket.close(code=1008, reason="Invalid role or name")
        return

    session = state.SESSIONS.get(code)
    if not session or not session.active:
        await websocket.close(code=1008, reason="Unknown session code")
        return

    auth_user = database.get_user_by_token(token) if token else None
    participant_key = f"user:{auth_user['id']}" if auth_user else f"guest:{role}:{name.lower()}"

    await websocket.accept()

    if role == "teacher" and state.get_teacher(session):
        await websocket.close(code=1008, reason="Teacher already connected")
        return

    client_id = str(uuid.uuid4())
    client_state = state.ClientState(
        client_id=client_id,
        websocket=websocket,
        role=role,
        name=name,
        participant_key=participant_key,
        user_id=auth_user["id"] if auth_user else None,
    )
    session.clients[client_id] = client_state
    session.recent_presence.pop(participant_key, None)
    analytics.record_engagement_point(session, "participant_joined")

    database.insert_event(code, "join", {"client_id": client_id, "role": role, "name": name})

    await send_json(
        websocket,
        {
            "type": "welcome",
            "payload": {
                "client_id": client_id,
                "session_code": code,
                **state.session_state_payload(session),
            },
        },
    )

    await send_json(
        websocket,
        {
            "type": "session_state",
            "payload": state.session_state_payload(session),
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
            "payload": state.metrics_payload(session),
        },
    )

    if role == "student":
        teacher = state.get_teacher(session)
        if teacher:
            await send_json(
                teacher.websocket,
                {
                    "type": "student_joined",
                    "payload": {"student_id": client_id, "name": name},
                },
            )
    elif role == "teacher":
        await send_json(
            websocket,
            {
                "type": "anonymous_questions",
                "payload": state.anonymous_questions_payload(session),
            },
        )

    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)
            msg_type = message.get("type")
            payload = message.get("payload", {})
            client_state.last_active_at = time.time()

            # Detect natural break expiry and reset the focus-period timer
            if session.break_active_until and time.time() > session.break_active_until:
                session.break_active_until = None
                session.break_votes.clear()
                session.focus_period_ends_at = time.time() + config.FOCUS_PERIOD_SECONDS
                await broadcast(session, {"type": "break_ended", "payload": {"reason": "expired"}})
                await broadcast(
                    session,
                    {
                        "type": "focus_timer_reset",
                        "payload": {"focus_period_ends_at": session.focus_period_ends_at},
                    },
                )
                await broadcast(session, {"type": "metrics", "payload": state.metrics_payload(session)})

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
                if not session.settings.get("confusion_signals_enabled", True):
                    continue
                try:
                    now_epoch = time.time()
                    client_state.last_confusion_vote_at = now_epoch
                    client_state.confusion_signals_sent += 1
                    client_state.last_active_at = now_epoch
                    database.insert_event(code, "confusion", {"client_id": client_id, "level": 1.0})
                    analytics.record_engagement_point(session, "confusion")
                    await broadcast(
                        session,
                        {
                            "type": "metrics",
                            "payload": state.metrics_payload(session),
                        },
                    )
                except Exception as e:
                    print("CONFUSION ERROR:", repr(e))

            elif msg_type == "break_vote":
                if role != "student":
                    continue
                if not session.settings.get("break_voting_enabled", True):
                    continue

                now = time.time()

                if now < session.focus_period_ends_at:
                    remaining = int(session.focus_period_ends_at - now)
                    mins, secs = divmod(remaining, 60)
                    await send_json(
                        websocket,
                        {
                            "type": "error",
                            "payload": {
                                "message": f"Break voting unlocks in {mins}m {secs:02d}s."
                            },
                        },
                    )
                    continue

                if session.break_active_until and now < session.break_active_until:
                    await send_json(
                        websocket,
                        {
                            "type": "error",
                            "payload": {"message": "A break is already in progress."},
                        },
                    )
                    continue

                if now - client_state.last_break_vote_at < config.BREAK_COOLDOWN_SECONDS:
                    await send_json(
                        websocket,
                        {
                            "type": "error",
                            "payload": {
                                "message": f"Break vote cooldown active ({config.BREAK_COOLDOWN_SECONDS}s)."
                            },
                        },
                    )
                    continue

                client_state.last_break_vote_at = now
                client_state.break_votes_cast += 1
                client_state.last_active_at = now
                session.break_votes.add(client_id)
                database.insert_event(code, "break_vote", {"client_id": client_id})
                analytics.record_engagement_point(session, "break_vote")

                student_count = max(session.student_count, 1)
                ratio = len(session.break_votes) / student_count

                await broadcast(
                    session,
                    {
                        "type": "metrics",
                        "payload": state.metrics_payload(session),
                    },
                )

                threshold_pct = session.settings.get("break_vote_threshold_percent", config.BREAK_THRESHOLD_PERCENT * 100)
                if ratio >= threshold_pct / 100:
                    teacher = state.get_teacher(session)
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
                session.focus_period_ends_at = 0.0
                database.insert_event(code, "break_start", {"duration_seconds": duration})
                analytics.record_engagement_point(session, "break_start")

                await broadcast(
                    session,
                    {
                        "type": "break_started",
                        "payload": {
                            "end_time_epoch": session.break_active_until,
                            "focus_period_ends_at": session.focus_period_ends_at,
                        },
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
                    session.focus_period_ends_at = time.time() + config.FOCUS_PERIOD_SECONDS
                    database.insert_event(code, "break_cancelled", {"by": client_id})
                    analytics.record_engagement_point(session, "break_cancelled")
                    await broadcast(session, {"type": "break_ended", "payload": {"reason": "cancelled"}})
                    await broadcast(
                        session,
                        {
                            "type": "focus_timer_reset",
                            "payload": {"focus_period_ends_at": session.focus_period_ends_at},
                        },
                    )
                    await broadcast(
                        session,
                        {
                            "type": "metrics",
                            "payload": state.metrics_payload(session),
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
                    updated_end = min(updated_end, now_epoch + config.MAX_BREAK_DURATION_SECONDS)

                    if updated_end <= now_epoch + 1:
                        session.break_active_until = None
                        session.break_votes.clear()
                        session.focus_period_ends_at = now_epoch + config.FOCUS_PERIOD_SECONDS
                        database.insert_event(code, "break_adjusted", {"delta_seconds": delta_seconds, "ended": True})
                        analytics.record_engagement_point(session, "break_adjusted_end")
                        await broadcast(session, {"type": "break_ended", "payload": {"reason": "adjusted_to_zero"}})
                        await broadcast(
                            session,
                            {
                                "type": "focus_timer_reset",
                                "payload": {"focus_period_ends_at": session.focus_period_ends_at},
                            },
                        )
                        await broadcast(
                            session,
                            {
                                "type": "metrics",
                                "payload": state.metrics_payload(session),
                            },
                        )
                    else:
                        session.break_active_until = updated_end
                        database.insert_event(
                            code,
                            "break_adjusted",
                            {
                                "delta_seconds": delta_seconds,
                                "end_time_epoch": session.break_active_until,
                            },
                        )
                        analytics.record_engagement_point(session, "break_adjusted")
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
                database.insert_event(code, "note_update", {"len": len(session.notes)})
                await broadcast(session, {"type": "notes", "payload": {"text": session.notes}})

            elif msg_type == "update_settings":
                if role != "teacher":
                    continue
                allowed_keys = {
                    "break_voting_enabled", "break_vote_threshold_percent",
                    "confusion_signals_enabled", "confusion_notification_threshold_percent",
                    "anonymous_questions_enabled", "quizzes_enabled",
                    "screen_explain_enabled", "notifications_enabled",
                    "student_rewind_enabled", "student_screenshot_enabled",
                }
                for key in allowed_keys:
                    if key in payload:
                        val = payload[key]
                        if key.endswith("_enabled") and isinstance(val, bool):
                            session.settings[key] = val
                        elif key.endswith("_percent") and isinstance(val, (int, float)):
                            session.settings[key] = max(10, min(100, int(val)))
                await broadcast(session, {"type": "session_state", "payload": state.session_state_payload(session)})

            elif msg_type == "screen_share_stopped":
                if role != "teacher":
                    continue
                database.insert_event(code, "screen_share_stopped", {"client_id": client_id})
                await broadcast(
                    session,
                    {
                        "type": "screen_share_stopped",
                        "payload": {},
                    },
                    role="student",
                )

            elif msg_type == "stream_bridge_active":
                if role != "teacher":
                    continue
                active = bool(payload.get("active", False))
                database.insert_event(code, "stream_bridge_active", {"active": active})
                await broadcast(
                    session,
                    {
                        "type": "stream_bridge_active",
                        "payload": {"active": active},
                    },
                    role="student",
                )

            elif msg_type == "ask_question":
                if role != "student":
                    continue
                if not session.settings.get("anonymous_questions_enabled", True):
                    continue

                text = str(payload.get("text", "")).strip()
                if not text:
                    await send_json(
                        websocket,
                        {
                            "type": "error",
                            "payload": {
                                "message": "Question text is required.",
                            },
                        },
                    )
                    continue

                question = state.AnonymousQuestion(
                    id=uuid.uuid4().hex[:12],
                    text=text[:600],
                    created_at=now_iso(),
                )
                session.anonymous_questions.append(question)
                client_state.last_active_at = time.time()
                database.insert_event(
                    code,
                    "anonymous_question_submitted",
                    {
                        "question_id": question.id,
                        "text_len": len(question.text),
                    },
                )

                await send_json(
                    websocket,
                    {
                        "type": "anonymous_question_submitted",
                        "payload": {
                            "question_id": question.id,
                        },
                    },
                )

                teacher = state.get_teacher(session)
                if teacher:
                    await send_json(
                        teacher.websocket,
                        {
                            "type": "anonymous_questions",
                            "payload": state.anonymous_questions_payload(session),
                        },
                    )

            elif msg_type == "resolve_question":
                if role != "teacher":
                    continue

                question_id = str(payload.get("question_id", "")).strip()
                if not question_id:
                    continue

                changed = False
                for question in session.anonymous_questions:
                    if question.id != question_id:
                        continue
                    if not question.resolved:
                        question.resolved = True
                        question.resolved_at = now_iso()
                        changed = True
                    break

                if not changed:
                    continue

                database.insert_event(
                    code,
                    "anonymous_question_resolved",
                    {
                        "question_id": question_id,
                    },
                )
                await send_json(
                    websocket,
                    {
                        "type": "anonymous_questions",
                        "payload": state.anonymous_questions_payload(session),
                    },
                )

            elif msg_type == "generate_quiz":
                if role != "teacher":
                    continue
                notes_override = str(payload.get("notes", "")).strip()
                notes_input = notes_override if notes_override else session.notes
                style_preset = str(payload.get("quiz_preset", "default")).strip().lower() or "default"
                custom_prompt = str(payload.get("quiz_custom_prompt", "")).strip()
                try:
                    quiz = await asyncio.wait_for(
                        asyncio.to_thread(
                            ai.build_quiz_with_ai,
                            notes_input,
                            style_preset,
                            custom_prompt,
                        ),
                        timeout=config.AI_QUIZ_GENERATION_TIMEOUT_SECONDS,
                    )
                except (asyncio.TimeoutError, Exception):
                    quiz = ai.build_quiz_fallback(notes_input)
                session.current_quiz = quiz
                session.current_quiz_saved_id = None
                session.quiz_answers.clear()
                session.quiz_hidden = False
                session.quiz_cover_mode = True
                session.quiz_voting_closed = False
                session.quiz_answer_revealed = False
                conn = sqlite3.connect(config.DB_PATH)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT owner_user_id FROM sessions WHERE code = ?", (code,))
                owner_row = cursor.fetchone()
                conn.close()
                owner_user_id = owner_row["owner_user_id"] if owner_row else None
                if owner_user_id:
                    try:
                        saved_quiz = database.save_quiz_for_user(
                            user_id=owner_user_id,
                            session_code=code,
                            quiz=quiz,
                        )
                        session.current_quiz_saved_id = saved_quiz.id
                    except Exception:
                        session.current_quiz_saved_id = None
                analytics.record_engagement_point(session, "quiz_generated")
                database.insert_event(
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
                            "answer_revealed": session.quiz_answer_revealed,
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
                if "answer_revealed" in payload:
                    session.quiz_answer_revealed = bool(payload.get("answer_revealed"))
                    if session.quiz_answer_revealed:
                        session.quiz_voting_closed = True

                per_option: dict[str, dict[str, Any]] | None = None
                if session.quiz_answer_revealed and session.current_quiz:
                    total = len(session.quiz_answers)
                    per_option = {}
                    for opt in session.current_quiz.options:
                        count = sum(1 for v in session.quiz_answers.values() if v == opt.id)
                        per_option[opt.id] = {
                            "count": count,
                            "pct": round(count / total, 3) if total else 0.0,
                        }

                database.insert_event(
                    code,
                    "quiz_control",
                    {
                        "hidden": session.quiz_hidden,
                        "cover_mode": session.quiz_cover_mode,
                        "voting_closed": session.quiz_voting_closed,
                        "answer_revealed": session.quiz_answer_revealed,
                    },
                )
                analytics.record_engagement_point(session, "quiz_control")

                broadcast_payload: dict[str, Any] = {
                    "hidden": session.quiz_hidden,
                    "cover_mode": session.quiz_cover_mode,
                    "voting_closed": session.quiz_voting_closed,
                    "answer_revealed": session.quiz_answer_revealed,
                }
                if session.quiz_answer_revealed and session.current_quiz:
                    broadcast_payload["correct_option_id"] = session.current_quiz.correct_option_id
                    broadcast_payload["per_option"] = per_option
                await broadcast(
                    session,
                    {
                        "type": "quiz_state",
                        "payload": broadcast_payload,
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
                client_state.quiz_answers_submitted += 1
                if option_id == session.current_quiz.correct_option_id:
                    client_state.quiz_correct_answers += 1
                client_state.last_active_at = time.time()
                database.insert_event(code, "quiz_answer", {"client_id": client_id, "option_id": option_id})
                analytics.record_engagement_point(session, "quiz_answer")

                summary = analytics.analytics_for_session(session)["quiz"]
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
                        "payload": analytics.analytics_for_session(session),
                    },
                )

            elif msg_type == "request_state":
                await send_json(
                    websocket,
                    {
                        "type": "session_state",
                        "payload": state.session_state_payload(session),
                    },
                )
                if role == "teacher":
                    await send_json(
                        websocket,
                        {
                            "type": "anonymous_questions",
                            "payload": state.anonymous_questions_payload(session),
                        },
                    )

            elif msg_type == "explain_screen":
                if role != "student":
                    continue

                notes_override = str(payload.get("notes", "")).strip()
                notes_input = notes_override if notes_override else session.notes

                try:
                    explanation = await asyncio.to_thread(
                        ai.build_screen_explanation_with_ai, notes_input
                    )
                except Exception as exc:
                    reason = str(exc)[:500]
                    database.insert_event(code, "screen_explanation_failed", {"client_id": client_id, "reason": reason})
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

                database.insert_event(code, "screen_explanation_generated", {"client_id": client_id})
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
        now_epoch = time.time()
        session.recent_presence[participant_key] = state.RecentPresence(
            participant_key=participant_key,
            role=role,
            name=name,
            disconnected_at=now_epoch,
            last_active_at=max(client_state.last_active_at, now_epoch),
            user_id=auth_user["id"] if auth_user else None,
        )
        for key in list(session.recent_presence.keys()):
            presence = session.recent_presence.get(key)
            if presence and not state.is_presence_rejoin_eligible(presence, now_epoch=now_epoch):
                session.recent_presence.pop(key, None)

        analytics.record_engagement_point(session, "participant_left")
        database.insert_event(code, "leave", {"client_id": client_id, "role": role, "name": name})
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
                "payload": state.metrics_payload(session),
            },
        )

        if role == "student":
            teacher = state.get_teacher(session)
            if teacher:
                await send_json(
                    teacher.websocket,
                    {
                        "type": "student_left",
                        "payload": {"student_id": client_id},
                    },
                )
