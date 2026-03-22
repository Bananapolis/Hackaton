import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config, database
from app.config import parse_allowed_origins
from app.routers import auth, presentations, quizzes, sessions, websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield


app = FastAPI(title="VIA Live", version="1.0.0", lifespan=lifespan)

allowed_origins = parse_allowed_origins(
    os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(presentations.router)
app.include_router(quizzes.router)
app.include_router(websocket.router)
