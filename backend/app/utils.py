import secrets
from datetime import datetime, timezone
from hashlib import pbkdf2_hmac


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    password_hash = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return salt.hex(), password_hash.hex()


def create_auth_token() -> str:
    return secrets.token_urlsafe(32)
