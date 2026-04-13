from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services import ai, documents
from tests.conftest import auth_headers, register_user


def test_upload_list_download_and_notes_png_access_control(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    owner_token, owner_user = register_user(client, email="owner2@example.com", display_name="Host")
    student_token, student_user = register_user(
        client,
        email="student@example.com",
        display_name="Learner",
        role="student",
    )

    create = client.post(
        "/api/sessions",
        json={"teacher_name": "Host"},
        headers=auth_headers(owner_token),
    )
    code = create.json()["code"]

    upload = client.post(
        "/api/presentations",
        headers=auth_headers(owner_token),
        data={"session_code": code},
        files={"file": ("lesson.txt", b"This is lesson content.", "text/plain")},
    )
    assert upload.status_code == 200, upload.text
    item = upload.json()
    presentation_id = item["id"]

    own_list = client.get(f"/api/presentations?session_code={code}", headers=auth_headers(owner_token))
    assert own_list.status_code == 200
    assert len(own_list.json()["presentations"]) == 1

    student_list = client.get(f"/api/presentations?session_code={code}", headers=auth_headers(student_token))
    assert student_list.status_code == 200
    assert len(student_list.json()["presentations"]) == 1

    download = client.get(
        f"/api/presentations/{presentation_id}/download?session_code={code}",
        headers=auth_headers(student_token),
    )
    assert download.status_code == 200
    assert download.content == b"This is lesson content."

    monkeypatch.setattr(documents, "extract_text_from_presentation", lambda *args, **kwargs: "Extracted")
    monkeypatch.setattr(ai, "build_student_notes_with_ai", lambda *args, **kwargs: "Notes")
    monkeypatch.setattr(documents, "render_notes_png", lambda *args, **kwargs: b"PNGDATA")

    notes_png = client.post(
        f"/api/presentations/{presentation_id}/notes-png?session_code={code}",
        headers=auth_headers(owner_token),
    )
    assert notes_png.status_code == 200
    assert notes_png.headers["content-type"].startswith("image/png")
    assert notes_png.content == b"PNGDATA"
