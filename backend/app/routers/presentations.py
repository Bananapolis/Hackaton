import sqlite3
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse

from app import config
from app.dependencies import require_user
from app.models import PresentationItem
from app.services import ai, documents
from app.utils import now_iso

router = APIRouter()


def get_accessible_presentation_row(
    cursor: sqlite3.Cursor,
    *,
    user: dict[str, Any],
    presentation_id: int,
    normalized_session_code: str | None,
) -> sqlite3.Row | None:
    if normalized_session_code:
        cursor.execute("SELECT teacher_name, owner_user_id FROM sessions WHERE code = ?", (normalized_session_code,))
        session_row = cursor.fetchone()
        if not session_row:
            raise HTTPException(status_code=404, detail="Session not found")

        session_owner_id = session_row["owner_user_id"]
        is_session_owner = (
            (session_owner_id is not None and session_owner_id == user["id"])
            or (session_owner_id is None and session_row["teacher_name"] == user["display_name"])
        )
        if is_session_owner:
            cursor.execute(
                """
                SELECT id, session_code, original_name, stored_name, mime_type
                FROM presentations
                WHERE id = ? AND user_id = ?
                """,
                (presentation_id, user["id"]),
            )
        else:
            cursor.execute(
                """
                SELECT p.id, p.session_code, p.original_name, p.stored_name, p.mime_type
                FROM presentations p
                JOIN sessions s ON s.code = p.session_code
                JOIN users u ON u.id = p.user_id
                WHERE p.id = ?
                  AND p.session_code = ?
                  AND (
                      (s.owner_user_id IS NOT NULL AND s.owner_user_id = u.id)
                      OR (s.owner_user_id IS NULL AND s.teacher_name = u.display_name)
                  )
                """,
                (presentation_id, normalized_session_code),
            )
    else:
        cursor.execute(
            """
            SELECT id, session_code, original_name, stored_name, mime_type
            FROM presentations
            WHERE id = ? AND user_id = ?
            """,
            (presentation_id, user["id"]),
        )
    return cursor.fetchone()


@router.post("/api/presentations", response_model=PresentationItem)
async def upload_presentation(
    file: UploadFile = File(...),
    session_code: str = Form(""),
    authorization: str | None = Header(default=None),
) -> PresentationItem:
    user = require_user(authorization)

    normalized_session_code = session_code.strip().upper()
    if not normalized_session_code:
        raise HTTPException(status_code=400, detail="session_code is required")

    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT code, teacher_name, owner_user_id FROM sessions WHERE code = ?",
        (normalized_session_code,),
    )
    session_row = cursor.fetchone()
    conn.close()
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")
    session_owner_id = session_row["owner_user_id"]
    is_owner = (
        (session_owner_id is not None and session_owner_id == user["id"])
        or (session_owner_id is None and session_row["teacher_name"] == user["display_name"])
    )
    if not is_owner:
        raise HTTPException(status_code=403, detail="You can only upload files for your own sessions")

    original_name = (file.filename or "presentation").strip() or "presentation"
    extension = Path(original_name).suffix
    safe_extension = extension[:10] if extension else ""
    stored_name = f"{uuid.uuid4().hex}{safe_extension}"
    file_path = config.UPLOADS_DIR / stored_name

    raw = await file.read()
    size_bytes = len(raw)
    if size_bytes <= 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if size_bytes > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 50MB limit")

    file_path.write_bytes(raw)
    created_at = now_iso()

    conn = sqlite3.connect(config.DB_PATH)
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


@router.get("/api/presentations")
def list_presentations(
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
                SELECT p.id, p.session_code, p.original_name, p.mime_type, p.size_bytes, p.created_at
                FROM presentations p
                WHERE p.user_id = ?
                  AND p.session_code = ?
                ORDER BY datetime(p.created_at) DESC
                """,
                (user["id"], normalized_session_code),
            )
        else:
            cursor.execute(
                """
                SELECT p.id, p.session_code, p.original_name, p.mime_type, p.size_bytes, p.created_at
                FROM presentations p
                JOIN sessions s ON s.code = p.session_code
                JOIN users u ON u.id = p.user_id
                WHERE p.session_code = ?
                  AND (
                      (s.owner_user_id IS NOT NULL AND s.owner_user_id = u.id)
                      OR (s.owner_user_id IS NULL AND s.teacher_name = u.display_name)
                  )
                ORDER BY datetime(p.created_at) DESC
                """,
                (normalized_session_code,),
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


@router.get("/api/presentations/{presentation_id}/download")
def download_presentation(
    presentation_id: int,
    session_code: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> FileResponse:
    user = require_user(authorization)
    normalized_session_code = (session_code or "").strip().upper() or None

    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    row = get_accessible_presentation_row(
        cursor,
        user=user,
        presentation_id=presentation_id,
        normalized_session_code=normalized_session_code,
    )
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Presentation not found")

    file_path = config.UPLOADS_DIR / row["stored_name"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Stored file is missing")

    return FileResponse(
        path=file_path,
        filename=row["original_name"],
        media_type=row["mime_type"] or "application/octet-stream",
    )


@router.post("/api/presentations/{presentation_id}/notes-png")
def generate_presentation_notes_png(
    presentation_id: int,
    session_code: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> Response:
    user = require_user(authorization)
    normalized_session_code = (session_code or "").strip().upper() or None

    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    row = get_accessible_presentation_row(
        cursor,
        user=user,
        presentation_id=presentation_id,
        normalized_session_code=normalized_session_code,
    )
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Presentation not found")

    file_path = config.UPLOADS_DIR / row["stored_name"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Stored file is missing")

    try:
        extracted_text = documents.extract_text_from_presentation(
            file_path,
            row["original_name"],
            row["mime_type"],
        )
        notes_text = ai.build_student_notes_with_ai(extracted_text, row["original_name"])
        png_bytes = documents.render_notes_png(
            title=f"Student Notes: {Path(row['original_name']).stem}",
            notes_text=notes_text,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_stem = Path(row["original_name"]).stem.replace('"', "").strip()[:70] or "presentation"
    download_name = f"{safe_stem}-student-notes.png"
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "Cache-Control": "no-store",
        },
    )
