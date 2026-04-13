from typing import Any

from fastapi import HTTPException

from app.utils import parse_bearer_token
from app.database import get_user_by_token


def require_user(authorization: str | None) -> dict[str, Any]:
    token = parse_bearer_token(authorization)
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user
