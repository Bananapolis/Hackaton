import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_massive_endpoints():
    endpoints = [
        ("GET", "/health"),
        ("GET", "/api/v1/sessions"),
        ("GET", "/api/v1/sessions/1"),
        ("GET", "/api/v1/users"),
        ("POST", "/api/v1/login"),
        ("POST", "/api/v1/register"),
        ("GET", "/api/v1/some-invalid-endpoint"),
        ("POST", "/api/v1/sessions/1/vote"),
        ("GET", "/api/v1/students"),
        ("GET", "/api/v1/teachers"),
        ("POST", "/api/v1/sessions/1/end"),
        ("POST", "/api/v1/sessions/1/start"),
        ("POST", "/api/v1/sessions/1/questions"),
    ]
    for method, url in endpoints:
        if method == "GET":
            client.get(url)
        elif method == "POST":
            client.post(url, json={})
