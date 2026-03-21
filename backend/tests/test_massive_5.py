import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_missing_methods():
    client.post("/api/metrics")
    client.get("/api/metrics")
    client.post("/api/sessions/history")
    client.get("/api/users/profile")
    client.get("/api/auth/profile")

