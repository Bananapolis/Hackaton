import io
from typing import Any

from app.utils import now_iso

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover
    A4 = None
    cm = None
    stringWidth = None
    canvas = None


def _wrap_text_lines(text: str, font_name: str, font_size: int, max_width: float) -> list[str]:
    if not text:
        return [""]

    if stringWidth is None:
        return [text]

    words = text.split()
    if not words:
        return [""]

    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def generate_session_report_pdf(report: dict[str, Any], insights: dict[str, Any]) -> bytes:
    if canvas is None or A4 is None or cm is None:
        raise RuntimeError("PDF generation dependency is not available")

    analytics = report.get("analytics", {})
    engagement = analytics.get("engagement", {})
    quiz = analytics.get("quiz", {})
    students = report.get("students_connected", [])
    timeline = report.get("engagement_timeline", [])

    duration_seconds = int(analytics.get("duration_seconds") or 0)
    if not timeline:
        timeline = [
            {
                "recorded_at_epoch": 0,
                "engagement_score": int(engagement.get("score", 0)),
                "confusion_level_percent": int(analytics.get("confusion_level_percent", 0)),
            },
            {
                "recorded_at_epoch": max(duration_seconds, 1),
                "engagement_score": int(engagement.get("score", 0)),
                "confusion_level_percent": int(analytics.get("confusion_level_percent", 0)),
            },
        ]

    first_epoch = float(timeline[0].get("recorded_at_epoch", 0)) if timeline else 0.0
    line_points: list[dict[str, float]] = []
    for item in timeline:
        raw_epoch = float(item.get("recorded_at_epoch", first_epoch))
        elapsed = raw_epoch - first_epoch
        if duration_seconds > 0:
            elapsed = min(max(elapsed, 0.0), float(duration_seconds))
        line_points.append(
            {
                "elapsed": elapsed,
                "engagement": min(max(float(item.get("engagement_score", 0)), 0.0), 100.0),
                "confusion": min(max(float(item.get("confusion_level_percent", 0)), 0.0), 100.0),
            }
        )

    if len(line_points) == 1:
        line_points.append(
            {
                "elapsed": max(float(duration_seconds), 1.0),
                "engagement": line_points[0]["engagement"],
                "confusion": line_points[0]["confusion"],
            }
        )

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4

    margin_x = 2 * cm
    y = page_height - 2 * cm
    content_width = page_width - (2 * margin_x)
    bottom_limit = 2.1 * cm

    c_text = (0.15, 0.18, 0.24)
    c_muted = (0.46, 0.51, 0.60)
    c_header_bg = (0.92, 0.96, 1.0)
    c_card_bg = (0.97, 0.98, 1.0)
    c_card_border = (0.85, 0.89, 0.95)
    c_grid = (0.90, 0.93, 0.97)
    c_engagement = (0.07, 0.42, 0.73)
    c_confusion = (0.88, 0.45, 0.20)
    c_quiz_correct = (0.16, 0.62, 0.37)
    c_quiz_incorrect = (0.84, 0.33, 0.31)
    c_quiz_unanswered = (0.64, 0.66, 0.70)

    def new_page() -> None:
        nonlocal y
        pdf.showPage()
        y = page_height - 2 * cm

    def ensure_space(height_needed: float) -> None:
        nonlocal y
        if y - height_needed < bottom_limit:
            new_page()

    def draw_heading(
        text: str,
        *,
        size: int = 14,
        gap_before: int = 10,
        gap_after: int = 12,
    ) -> None:
        nonlocal y
        y -= gap_before
        ensure_space(size + gap_after + 6)
        pdf.setFont("Helvetica-Bold", size)
        pdf.setFillColorRGB(*c_text)
        pdf.drawString(margin_x, y, text)
        y -= gap_after + size

    def draw_paragraph(text: str, *, font: str = "Helvetica", size: int = 11, leading: int = 14) -> None:
        nonlocal y
        for paragraph in (text or "").splitlines() or [""]:
            lines = _wrap_text_lines(paragraph.strip(), font, size, content_width)
            for line in lines:
                ensure_space(leading + 2)
                pdf.setFont(font, size)
                pdf.setFillColorRGB(*c_text)
                pdf.drawString(margin_x, y, line)
                y -= leading
            y -= 2

    def draw_bullets(items: list[str]) -> None:
        nonlocal y
        for item in items:
            bullet_lines = _wrap_text_lines(item, "Helvetica", 11, content_width - 16)
            ensure_space((len(bullet_lines) + 1) * 14 + 4)
            pdf.setFont("Helvetica", 11)
            pdf.setFillColorRGB(*c_text)
            pdf.drawString(margin_x, y, "-")
            for line in bullet_lines:
                ensure_space(14)
                pdf.drawString(margin_x + 12, y, line)
                y -= 14
            y -= 2

    def draw_info_card(height: float) -> tuple[float, float, float, float]:
        nonlocal y
        ensure_space(height)
        top = y
        bottom = y - height
        pdf.setFillColorRGB(*c_card_bg)
        pdf.setStrokeColorRGB(*c_card_border)
        pdf.setLineWidth(1)
        pdf.roundRect(margin_x, bottom, content_width, height, 8, stroke=1, fill=1)
        y = bottom - 12
        return (margin_x, bottom, content_width, top)

    # Header band
    header_height = 2.9 * cm
    ensure_space(header_height + 12)
    header_bottom = y - header_height
    pdf.setFillColorRGB(*c_header_bg)
    pdf.setStrokeColorRGB(*c_card_border)
    pdf.roundRect(margin_x, header_bottom, content_width, header_height, 10, stroke=1, fill=1)
    pdf.setFillColorRGB(*c_text)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(margin_x + 12, y - 24, insights.get("title", "Session Analytics Report"))
    pdf.setFont("Helvetica", 9)
    pdf.setFillColorRGB(*c_muted)
    pdf.drawString(
        margin_x + 12,
        y - 40,
        (
            f"Session {analytics.get('session_code', 'N/A')} | "
            f"Teacher {analytics.get('teacher_name', 'N/A')} | "
            f"Generated {report.get('generated_at', now_iso())}"
        ),
    )
    y = header_bottom - 14

    draw_heading("Executive Summary", gap_before=2, gap_after=12)
    draw_paragraph(insights.get("executive_summary", "No executive summary available."))

    draw_heading("Core Metrics", gap_before=10, gap_after=12)
    card_x, card_bottom, card_width, card_top = draw_info_card(104)
    card_pad = 12
    col_w = (card_width - (card_pad * 2)) / 2
    metric_rows = [
        ("Duration", f"{analytics.get('duration_seconds', 0)}s"),
        ("Students", str(analytics.get("student_count", 0))),
        ("Engagement", f"{engagement.get('score', 0)} / 100"),
        ("Confusion", f"{analytics.get('confusion_level_percent', 0)}%"),
        ("Break votes", str(analytics.get("break_votes", 0))),
        (
            "Quiz accuracy",
            f"{round(float(quiz.get('accuracy', 0.0)) * 100)}% ({quiz.get('correct_answers', 0)}/{quiz.get('total_answers', 0)})",
        ),
    ]
    for idx, (label, value) in enumerate(metric_rows):
        col = idx % 2
        row = idx // 2
        x = card_x + card_pad + (col * col_w)
        row_y = card_top - 20 - (row * 28)
        pdf.setFont("Helvetica", 9)
        pdf.setFillColorRGB(*c_muted)
        pdf.drawString(x, row_y, label)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.setFillColorRGB(*c_text)
        pdf.drawString(x, row_y - 12, value)

    draw_heading("Student Engagement Trend", gap_before=10, gap_after=12)
    chart_block_h = 188
    block_x, block_bottom, block_w, block_top = draw_info_card(chart_block_h)

    legend_y = block_top - 16
    pdf.setFillColorRGB(*c_engagement)
    pdf.rect(block_x + 12, legend_y - 4, 10, 6, stroke=0, fill=1)
    pdf.setFillColorRGB(*c_text)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(block_x + 26, legend_y - 3, "Engagement")
    pdf.setFillColorRGB(*c_confusion)
    pdf.rect(block_x + 96, legend_y - 4, 10, 6, stroke=0, fill=1)
    pdf.setFillColorRGB(*c_text)
    pdf.drawString(block_x + 110, legend_y - 3, "Confusion")

    chart_left = block_x + 18
    chart_right = block_x + block_w - 14
    chart_width = chart_right - chart_left
    chart_bottom = block_bottom + 26
    chart_height = chart_block_h - 52

    pdf.setStrokeColorRGB(*c_grid)
    pdf.setLineWidth(0.6)
    for value in [0, 25, 50, 75, 100]:
        y_tick = chart_bottom + (chart_height * (value / 100.0))
        pdf.line(chart_left, y_tick, chart_right, y_tick)
        pdf.setFillColorRGB(*c_muted)
        pdf.setFont("Helvetica", 8)
        pdf.drawString(chart_left - 16, y_tick - 2, str(value))

    pdf.setStrokeColorRGB(0.72, 0.77, 0.84)
    pdf.setLineWidth(1)
    pdf.line(chart_left, chart_bottom, chart_left, chart_bottom + chart_height)
    pdf.line(chart_left, chart_bottom, chart_right, chart_bottom)

    x_max = max(float(duration_seconds), max((point["elapsed"] for point in line_points), default=1.0), 1.0)

    def draw_series(key: str, color: tuple[float, float, float]) -> None:
        pdf.setStrokeColorRGB(*color)
        pdf.setFillColorRGB(*color)
        pdf.setLineWidth(1.8)
        for idx in range(1, len(line_points)):
            p1 = line_points[idx - 1]
            p2 = line_points[idx]
            x1 = chart_left + (p1["elapsed"] / x_max) * chart_width
            y1 = chart_bottom + (p1[key] / 100.0) * chart_height
            x2 = chart_left + (p2["elapsed"] / x_max) * chart_width
            y2 = chart_bottom + (p2[key] / 100.0) * chart_height
            pdf.line(x1, y1, x2, y2)
        for point in line_points:
            x = chart_left + (point["elapsed"] / x_max) * chart_width
            y_point = chart_bottom + (point[key] / 100.0) * chart_height
            pdf.circle(x, y_point, 1.5, stroke=0, fill=1)

    draw_series("engagement", c_engagement)
    draw_series("confusion", c_confusion)

    pdf.setFillColorRGB(*c_muted)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(chart_left, chart_bottom - 14, "Session timeline (seconds)")
    pdf.drawRightString(chart_right, chart_bottom - 14, f"{int(round(x_max))}s")

    draw_heading("Quiz Performance Visualization", gap_before=10, gap_after=12)
    quiz_block_h = 120
    q_x, q_bottom, q_w, q_top = draw_info_card(quiz_block_h)
    q_chart_left = q_x + 14
    q_chart_right = q_x + q_w - 14
    q_chart_w = q_chart_right - q_chart_left

    total_answers = int(quiz.get("total_answers", 0))
    correct_answers = int(quiz.get("correct_answers", 0))
    incorrect_answers = max(total_answers - correct_answers, 0)
    student_count = int(analytics.get("student_count", 0))
    unanswered = max(student_count - total_answers, 0)
    max_bar = max(student_count, total_answers, 1)

    quiz_bars = [
        ("Correct", correct_answers, c_quiz_correct),
        ("Incorrect", incorrect_answers, c_quiz_incorrect),
        ("Unanswered", unanswered, c_quiz_unanswered),
    ]

    for idx, (label, value, color) in enumerate(quiz_bars):
        row_y = q_top - 24 - (idx * 30)
        bar_w = (value / max_bar) * (q_chart_w - 88)
        pdf.setFillColorRGB(*c_muted)
        pdf.setFont("Helvetica", 9)
        pdf.drawString(q_chart_left, row_y, label)
        pdf.setFillColorRGB(0.92, 0.94, 0.97)
        pdf.roundRect(q_chart_left + 56, row_y - 7, q_chart_w - 88, 10, 3, stroke=0, fill=1)
        pdf.setFillColorRGB(*color)
        pdf.roundRect(q_chart_left + 56, row_y - 7, max(bar_w, 0.5), 10, 3, stroke=0, fill=1)
        pdf.setFillColorRGB(*c_text)
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawRightString(q_chart_right, row_y, str(value))

    accuracy_pct = round(float(quiz.get("accuracy", 0.0)) * 100)
    participation_pct = round((total_answers / max(student_count, 1)) * 100) if student_count else 0
    pdf.setFont("Helvetica", 9)
    pdf.setFillColorRGB(*c_muted)
    pdf.drawString(q_chart_left, q_bottom + 10, f"Accuracy: {accuracy_pct}%")
    pdf.drawString(q_chart_left + 112, q_bottom + 10, f"Participation: {participation_pct}%")

    draw_heading("Key Findings", gap_before=12, gap_after=12)
    draw_bullets(insights.get("key_findings", []))

    draw_heading("Risks", gap_before=12, gap_after=12)
    draw_bullets(insights.get("risks", []))

    draw_heading("Recommendations", gap_before=12, gap_after=12)
    draw_bullets(insights.get("recommendations", []))

    draw_heading("Connected Students", gap_before=12, gap_after=12)
    if students:
        for student in students[:25]:
            draw_paragraph(
                f"{student.get('name', 'Unknown')} (id: {student.get('client_id', 'n/a')}) - "
                f"time in session: {student.get('time_in_session_seconds', 0)}s",
                size=10,
                leading=13,
            )
    else:
        draw_paragraph("No student connection records were captured for this report.")

    pdf.save()
    return buffer.getvalue()
