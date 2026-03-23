from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.assessment_reporting import (
    AssessmentResponse,
    build_individual_profiles,
    calculate_session_metrics,
    fetch_session_responses,
    init_assessment_schema,
    question_performance_breakdown,
    save_question_performance_bar_chart,
    save_student_progress_radar,
    save_student_summary_table,
    store_assessment_response,
)


def _seed_sample_data(db_path: Path) -> list[AssessmentResponse]:
    rows = [
        AssessmentResponse(
            student_id="stu-1",
            question_id="q1",
            session_id="session-42",
            timestamp=datetime(2026, 3, 23, 10, 0, 0, tzinfo=timezone.utc).isoformat(),
            raw_answer="A",
            is_correct=True,
        ),
        AssessmentResponse(
            student_id="stu-2",
            question_id="q1",
            session_id="session-42",
            timestamp=datetime(2026, 3, 23, 10, 0, 5, tzinfo=timezone.utc).isoformat(),
            raw_answer="B",
            is_correct=False,
        ),
        AssessmentResponse(
            student_id="stu-1",
            question_id="q2",
            session_id="session-42",
            timestamp=datetime(2026, 3, 23, 10, 0, 10, tzinfo=timezone.utc).isoformat(),
            raw_answer="C",
            is_correct=True,
        ),
        AssessmentResponse(
            student_id="stu-2",
            question_id="q2",
            session_id="session-42",
            timestamp=datetime(2026, 3, 23, 10, 0, 17, tzinfo=timezone.utc).isoformat(),
            raw_answer="D",
            is_correct=False,
        ),
    ]
    for row in rows:
        store_assessment_response(db_path, row)
    return rows


def test_schema_insert_fetch_and_aggregations(tmp_path: Path) -> None:
    db_path = tmp_path / "assessment.sqlite3"
    init_assessment_schema(db_path)

    _seed_sample_data(db_path)
    responses = fetch_session_responses(db_path, "session-42")

    assert len(responses) == 4

    metrics = calculate_session_metrics(responses)
    assert metrics["total_responses"] == 4
    assert metrics["total_accuracy_percentage"] == 50.0
    assert metrics["answer_frequency"] == {"correct": 2, "incorrect": 2}
    # Per-student deltas: stu-1 => 10s, stu-2 => 12s => avg 11s
    assert metrics["average_time_per_question_seconds"] == 11.0

    breakdown = question_performance_breakdown(responses)
    assert breakdown == [
        {
            "question_id": "q1",
            "total_answers": 2,
            "correct_answers": 1,
            "incorrect_answers": 1,
            "accuracy_percentage": 50.0,
        },
        {
            "question_id": "q2",
            "total_answers": 2,
            "correct_answers": 1,
            "incorrect_answers": 1,
            "accuracy_percentage": 50.0,
        },
    ]


def test_individual_profiles_and_visualizations(tmp_path: Path) -> None:
    db_path = tmp_path / "assessment.sqlite3"
    init_assessment_schema(db_path)
    _seed_sample_data(db_path)

    responses = fetch_session_responses(db_path, "session-42")

    profiles = build_individual_profiles(
        responses,
        correct_answers_by_question={"q1": "A", "q2": "C"},
    )
    assert set(profiles.keys()) == {"stu-1", "stu-2"}

    assert profiles["stu-1"] == [
        {
            "question_id": "q1",
            "student_answer": "A",
            "correct_answer": "A",
            "is_correct": True,
            "timestamp": "2026-03-23T10:00:00+00:00",
        },
        {
            "question_id": "q2",
            "student_answer": "C",
            "correct_answer": "C",
            "is_correct": True,
            "timestamp": "2026-03-23T10:00:10+00:00",
        },
    ]

    question_chart = tmp_path / "question-performance.png"
    radar_chart = tmp_path / "stu-1-radar.png"
    summary_table = tmp_path / "stu-1-summary.png"

    save_question_performance_bar_chart(question_performance_breakdown(responses), question_chart)
    save_student_progress_radar("stu-1", profiles["stu-1"], radar_chart)
    save_student_summary_table("stu-1", profiles["stu-1"], summary_table)

    assert question_chart.exists() and question_chart.stat().st_size > 0
    assert radar_chart.exists() and radar_chart.stat().st_size > 0
    assert summary_table.exists() and summary_table.stat().st_size > 0
