import json
import sqlite3
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import RedirectResponse

from app import config, database
from app.dependencies import require_user
from app.models import (
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthResponse,
    GoogleTokenRequest,
    UserPublic,
)
from app.utils import create_auth_token, hash_password, now_iso, parse_bearer_token

router = APIRouter()


@router.post("/api/auth/register", response_model=AuthResponse)
def register(payload: AuthRegisterRequest) -> AuthResponse:
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip()
    password = payload.password
    role = (payload.role or "teacher").strip().lower()

    if role not in {"teacher", "student"}:
        raise HTTPException(status_code=400, detail="role must be teacher or student")
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name is required")

    salt_hex, password_hash_hex = hash_password(password)
    with database.get_db() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO users(email, display_name, role, password_salt, password_hash, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (email, display_name, role, salt_hex, password_hash_hex, now_iso()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Email is already registered")

        user_id = cursor.lastrowid
        token = create_auth_token()
        conn.execute(
            "INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, now_iso()),
        )
        row = conn.execute(
            "SELECT id, email, display_name, role FROM users WHERE id = ?", (user_id,)
        ).fetchone()

    if not row:
        raise HTTPException(status_code=500, detail="User creation failed")
    return AuthResponse(token=token, user=UserPublic(**dict(row)))


@router.post("/api/auth/login", response_model=AuthResponse)
def login(payload: AuthLoginRequest) -> AuthResponse:
    email = payload.email.strip().lower()
    password = payload.password

    with database.get_db() as conn:
        row = conn.execute(
            "SELECT id, email, display_name, role, password_salt, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        _, actual_hash_hex = hash_password(password, row["password_salt"])
        if actual_hash_hex != row["password_hash"]:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        token = create_auth_token()
        conn.execute(
            "INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)",
            (token, row["id"], now_iso()),
        )

    user = UserPublic(
        id=row["id"],
        email=row["email"],
        display_name=row["display_name"],
        role=row["role"],
    )
    return AuthResponse(token=token, user=user)


@router.get("/api/auth/me", response_model=UserPublic)
def auth_me(authorization: str | None = Header(default=None)) -> UserPublic:
    user = require_user(authorization)
    return UserPublic(**user)


# ---------------------------------------------------------------------------
# GitHub OAuth
# ---------------------------------------------------------------------------


@router.get("/api/auth/oauth/github")
def github_oauth_start() -> RedirectResponse:
    if not config.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=503, detail="GitHub OAuth is not configured")
    params = urlencode({
        "client_id": config.GITHUB_CLIENT_ID,
        "redirect_uri": f"{config.BACKEND_URL}/api/auth/oauth/github/callback",
        "scope": "user:email",
    })
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{params}")


@router.get("/api/auth/oauth/github/callback")
def github_oauth_callback(code: str | None = None, error: str | None = None) -> RedirectResponse:
    if error or not code:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=github_denied")
    if not config.GITHUB_CLIENT_ID or not config.GITHUB_CLIENT_SECRET:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=not_configured")

    try:
        resp = httpx.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": config.GITHUB_CLIENT_ID,
                "client_secret": config.GITHUB_CLIENT_SECRET,
                "code": code,
            },
            headers={"Accept": "application/json"},
            timeout=10.0,
        )
        token_data = resp.json()
    except Exception:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=github_token_failed")

    access_token = token_data.get("access_token")
    if not access_token:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=github_no_token")

    try:
        resp = httpx.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
            timeout=10.0,
        )
        gh_user = resp.json()
    except Exception:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=github_user_failed")

    email = gh_user.get("email")
    if not email:
        try:
            resp = httpx.get(
                "https://api.github.com/user/emails",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
                timeout=10.0,
            )
            for e in resp.json():
                if e.get("primary") and e.get("verified"):
                    email = e["email"]
                    break
        except Exception:
            pass

    if not email:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=github_no_email")

    display_name = gh_user.get("name") or gh_user.get("login") or email.split("@")[0]
    user, auth_token = database.upsert_oauth_user(email.strip().lower(), display_name)
    return RedirectResponse(f"{config.FRONTEND_URL}?oauth_token={auth_token}&oauth_user={json.dumps(user)}")


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------


@router.post("/api/auth/oauth/google", response_model=AuthResponse)
def google_oauth(payload: GoogleTokenRequest) -> AuthResponse:
    try:
        resp = httpx.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {payload.access_token}"},
            timeout=10.0,
        )
        resp.raise_for_status()
        info = resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google token") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Google token verification failed") from exc

    email = info.get("email")
    if not email or not info.get("email_verified"):
        raise HTTPException(status_code=400, detail="Google account email not verified")

    display_name = info.get("name") or email.split("@")[0]
    user, token = database.upsert_oauth_user(email.strip().lower(), display_name)
    return AuthResponse(token=token, user=UserPublic(**user))
