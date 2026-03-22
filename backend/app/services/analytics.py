import json
import os
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app import config, database
from app.state import RuntimeSession, confusion_snapshot
from app.utils import now_iso

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


def analytics_for_session(session: RuntimeSession) -> dict[str, Any]:
    confusion = confusion_snapshot(session)
    answers = session.quiz_answers.values()
    total_answers = len(session.quiz_answers)
    correct_answers = 0
    if session.current_quiz:
        correct_answers = sum(1 for answer in answers if answer == session.current_quiz.correct_option_id)

    accuracy = (correct_answers / total_answers) if total_answers else 0.0
    active_students = confusion["student_count"]
    break_vote_rate = (len(session.break_votes) / active_students) if active_students else 0.0
    quiz_participation_rate = (total_answers / active_students) if active_students else 0.0
    confusion_per_student = confusion["average_level"] if active_students else 0.0

    score_raw = (
        min(quiz_participation_rate, 1.0) * 0.55
        + min(break_vote_rate / config.BREAK_THRESHOLD_PERCENT, 1.0) * 0.25
        + min(confusion_per_student, 1.0) * 0.20
    )
    engagement_score = int(round(score_raw * 100))

    end_epoch = session.ended_at_epoch if session.ended_at_epoch is not None else time.time()
    duration_seconds = max(0, int(end_epoch - session.created_at_epoch))

    return {
        "session_code": session.code,
        "teacher_name": session.teacher_name,
        "session_active": session.active,
        "duration_seconds": duration_seconds,
        "student_count": active_students,
        "confusion_count": confusion["level_percent"],
        "confusion_level_percent": confusion["level_percent"],
        "confusion_active_students": confusion["active_students"],
        "break_votes": len(session.break_votes),
        "break_active": bool(session.break_active_until and session.break_active_until > time.time()),
        "quiz": {
            "total_answers": total_answers,
            "correct_answers": correct_answers,
            "accuracy": round(accuracy, 3),
            "hidden": session.quiz_hidden,
            "cover_mode": session.quiz_cover_mode,
            "voting_closed": session.quiz_voting_closed,
            "answer_revealed": session.quiz_answer_revealed,
        },
        "engagement": {
            "score": engagement_score,
            "quiz_participation_rate": round(quiz_participation_rate, 3),
            "break_vote_rate": round(break_vote_rate, 3),
            "confusion_per_student": round(confusion_per_student, 3),
        },
        "notes": session.notes,
    }


def record_engagement_point(session: RuntimeSession, source: str) -> None:
    analytics = analytics_for_session(session)
    point = {
        "recorded_at_epoch": round(time.time(), 3),
        "source": source,
        "engagement_score": int(analytics.get("engagement", {}).get("score", 0)),
        "confusion_level_percent": int(analytics.get("confusion_level_percent", 0)),
        "break_votes": int(analytics.get("break_votes", 0)),
    }

    timeline = session.engagement_timeline
    if timeline:
        last = timeline[-1]
        if (
            last.get("engagement_score") == point["engagement_score"]
            and last.get("confusion_level_percent") == point["confusion_level_percent"]
            and last.get("break_votes") == point["break_votes"]
            and last.get("source") == point["source"]
            and (point["recorded_at_epoch"] - float(last.get("recorded_at_epoch", 0))) < 5
        ):
            return

    timeline.append(point)


def build_full_analytics_report(session: RuntimeSession) -> dict[str, Any]:
    analytics = analytics_for_session(session)
    students_connected = []
    now_epoch = time.time()
    for client in session.clients.values():
        if client.role != "student":
            continue
        students_connected.append(
            {
                "client_id": client.client_id,
                "name": client.name,
                "joined_at_epoch": round(client.joined_at, 3),
                "time_in_session_seconds": max(0, int(now_epoch - client.joined_at)),
            }
        )

    timeline = sorted(
        session.engagement_timeline,
        key=lambda item: float(item.get("recorded_at_epoch", 0)),
    )
    if not timeline:
        record_engagement_point(session, "report_generated")
        timeline = sorted(
            session.engagement_timeline,
            key=lambda item: float(item.get("recorded_at_epoch", 0)),
        )

    return {
        "report_type": "session_engagement",
        "generated_at": now_iso(),
        "analytics": analytics,
        "students_connected": students_connected,
        "engagement_timeline": timeline,
    }


def _normalize_insights_payload(payload: dict[str, Any]) -> dict[str, Any]:
    def clean_text(value: Any, *, fallback: str, max_len: int = 700) -> str:
        text = " ".join(str(value or "").split())
        if not text:
            text = fallback
        return text[:max_len]

    def clean_list(values: Any, *, fallback: list[str], max_items: int = 5) -> list[str]:
        if not isinstance(values, list):
            values = []
        cleaned: list[str] = []
        for item in values:
            text = " ".join(str(item or "").split())
            if text:
                cleaned.append(text[:220])
            if len(cleaned) >= max_items:
                break
        return cleaned or fallback

    return {
        "title": clean_text(payload.get("title"), fallback="Session Analytics Insights", max_len=120),
        "executive_summary": clean_text(
            payload.get("executive_summary"),
            fallback="Class engagement summary generated from session analytics.",
        ),
        "key_findings": clean_list(
            payload.get("key_findings"),
            fallback=["Engagement indicators were collected successfully for this session."],
        ),
        "risks": clean_list(
            payload.get("risks"),
            fallback=["No critical risk was detected from the available analytics."],
        ),
        "recommendations": clean_list(
            payload.get("recommendations"),
            fallback=["Continue tracking participation and confusion trends across sessions."],
        ),
    }


def build_analytics_insights_fallback(report: dict[str, Any]) -> dict[str, Any]:
    analytics = report.get("analytics", {})
    engagement = analytics.get("engagement", {})
    quiz = analytics.get("quiz", {})

    score = int(engagement.get("score") or 0)
    student_count = int(analytics.get("student_count") or 0)
    confusion_percent = int(analytics.get("confusion_level_percent") or 0)
    break_votes = int(analytics.get("break_votes") or 0)
    participation_rate = float(engagement.get("quiz_participation_rate") or 0.0)
    accuracy = float(quiz.get("accuracy") or 0.0)

    if score >= 75:
        engagement_label = "high"
    elif score >= 45:
        engagement_label = "moderate"
    else:
        engagement_label = "low"

    risks: list[str] = []
    if participation_rate < 0.55:
        risks.append("Quiz participation was below 55%, indicating uneven student involvement.")
    if accuracy < 0.5:
        risks.append("Quiz accuracy was below 50%, suggesting students may need concept reinforcement.")
    if confusion_percent >= 60:
        risks.append("High confusion levels were detected, which can reduce learning retention.")
    if break_votes >= max(2, int(student_count * 0.35)):
        risks.append("Break demand was elevated, which may indicate cognitive overload or pacing issues.")
    if not risks:
        risks.append("No major risk trend was identified from the available analytics.")

    recommendations = [
        "Start the next class with a short recap of the most difficult concept from this session.",
        "Add one low-stakes check-in question every 8-12 minutes to improve participation consistency.",
        "Trigger a micro-break earlier when break-vote and confusion indicators begin rising together.",
    ]

    return _normalize_insights_payload(
        {
            "title": "AI-Assisted Session Insights",
            "executive_summary": (
                f"This session shows {engagement_label} engagement (score {score}/100) across {student_count} active students. "
                f"Quiz participation was {round(participation_rate * 100)}% with {round(accuracy * 100)}% accuracy, "
                f"while confusion reached {confusion_percent}% and break votes totaled {break_votes}."
            ),
            "key_findings": [
                f"Engagement score reached {score}/100.",
                f"Quiz participation rate was {round(participation_rate * 100)}%.",
                f"Quiz accuracy ended at {round(accuracy * 100)}%.",
                f"Confusion level indicator was {confusion_percent}%.",
            ],
            "risks": risks,
            "recommendations": recommendations,
        }
    )


def build_analytics_insights_with_ai(report: dict[str, Any]) -> dict[str, Any]:
    analytics = report.get("analytics", {})
    prompt = (
        "You are an educational analytics assistant. "
        "Generate concise insights from classroom session metrics. "
        "Return STRICT JSON only with keys: title, executive_summary, key_findings, risks, recommendations. "
        "key_findings, risks, recommendations must each be arrays of short bullet-style strings. "
        "Focus on actionable and evidence-based insights."
    )
    input_data = {
        "session_code": analytics.get("session_code"),
        "teacher_name": analytics.get("teacher_name"),
        "duration_seconds": analytics.get("duration_seconds"),
        "student_count": analytics.get("student_count"),
        "confusion_level_percent": analytics.get("confusion_level_percent"),
        "break_votes": analytics.get("break_votes"),
        "quiz": analytics.get("quiz"),
        "engagement": analytics.get("engagement"),
    }

    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    if gemini_api_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_api_key}"
            body = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": f"Session analytics data:\n{json.dumps(input_data, ensure_ascii=True)}\n\n{prompt}",
                            }
                        ],
                    }
                ],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                },
            }
            req = Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(req, timeout=20) as resp:
                response_text = resp.read().decode("utf-8")
            parsed_response = json.loads(response_text)
            model_text = (
                parsed_response.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
                .strip()
            )
            if model_text.startswith("```"):
                model_text = model_text.strip("`")
                if model_text.lower().startswith("json"):
                    model_text = model_text[4:].strip()
            if model_text:
                return _normalize_insights_payload(json.loads(model_text))
        except Exception:
            pass

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    base_url = os.getenv("OPENAI_BASE_URL", "").strip() or None
    if api_key and OpenAI is not None:
        try:
            client = OpenAI(api_key=api_key, base_url=base_url)
            response = client.responses.create(
                model=model,
                input=[
                    {
                        "role": "system",
                        "content": "You produce concise educational analytics insights in strict JSON.",
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Session analytics data:\n{json.dumps(input_data, ensure_ascii=True)}\n\n{prompt}"
                        ),
                    },
                ],
                temperature=0.2,
            )
            text_output = (response.output_text or "").strip()
            if text_output.startswith("```"):
                text_output = text_output.strip("`")
                if text_output.lower().startswith("json"):
                    text_output = text_output[4:].strip()
            if text_output:
                return _normalize_insights_payload(json.loads(text_output))
        except Exception:
            pass

    return build_analytics_insights_fallback(report)
