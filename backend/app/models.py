from pydantic import BaseModel


class SessionCreateRequest(BaseModel):
    teacher_name: str


class SessionCreateResponse(BaseModel):
    code: str


class AuthRegisterRequest(BaseModel):
    email: str
    display_name: str
    password: str
    role: str = "teacher"


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class UserPublic(BaseModel):
    id: int
    email: str
    display_name: str
    role: str


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class PresentationItem(BaseModel):
    id: int
    session_code: str | None
    original_name: str
    mime_type: str
    size_bytes: int
    created_at: str
    download_url: str


class QuizOption(BaseModel):
    id: str
    text: str


class QuizPayload(BaseModel):
    question: str
    options: list[QuizOption]
    correct_option_id: str


class SavedQuizCreateRequest(BaseModel):
    session_code: str | None = None
    question: str
    options: list[QuizOption]
    correct_option_id: str


class SavedQuizItem(BaseModel):
    id: int
    session_code: str | None
    question: str
    options: list[QuizOption]
    correct_option_id: str
    created_at: str


class SavedQuizListItem(BaseModel):
    id: int
    session_code: str | None
    question: str
    options: list[QuizOption]
    correct_option_id: str | None
    answer_revealed: bool
    is_live: bool
    created_at: str


class GoogleTokenRequest(BaseModel):
    access_token: str
