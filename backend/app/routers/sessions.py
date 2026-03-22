import sqlite3
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response

from app import config, database, state
from app.dependencies import require_user
from app.models import SessionCreateRequest, SessionCreateResponse
from app.services import analytics, pdf_report
from app.utils import now_iso, parse_bearer_token

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": now_iso()}


@router.post("/api/sessions", response_model=SessionCreateResponse)
def create_session(payload: SessionCreateRequest, authorization: str | None = Header(default=None)) -> SessionCreateResponse:
    teacher_name = payload.teacher_name.strip()
    if not teacher_name:
        raise HTTPException(status_code=400, detail="teacher_name is required")

    user = database.get_user_by_token(parse_bearer_token(authorization))
    owner_user_id = user["id"] if user else None

    code = state.generate_session_code()
    state.SESSIONS[code] = state.RuntimeSession(code=code, teacher_name=teacher_name)
    analytics.record_engagement_point(state.SESSIONS[code], "session_created")
    database.insert_session(code, teacher_name, owner_user_id=owner_user_id)
    return SessionCreateResponse(code=code)


@router.get("/api/sessions/{code}/analytics")
def session_analytics(code: str) -> dict[str, Any]:
    session = state.SESSIONS.get(code.upper())
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return analytics.analytics_for_session(session)


@router.post("/api/sessions/{code}/end")
async def end_session(code: str) -> dict[str, Any]:
    from app.routers.websocket import broadcast

    code = code.upper()
    session = state.SESSIONS.get(code)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.final_report is not None:
        return session.final_report

    session.active = False
    import time
    session.ended_at_epoch = time.time()
    analytics.record_engagement_point(session, "session_ended")
    database.set_session_active(code, False)

    report = analytics.build_full_analytics_report(session)
    session.final_report = report

    database.insert_event(
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


@router.get("/api/sessions/{code}/report.pdf")
def download_session_report_pdf(code: str) -> Response:
    code = code.upper()
    session = state.SESSIONS.get(code)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    report = session.final_report if session.final_report is not None else analytics.build_full_analytics_report(session)
    if session.final_report_insights is None:
        session.final_report_insights = analytics.build_analytics_insights_with_ai(report)

    pdf_bytes = pdf_report.generate_session_report_pdf(report, session.final_report_insights)
    filename = f"session-{code}-analytics-report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/library/sessions")
def list_library_sessions(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT code, created_at, teacher_name, active
        FROM sessions
        WHERE owner_user_id = ? OR (owner_user_id IS NULL AND teacher_name = ?)
        ORDER BY datetime(created_at) DESC
        LIMIT 100
        """,
        (user["id"], user["display_name"]),
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"sessions": rows}
