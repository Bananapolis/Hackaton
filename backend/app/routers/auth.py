import json
import sqlite3
from typing import Any
from urllib.request import Request, urlopen

from fastapi import APIRouter, Header, HTTPException
from urllib.error import HTTPError

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
from fastapi.responses import RedirectResponse
from urllib.parse import urlencode

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
    conn = sqlite3.connect(config.DB_PATH)
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


@router.post("/api/auth/login", response_model=AuthResponse)
def login(payload: AuthLoginRequest) -> AuthResponse:
    email = payload.email.strip().lower()
    password = payload.password

    conn = sqlite3.connect(config.DB_PATH)
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
        token_req = Request(
            "https://github.com/login/oauth/access_token",
            data=json.dumps({
                "client_id": config.GITHUB_CLIENT_ID,
                "client_secret": config.GITHUB_CLIENT_SECRET,
                "code": code,
            }).encode(),
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(token_req, timeout=10) as resp:
            token_data = json.loads(resp.read())
    except Exception:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=github_token_failed")

    access_token = token_data.get("access_token")
    if not access_token:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=github_no_token")

    try:
        user_req = Request(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
        with urlopen(user_req, timeout=10) as resp:
            gh_user = json.loads(resp.read())
    except Exception:
        return RedirectResponse(f"{config.FRONTEND_URL}?oauth_error=github_user_failed")

    email = gh_user.get("email")
    if not email:
        try:
            email_req = Request(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
            )
            with urlopen(email_req, timeout=10) as resp:
                emails = json.loads(resp.read())
            for e in emails:
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
        req = Request(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {payload.access_token}"},
        )
        with urlopen(req, timeout=10) as resp:
            info = json.loads(resp.read())
    except HTTPError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google token") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Google token verification failed") from exc

    email = info.get("email")
    if not email or not info.get("email_verified"):
        raise HTTPException(status_code=400, detail="Google account email not verified")

    display_name = info.get("name") or email.split("@")[0]
    user, token = database.upsert_oauth_user(email.strip().lower(), display_name)
    return AuthResponse(token=token, user=UserPublic(**user))
