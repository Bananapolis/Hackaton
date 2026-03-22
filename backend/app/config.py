import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

DB_PATH = BASE_DIR / "data.sqlite3"
UPLOADS_DIR = BASE_DIR / "uploads"

# AI
AI_QUIZ_GENERATION_TIMEOUT_SECONDS = 45.0

# OAuth
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "").strip()
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "").strip()
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").strip().rstrip("/")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:9000").strip().rstrip("/")

# Session behavior
FOCUS_PERIOD_SECONDS = 1800
CONFUSION_DECAY_SECONDS = 90.0
CONFUSION_ACTIVE_THRESHOLD = 0.2
BREAK_COOLDOWN_SECONDS = 30
BREAK_THRESHOLD_PERCENT = 0.4
MAX_BREAK_DURATION_SECONDS = 3600


def parse_allowed_origins(raw: str) -> list[str]:
    origins: list[str] = []
    for origin in raw.split(","):
        normalized = origin.strip().rstrip("/")
        if normalized:
            origins.append(normalized)
    return origins
