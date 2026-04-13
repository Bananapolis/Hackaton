from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Paths
    db_path: Path = BASE_DIR / "data.sqlite3"
    uploads_dir: Path = BASE_DIR / "uploads"

    # AI
    ai_quiz_generation_timeout_seconds: float = 45.0
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_image_model: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = ""

    # TURN / WebRTC
    turn_public_host: str = ""
    turn_username: str = ""
    turn_password: str = ""

    # OAuth
    github_client_id: str = ""
    github_client_secret: str = ""
    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:9000"

    # CORS
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Session behaviour
    focus_period_seconds: int = 1800
    confusion_decay_seconds: float = 90.0
    confusion_active_threshold: float = 0.2
    break_cooldown_seconds: int = 30
    break_threshold_percent: float = 0.4
    max_break_duration_seconds: int = 3600
    rejoin_grace_seconds: int = 90

    @field_validator("frontend_url", "backend_url", mode="before")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        return str(v).strip().rstrip("/")


settings = Settings()

# Module-level aliases keep the rest of the codebase (and monkeypatching in
# tests) working without changes.
DB_PATH = settings.db_path
UPLOADS_DIR = settings.uploads_dir
AI_QUIZ_GENERATION_TIMEOUT_SECONDS = settings.ai_quiz_generation_timeout_seconds
GITHUB_CLIENT_ID = settings.github_client_id
GITHUB_CLIENT_SECRET = settings.github_client_secret
FRONTEND_URL = settings.frontend_url
BACKEND_URL = settings.backend_url
FOCUS_PERIOD_SECONDS = settings.focus_period_seconds
CONFUSION_DECAY_SECONDS = settings.confusion_decay_seconds
CONFUSION_ACTIVE_THRESHOLD = settings.confusion_active_threshold
BREAK_COOLDOWN_SECONDS = settings.break_cooldown_seconds
BREAK_THRESHOLD_PERCENT = settings.break_threshold_percent
MAX_BREAK_DURATION_SECONDS = settings.max_break_duration_seconds
REJOIN_GRACE_SECONDS = settings.rejoin_grace_seconds


def parse_allowed_origins(raw: str) -> list[str]:
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
