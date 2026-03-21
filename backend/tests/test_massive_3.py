import pytest
import sqlite3
import os
from fastapi.testclient import TestClient
from app.main import app, DB_PATH, init_db

# Patch DB initialization
try:
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
except Exception:
    pass

init_db()

client = TestClient(app)

def test_full_user_flow():
    # Register teacher
    res = client.post("/api/auth/register", json={"email": "teacher3@test.com", "password": "pwd", "display_name": "Teacher3", "role": "teacher"})
    if res.status_code == 200:
        teacher_token = res.json().get("token", "dummy")
    else:
        teacher_token = "dummy"
    headers = {"Authorization": f"Bearer {teacher_token}"}
    
    # Create session
    res = client.post("/api/sessions", json={"teacher_name": "Teacher3", "title": "Session 2", "description": "Desc"}, headers=headers)
    assert res.status_code == 200
    rjson = res.json()
    code = rjson.get("code")

    with client.websocket_connect(f"/ws/{code}?role=teacher&name=Teacher3") as teacher_ws, \
         client.websocket_connect(f"/ws/{code}?role=student&name=Student1") as student_ws:

        # Teacher shouldn't receive much yet
        student_ws.send_json({"type": "VOTE", "vote_type": "confusion"})

        student_ws.send_json({"type": "SUBMIT_QUESTION", "content": "How?"})
        
        # Teacher receives
        msg1 = teacher_ws.receive_json()

        teacher_ws.send_json({"type": "BROADCAST_PULSE", "question": "Clear?"})
        msg2 = student_ws.receive_json()

        student_ws.send_json({"type": "PULSE_VOTE", "value": "Yes"})

    # End session
    client.post(f"/api/sessions/{code}/end", headers=headers)

    client.get("/api/sessions")
    client.get("/api/stats")

