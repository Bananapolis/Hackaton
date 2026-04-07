import json
from base64 import b64decode
from pathlib import Path
from typing import Any

import httpx

from app import config, database
from app.models import QuizOption, QuizPayload

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


QUIZ_PRESET_INSTRUCTIONS = {
    "default": "Create a clear concept-check question focused on the most important idea from the current context.",
    "funny": "Write a light, classroom-safe question with a subtle playful tone, while staying educational and accurate.",
    "challenge": "Write a challenging question that requires deeper reasoning, not just recall.",
    "misconception": "Target a common misconception and use plausible distractors that reveal misunderstanding.",
    "real_world": "Frame the question around a practical real-world scenario or application.",
}


def compose_quiz_generation_prompt(style_preset: str, custom_prompt: str) -> str:
    normalized_preset = (style_preset or "default").strip().lower()
    style_instruction = QUIZ_PRESET_INSTRUCTIONS.get(
        normalized_preset,
        QUIZ_PRESET_INSTRUCTIONS["default"],
    )
    custom_instruction = custom_prompt.strip()

    prompt = (
        "Generate exactly one multiple choice question with 4 options (A, B, C, D) based on lecture notes. "
        "Use the selected style instruction below. "
        "Keep all options similarly sized and similarly specific, so the correct answer is NOT obvious from option length, detail level, wording style, or formatting cues. "
        "Distractors must be plausible and non-joke unless style explicitly allows a playful tone. "
        "Do not add explanations."
    )

    prompt += f"\n\nStyle instruction:\n{style_instruction}"
    if custom_instruction:
        prompt += f"\n\nAdditional teacher instruction:\n{custom_instruction}"

    prompt += (
        "\n\nReturn JSON only with keys: question, options, correct_option_id. "
        "options must be an array of exactly 4 objects with keys id and text, and ids must be A, B, C, D. "
        "correct_option_id must be one of A, B, C, D."
    )
    return prompt


def build_quiz_fallback(notes: str) -> QuizPayload:
    topic = (notes or "the current lecture").strip()
    if len(topic) > 70:
        topic = topic[:70] + "..."

    correct_id = "B"
    return QuizPayload(
        question=f"Which statement best summarizes {topic}?",
        options=[
            QuizOption(id="A", text="It is unrelated to the lesson topic."),
            QuizOption(id="B", text="It captures a key concept from the current lecture."),
            QuizOption(id="C", text="It should be ignored because it has no practical use."),
            QuizOption(id="D", text="It only applies to historical systems and not today."),
        ],
        correct_option_id=correct_id,
    )


def _call_gemini(
    model_name: str,
    parts: list[dict[str, Any]],
    generation_config: dict[str, Any],
    *,
    timeout: float = 20.0,
) -> str:
    """POST to Gemini generateContent and return the first candidate's text."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model_name}:generateContent"
    )
    response = httpx.post(
        url,
        params={"key": config.settings.gemini_api_key},
        json={
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": generation_config,
        },
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    return (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
        .strip()
    )


def _gemini_models_to_try() -> list[str]:
    model = config.settings.gemini_model
    models = [model]
    if model != "gemini-2.5-flash":
        models.append("gemini-2.5-flash")
    return models


def build_quiz_with_ai(
    notes: str,
    style_preset: str = "default",
    custom_prompt: str = "",
) -> QuizPayload:
    # No cache for quizzes — teachers always want a fresh question.
    gemini_api_key = config.settings.gemini_api_key
    errors: list[str] = []

    if gemini_api_key:
        prompt = compose_quiz_generation_prompt(style_preset, custom_prompt)
        parts: list[dict[str, Any]] = [
            {"text": f"Lecture notes:\n{notes or 'No notes provided.'}\n\n{prompt}"}
        ]
        for model_name in _gemini_models_to_try():
            try:
                text_output = _call_gemini(
                    model_name,
                    parts,
                    {"temperature": 0.2, "responseMimeType": "application/json"},
                    timeout=10.0,
                )
                if not text_output:
                    raise ValueError("Gemini returned an empty response")
                if text_output.startswith("```"):
                    text_output = text_output.strip("`")
                    if text_output.lower().startswith("json"):
                        text_output = text_output[4:].strip()
                parsed = json.loads(text_output)
                quiz = QuizPayload(**parsed)
                return quiz
            except httpx.HTTPStatusError as exc:
                errors.append(
                    f"Gemini model {model_name} HTTP {exc.response.status_code}: "
                    f"{exc.response.text[:300]}"
                )
            except (httpx.RequestError, json.JSONDecodeError, KeyError, ValueError) as exc:
                errors.append(f"Gemini model {model_name} error: {str(exc)[:300]}")

    api_key = config.settings.openai_api_key
    model = config.settings.openai_model
    base_url = config.settings.openai_base_url or None

    if api_key and OpenAI is not None:
        client = OpenAI(api_key=api_key, base_url=base_url)
        prompt = compose_quiz_generation_prompt(style_preset, custom_prompt)
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You produce concise, educational quizzes in strict JSON."},
                    {"role": "user", "content": f"Lecture notes:\n{notes or 'No notes provided.'}\n\n{prompt}"},
                ],
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            text_output = (response.choices[0].message.content or "").strip()
            if not text_output:
                raise ValueError("OpenAI-compatible provider returned an empty response")
            if text_output.startswith("```"):
                text_output = text_output.strip("`")
                if text_output.lower().startswith("json"):
                    text_output = text_output[4:].strip()
            parsed = json.loads(text_output)
            quiz = QuizPayload(**parsed)
            return quiz
        except Exception as exc:
            errors.append(f"OpenAI-compatible error: {str(exc)[:300]}")
    elif api_key and OpenAI is None:
        errors.append("OpenAI-compatible API key is set but OpenAI SDK is unavailable")

    # All AI providers failed — use the static fallback so the teacher always gets a question.
    import logging
    logging.getLogger(__name__).warning("AI quiz generation failed, using fallback. Errors: %s", errors)
    return build_quiz_fallback(notes)


def build_screen_explanation_with_ai(notes: str) -> str:
    _cache_key = database.ai_cache_key("explain", notes or "")
    _cached = database.ai_cache_get(_cache_key)
    if _cached is not None:
        return _cached

    gemini_api_key = config.settings.gemini_api_key
    errors: list[str] = []

    if gemini_api_key:
        prompt = (
            "Explain what the teacher is currently showing in simple student-friendly language. "
            "Keep it concise (about 4-7 sentences), include the likely goal of the slide/screen, "
            "and suggest one practical thing the student should focus on next."
        )
        parts: list[dict[str, Any]] = [
            {"text": f"Lecture notes:\n{notes or 'No notes provided.'}\n\n{prompt}"}
        ]
        for model_name in _gemini_models_to_try():
            try:
                text_output = _call_gemini(model_name, parts, {"temperature": 0.2})
                if text_output:
                    result = text_output[:1400]
                    database.ai_cache_set(_cache_key, result, ttl_seconds=3600)
                    return result
                raise ValueError("Gemini returned an empty explanation")
            except httpx.HTTPStatusError as exc:
                errors.append(
                    f"Gemini model {model_name} HTTP {exc.response.status_code}: "
                    f"{exc.response.text[:300]}"
                )
            except (httpx.RequestError, json.JSONDecodeError, KeyError, ValueError) as exc:
                errors.append(f"Gemini model {model_name} error: {str(exc)[:300]}")

    api_key = config.settings.openai_api_key
    model = config.settings.openai_model
    base_url = config.settings.openai_base_url or None

    if api_key and OpenAI is not None:
        client = OpenAI(api_key=api_key, base_url=base_url)
        user_content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": (
                    "Explain what the teacher is currently showing in simple student-friendly language. "
                    "Keep it concise (about 4-7 sentences), include the likely goal of the slide/screen, "
                    "and suggest one practical thing the student should focus on next.\n\n"
                    f"Lecture notes:\n{notes or 'No notes provided.'}"
                ),
            }
        ]
        try:
            response = client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": "You explain live lecture visuals in concise and supportive language."},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.2,
            )
            text_output = response.output_text.strip()
            if text_output:
                result = text_output[:1400]
                database.ai_cache_set(_cache_key, result, ttl_seconds=3600)
                return result
            raise ValueError("OpenAI-compatible provider returned an empty explanation")
        except Exception as exc:
            errors.append(f"OpenAI-compatible error: {str(exc)[:300]}")
    elif api_key and OpenAI is None:
        errors.append("OpenAI-compatible API key is set but OpenAI SDK is unavailable")

    if not gemini_api_key and not api_key:
        raise RuntimeError("No AI provider configured. Set GEMINI_API_KEY (recommended).")

    if errors:
        raise RuntimeError("; ".join(errors))

    raise RuntimeError("Screen explanation failed with unknown AI error")


def build_student_notes_with_ai(presentation_text: str, presentation_name: str) -> str:
    source = (presentation_text or "").strip()
    if not source:
        raise RuntimeError("No readable text was found in the presentation.")

    _cache_key = database.ai_cache_key("student_notes", source[:24000])
    _cached = database.ai_cache_get(_cache_key)
    if _cached is not None:
        return _cached

    source_excerpt = source[:24000]
    topic = Path(presentation_name).stem.replace("-", " ").replace("_", " ").strip() or "Science Topic"
    prompt = (
        "A hyper-realistic, top-down photograph of a single page of handwritten notes on clean white dotted journal paper, "
        "representing a \"modern minimalist\" aesthetic. "
        f"The subject is {topic}. "
        "The title is neatly lettered in fine black ink. "
        "The content is organized with thin black fineliner pen, featuring extremely precise, small print handwriting, "
        "simple bullet points, and neat numbered lists. "
        "Key terms are subtly highlighted with a single, very light pastel color (e.g., pale mint green). "
        "The notes are sparse, utilizing significant negative space. "
        "There is one simple, flawlessly executed black ink diagram with elegant, thin arrows. "
        "A single black fineliner pen rests diagonally beside the paper. "
        "The background is a plain, light wood grain desk surface. Natural, soft daylight. "
        "8k, macro detail, perfect legibility, high resolution. "
        "\n\nNow generate ONLY the note content text that should be written on that page. "
        "Do not describe camera, paper, desk, lighting, or photo style. "
        "Output plain text only (no markdown, no code fences). "
        "Keep it concise and student-friendly so it fits one page."
    )

    gemini_api_key = config.settings.gemini_api_key
    errors: list[str] = []

    if gemini_api_key:
        parts: list[dict[str, Any]] = [
            {"text": f"Presentation file: {presentation_name}\n\nContent:\n{source_excerpt}\n\n{prompt}"}
        ]
        for model_name in _gemini_models_to_try():
            try:
                text_output = _call_gemini(model_name, parts, {"temperature": 0.2}, timeout=30.0)
                if text_output:
                    result = text_output[:6000]
                    database.ai_cache_set(_cache_key, result, ttl_seconds=604800)
                    return result
                raise ValueError("Gemini returned empty notes")
            except httpx.HTTPStatusError as exc:
                errors.append(
                    f"Gemini model {model_name} HTTP {exc.response.status_code}: "
                    f"{exc.response.text[:300]}"
                )
            except (httpx.RequestError, json.JSONDecodeError, KeyError, ValueError) as exc:
                errors.append(f"Gemini model {model_name} error: {str(exc)[:300]}")

    api_key = config.settings.openai_api_key
    model = config.settings.openai_model
    base_url = config.settings.openai_base_url or None

    if api_key and OpenAI is not None:
        client = OpenAI(api_key=api_key, base_url=base_url)
        try:
            response = client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": "You write clear, student-friendly study notes."},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": f"Presentation file: {presentation_name}\n\nContent:\n{source_excerpt}\n\n{prompt}",
                            }
                        ],
                    },
                ],
                temperature=0.2,
            )
            text_output = response.output_text.strip()
            if text_output:
                result = text_output[:6000]
                database.ai_cache_set(_cache_key, result, ttl_seconds=604800)
                return result
            raise ValueError("OpenAI-compatible provider returned empty notes")
        except Exception as exc:
            errors.append(f"OpenAI-compatible error: {str(exc)[:300]}")
    elif api_key and OpenAI is None:
        errors.append("OpenAI-compatible API key is set but OpenAI SDK is unavailable")

    if not gemini_api_key and not api_key:
        raise RuntimeError("No AI provider configured. Set GEMINI_API_KEY (recommended).")

    if errors:
        raise RuntimeError("; ".join(errors))

    raise RuntimeError("Student-notes generation failed with unknown AI error")


STUDENT_NOTES_IMAGE_PROMPT_TEMPLATE = (
    "A high-resolution, top-down flat lay of a single page of handwritten student notes on white "
    "[lined/grid] paper, isolated on a plain background for easy PNG conversion. The style is \"Gen Z studygram\": "
    "neat but organic handwriting using a black 0.5mm gel pen, with key terms highlighted in mild pastel colors "
    "(lemon yellow and mint green). Includes hand-drawn arrows, small aesthetic doodles in the margins "
    "(like tiny stars or chemistry beakers), and a \"header\" title in simple faux-calligraphy. "
    "The paper has slight natural crinkles. Lighting is bright, even, and clinical. Soft shadows only. "
    "8k resolution, macro photography style, extremely legible text."
)


def build_notes_image_prompt(notes_text: str) -> str:
    normalized_notes = (notes_text or "").strip()
    return (
        f"{STUDENT_NOTES_IMAGE_PROMPT_TEMPLATE}\n\n"
        "Write exactly this study-notes content on the page and keep it fully legible:\n"
        "---\n"
        f"{normalized_notes[:5000]}\n"
        "---\n"
        "Do not add logos, watermarks, or extra pages. Keep one page only."
    )


def generate_notes_png_with_ai(notes_text: str) -> bytes:
    gemini_api_key = config.settings.gemini_api_key
    configured_model = config.settings.gemini_image_model

    if not gemini_api_key:
        raise RuntimeError("Gemini image generation is unavailable. Set GEMINI_API_KEY.")

    prompt = build_notes_image_prompt(notes_text)

    models_to_try: list[str] = []
    if configured_model:
        models_to_try.append(configured_model)

    for candidate in [
        "gemini-2.5-flash-image",
        "gemini-2.5-flash-image-preview",
        "gemini-2.0-flash-preview-image-generation",
        "gemini-2.0-flash-exp-image-generation",
    ]:
        if candidate not in models_to_try:
            models_to_try.append(candidate)

    try:
        resp = httpx.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": gemini_api_key},
            timeout=20.0,
        )
        resp.raise_for_status()
        for model_entry in resp.json().get("models", []):
            name = str(model_entry.get("name", ""))
            if not name:
                continue
            short_name = name.split("models/", 1)[-1]
            generation_methods = [str(m) for m in model_entry.get("supportedGenerationMethods", [])]
            if "generateContent" not in generation_methods:
                continue
            lower = short_name.lower()
            if any(token in lower for token in ["image", "vision", "imagen", "preview"]):
                if short_name not in models_to_try:
                    models_to_try.append(short_name)
    except Exception:
        pass

    errors: list[str] = []

    def decode_image_from_response(response_json: dict[str, Any]) -> bytes | None:
        for candidate in response_json.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data")
                if not inline:
                    continue
                mime_type = (inline.get("mimeType") or inline.get("mime_type") or "").lower()
                if mime_type not in {"image/png", "image/jpeg", "image/webp"}:
                    continue
                data = inline.get("data")
                if data:
                    return b64decode(data)
        return None

    for image_model in models_to_try:
        try:
            response = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{image_model}:generateContent",
                params={"key": gemini_api_key},
                json={
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.35,
                        "responseModalities": ["IMAGE", "TEXT"],
                    },
                },
                timeout=80.0,
            )
            response.raise_for_status()
            image_bytes = decode_image_from_response(response.json())
            if image_bytes:
                return image_bytes
            errors.append(f"{image_model}: response had no inline image bytes")
        except httpx.HTTPStatusError as exc:
            errors.append(f"{image_model} HTTP {exc.response.status_code}: {exc.response.text[:240]}")
        except Exception as exc:
            errors.append(f"{image_model}: {str(exc)[:240]}")

    raise RuntimeError("Gemini image generation failed: " + " | ".join(errors[:3]))
