from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except Exception:  # pragma: no cover - handled by explicit runtime guard
    plt = None


@dataclass(frozen=True)
class AssessmentResponse:
    student_id: str
    question_id: str
    session_id: str
    timestamp: str
    raw_answer: str
    is_correct: bool


def _to_iso8601(timestamp: str | datetime) -> str:
    if isinstance(timestamp, datetime):
        dt = timestamp
    else:
        normalized = timestamp.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _parse_iso8601(timestamp: str) -> datetime:
    normalized = timestamp.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _require_matplotlib() -> None:
    if plt is None:
        raise RuntimeError(
            "Matplotlib is required for visualization. Install backend requirements to enable chart generation."
        )


def init_assessment_schema(db_path: str | Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS assessment_responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id TEXT NOT NULL,
                question_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                raw_answer TEXT NOT NULL,
                is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1))
            )
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_assessment_responses_session
            ON assessment_responses(session_id)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_assessment_responses_session_question
            ON assessment_responses(session_id, question_id)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_assessment_responses_session_student
            ON assessment_responses(session_id, student_id)
            """
        )
        conn.commit()
    finally:
        conn.close()


def store_assessment_response(db_path: str | Path, response: AssessmentResponse) -> None:
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO assessment_responses(
                student_id,
                question_id,
                session_id,
                timestamp,
                raw_answer,
                is_correct
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                response.student_id,
                response.question_id,
                response.session_id,
                _to_iso8601(response.timestamp),
                response.raw_answer,
                1 if response.is_correct else 0,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def fetch_session_responses(db_path: str | Path, session_id: str) -> list[AssessmentResponse]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT student_id, question_id, session_id, timestamp, raw_answer, is_correct
            FROM assessment_responses
            WHERE session_id = ?
            ORDER BY timestamp ASC, id ASC
            """,
            (session_id,),
        )
        rows = cursor.fetchall()
        return [
            AssessmentResponse(
                student_id=row["student_id"],
                question_id=row["question_id"],
                session_id=row["session_id"],
                timestamp=row["timestamp"],
                raw_answer=row["raw_answer"],
                is_correct=bool(row["is_correct"]),
            )
            for row in rows
        ]
    finally:
        conn.close()


def calculate_session_metrics(responses: list[AssessmentResponse]) -> dict[str, Any]:
    total = len(responses)
    if total == 0:
        return {
            "total_responses": 0,
            "total_accuracy_percentage": 0.0,
            "average_time_per_question_seconds": 0.0,
            "answer_frequency": {"correct": 0, "incorrect": 0},
        }

    correct_count = sum(1 for response in responses if response.is_correct)
    incorrect_count = total - correct_count

    by_student: dict[str, list[AssessmentResponse]] = {}
    for response in responses:
        by_student.setdefault(response.student_id, []).append(response)

    time_deltas_seconds: list[float] = []
    for student_responses in by_student.values():
        sorted_responses = sorted(student_responses, key=lambda item: _parse_iso8601(item.timestamp))
        for previous, current in zip(sorted_responses, sorted_responses[1:]):
            delta = (_parse_iso8601(current.timestamp) - _parse_iso8601(previous.timestamp)).total_seconds()
            time_deltas_seconds.append(max(0.0, delta))

    average_time = mean(time_deltas_seconds) if time_deltas_seconds else 0.0

    return {
        "total_responses": total,
        "total_accuracy_percentage": round((correct_count / total) * 100.0, 2),
        "average_time_per_question_seconds": round(float(average_time), 2),
        "answer_frequency": {"correct": correct_count, "incorrect": incorrect_count},
    }


def question_performance_breakdown(responses: list[AssessmentResponse]) -> list[dict[str, Any]]:
    by_question: dict[str, list[AssessmentResponse]] = {}
    for response in responses:
        by_question.setdefault(response.question_id, []).append(response)

    rows: list[dict[str, Any]] = []
    for question_id in sorted(by_question):
        question_responses = by_question[question_id]
        total_answers = len(question_responses)
        correct_answers = sum(1 for row in question_responses if row.is_correct)
        accuracy = (correct_answers / total_answers) * 100.0 if total_answers else 0.0
        rows.append(
            {
                "question_id": question_id,
                "total_answers": total_answers,
                "correct_answers": correct_answers,
                "incorrect_answers": total_answers - correct_answers,
                "accuracy_percentage": round(accuracy, 2),
            }
        )
    return rows


def build_individual_profiles(
    responses: list[AssessmentResponse],
    correct_answers_by_question: dict[str, str],
) -> dict[str, list[dict[str, Any]]]:
    by_student: dict[str, list[AssessmentResponse]] = {}
    for response in responses:
        by_student.setdefault(response.student_id, []).append(response)

    profile: dict[str, list[dict[str, Any]]] = {}
    for student_id in sorted(by_student):
        student_rows = sorted(by_student[student_id], key=lambda item: _parse_iso8601(item.timestamp))
        profile[student_id] = [
            {
                "question_id": row.question_id,
                "student_answer": row.raw_answer,
                "correct_answer": correct_answers_by_question.get(row.question_id),
                "is_correct": row.is_correct,
                "timestamp": row.timestamp,
            }
            for row in student_rows
        ]
    return profile


def save_question_performance_bar_chart(
    question_breakdown: list[dict[str, Any]],
    output_path: str | Path,
    title: str = "Class Performance by Question",
) -> str:
    _require_matplotlib()

    question_labels = [row["question_id"] for row in question_breakdown]
    accuracies = [row["accuracy_percentage"] for row in question_breakdown]

    fig, ax = plt.subplots(figsize=(10, 5))
    bars = ax.bar(question_labels, accuracies, color="#2563EB")
    ax.set_ylim(0, 100)
    ax.set_ylabel("Accuracy (%)")
    ax.set_xlabel("Question")
    ax.set_title(title)

    for bar, value in zip(bars, accuracies):
        ax.text(
            bar.get_x() + bar.get_width() / 2.0,
            bar.get_height() + 1,
            f"{value:.1f}%",
            ha="center",
            va="bottom",
            fontsize=9,
        )

    fig.tight_layout()
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=180)
    plt.close(fig)
    return str(out)


def save_student_progress_radar(
    student_id: str,
    student_profile_rows: list[dict[str, Any]],
    output_path: str | Path,
    title: str | None = None,
) -> str:
    _require_matplotlib()

    if not student_profile_rows:
        raise ValueError("student_profile_rows cannot be empty")

    labels = [row["question_id"] for row in student_profile_rows]
    scores = [1.0 if row["is_correct"] else 0.0 for row in student_profile_rows]

    labels.append(labels[0])
    scores.append(scores[0])

    import math

    angle_step = (2.0 * math.pi) / (len(labels) - 1)
    angles = [index * angle_step for index in range(len(labels) - 1)]
    angles.append(angles[0])

    fig, ax = plt.subplots(figsize=(6, 6), subplot_kw={"projection": "polar"})
    ax.plot(angles, scores, color="#16A34A", linewidth=2)
    ax.fill(angles, scores, color="#16A34A", alpha=0.20)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(labels[:-1])
    ax.set_yticks([0.0, 0.5, 1.0])
    ax.set_yticklabels(["0%", "50%", "100%"])
    ax.set_ylim(0.0, 1.0)
    ax.set_title(title or f"Student Progress Radar - {student_id}")

    fig.tight_layout()
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=180)
    plt.close(fig)
    return str(out)


def save_student_summary_table(
    student_id: str,
    student_profile_rows: list[dict[str, Any]],
    output_path: str | Path,
    title: str | None = None,
) -> str:
    _require_matplotlib()

    columns = ["Question", "Student Answer", "Correct Answer", "Correct"]
    cell_text = [
        [
            row["question_id"],
            str(row["student_answer"]),
            str(row["correct_answer"]),
            "Yes" if row["is_correct"] else "No",
        ]
        for row in student_profile_rows
    ]

    fig_height = max(2.2, 0.4 * max(1, len(cell_text)) + 1.4)
    fig, ax = plt.subplots(figsize=(9, fig_height))
    ax.axis("off")
    ax.set_title(title or f"Student Summary - {student_id}", pad=12)
    table = ax.table(cellText=cell_text, colLabels=columns, loc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1.0, 1.25)

    fig.tight_layout()
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=180)
    plt.close(fig)
    return str(out)
