import os
import json
import re
import uuid
import shutil
import logging
from threading import Lock, Thread
from typing import Any, List, Optional
from datetime import datetime
from pathlib import Path

import yt_dlp
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi import Header
from pydantic import BaseModel
import assemblyai as aai
import anthropic
import requests

from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

app = FastAPI()

DEFAULT_CORS_ORIGINS = [
    "http://localhost",
    "http://127.0.0.1",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]


def get_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "").strip()
    if not raw:
        return DEFAULT_CORS_ORIGINS

    return [origin.strip() for origin in raw.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_PATH = BASE_DIR / "downloads"
DOWNLOADS_PATH.mkdir(parents=True, exist_ok=True)
DOWNLOADS_DIR = str(DOWNLOADS_PATH)

from dotenv import load_dotenv
load_dotenv()
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
anthropic_client = anthropic.Anthropic()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


class QuestionRequest(BaseModel):
    url: str
    type: str = "Cochlear"
    difficulty: str = "Beginner"
    frequency: str = "3-5"
    cochlearAssessmentMode: str = "multiple-choice"
    specificGroups: str = ""
    specificSounds: str = ""

class UserProgress(BaseModel):
    userId: str
    totalQuestions: int = 0
    correctAnswers: int = 0
    phoneticErrors: dict = {}
    wordErrors: dict = {}
    proficiencyLevel: str = "Beginner"
    lastUpdated: str = ""

class QuestionResult(BaseModel):
    videoId: str
    timestamp: int
    correct: bool
    questionText: Optional[str] = None
    selectedAnswer: Optional[str] = None
    correctAnswer: Optional[str] = None
    word: Optional[str] = None
    phoneticCategory: Optional[str] = None


class VideoScoreRecord(BaseModel):
    id: str
    videoId: str
    videoName: str
    completedAt: str
    score: int
    totalQuestions: int
    percentage: int


class ProfileUpdateRequest(BaseModel):
    username: Optional[str] = None
    theme: Optional[str] = None
    settings: Optional[dict[str, Any]] = None


class UploadQuestionRequest(BaseModel):
    filename: str
    mediaId: str
    type: str = "Cochlear"
    difficulty: str = "Beginner"
    frequency: str = "3-5"
    cochlearAssessmentMode: str = "multiple-choice"
    specificGroups: str = ""
    specificSounds: str = ""

DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)


jobs_lock = Lock()
jobs: dict[str, dict[str, Any]] = {}

GENERIC_FOCUS_TERMS = {
    "true",
    "false",
    "yes",
    "no",
    "all of the above",
    "none of the above",
}


def ensure_supabase_config() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )


def supabase_admin_request(
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[Any] = None,
) -> Any:
    ensure_supabase_config()
    response = requests.request(
        method,
        f"{SUPABASE_URL}{path}",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        },
        params=params,
        json=json_body,
        timeout=20,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=500, detail=response.text)

    if not response.text:
        return None

    return response.json()


def get_authenticated_user(authorization: Optional[str]) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid authorization token")

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=500,
            detail="Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.",
        )

    response = requests.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
        },
        timeout=20,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=401, detail="Authentication failed")

    return response.json()


def update_job(job_id: str, **fields: Any) -> None:
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(fields)


def get_job(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return dict(job)


# Data storage functions
def get_user_progress(user_id: str) -> UserProgress:
    data = supabase_admin_request(
        "GET",
        "/rest/v1/user_progress",
        params={
            "user_id": f"eq.{user_id}",
            "select": "*",
            "limit": 1,
        },
    )

    if data:
        return UserProgress(
            userId=user_id,
            totalQuestions=data[0].get("total_questions", 0),
            correctAnswers=data[0].get("correct_answers", 0),
            phoneticErrors=data[0].get("phonetic_errors", {}) or {},
            wordErrors=data[0].get("word_errors", {}) or {},
            proficiencyLevel=data[0].get("proficiency_level", "Beginner"),
            lastUpdated=data[0].get("last_updated", "") or "",
        )

    return UserProgress(userId=user_id)


def save_user_progress(progress: UserProgress):
    progress.lastUpdated = datetime.now().isoformat()
    supabase_admin_request(
        "POST",
        "/rest/v1/user_progress",
        params={"on_conflict": "user_id"},
        json_body={
            "user_id": progress.userId,
            "total_questions": progress.totalQuestions,
            "correct_answers": progress.correctAnswers,
            "phonetic_errors": progress.phoneticErrors,
            "word_errors": progress.wordErrors,
            "proficiency_level": progress.proficiencyLevel,
            "last_updated": progress.lastUpdated,
        },
    )


def get_all_question_results(user_id: str) -> List[dict[str, Any]]:
    return supabase_admin_request(
        "GET",
        "/rest/v1/question_results",
        params={
            "user_id": f"eq.{user_id}",
            "select": "correct,word,correct_answer,phonetic_category,question_text,created_at",
            "order": "created_at.asc",
        },
    ) or []


def normalize_focus_label(value: Optional[str]) -> str:
    if not value:
        return ""

    normalized = re.sub(r"\s+", " ", value.strip().lower())
    normalized = normalized.strip(" ,.;:!?\"'")
    return normalized[:120]


def extract_focus_label(result: dict[str, Any]) -> str:
    word = normalize_focus_label(result.get("word"))
    if word:
        return word

    answer = normalize_focus_label(result.get("correct_answer"))
    if not answer or answer in GENERIC_FOCUS_TERMS:
        return ""

    if len(answer.split()) > 8:
        return ""

    return answer


def update_performance_bucket(
    stats: dict[str, dict[str, float]],
    label: str,
    is_correct: bool,
) -> None:
    if not label:
        return

    bucket = stats.setdefault(label, {"attempts": 0, "correct": 0})
    bucket["attempts"] += 1
    if is_correct:
        bucket["correct"] += 1


def summarize_performance_bucket(
    stats: dict[str, dict[str, float]],
    *,
    weaker_threshold: float,
    stronger_threshold: float,
    min_attempts_for_strength: int,
    limit: int = 5,
) -> dict[str, list[dict[str, float | str]]]:
    weaknesses: list[dict[str, float | str]] = []
    strengths: list[dict[str, float | str]] = []

    for label, values in stats.items():
        attempts = int(values["attempts"])
        correct = int(values["correct"])
        accuracy = correct / attempts if attempts else 0.0
        wrong = attempts - correct
        item: dict[str, float | str] = {
            "label": label,
            "attempts": attempts,
            "correct": correct,
            "wrong": wrong,
            "accuracy": round(accuracy, 3),
        }

        if wrong > 0 and accuracy <= weaker_threshold:
            weaknesses.append(item)

        if attempts >= min_attempts_for_strength and accuracy >= stronger_threshold:
            strengths.append(item)

    weaknesses.sort(key=lambda item: (item["accuracy"], -item["attempts"], -item["wrong"]))  # type: ignore[index]
    strengths.sort(key=lambda item: (-item["accuracy"], -item["attempts"], item["label"]))  # type: ignore[index]

    return {
        "weaknesses": weaknesses[:limit],
        "strengths": strengths[:limit],
    }


def build_adaptive_learning_profile(user_id: str) -> dict[str, Any]:
    results = get_all_question_results(user_id)
    category_stats: dict[str, dict[str, float]] = {}
    focus_stats: dict[str, dict[str, float]] = {}

    for result in results:
        is_correct = bool(result.get("correct"))
        category = normalize_focus_label(result.get("phonetic_category"))
        focus_label = extract_focus_label(result)

        update_performance_bucket(category_stats, category, is_correct)
        update_performance_bucket(focus_stats, focus_label, is_correct)

    category_summary = summarize_performance_bucket(
        category_stats,
        weaker_threshold=0.6,
        stronger_threshold=0.85,
        min_attempts_for_strength=3,
    )
    focus_summary = summarize_performance_bucket(
        focus_stats,
        weaker_threshold=0.65,
        stronger_threshold=0.85,
        min_attempts_for_strength=3,
    )

    total_attempts = len(results)
    total_correct = sum(1 for result in results if result.get("correct"))

    return {
        "total_attempts": total_attempts,
        "accuracy": round(total_correct / total_attempts, 3) if total_attempts else None,
        "weak_categories": category_summary["weaknesses"],
        "strong_categories": category_summary["strengths"],
        "weak_focuses": focus_summary["weaknesses"],
        "strong_focuses": focus_summary["strengths"],
    }


def format_adaptive_items(items: list[dict[str, float | str]]) -> str:
    return ", ".join(
        f"{item['label']} ({int(item['correct'])}/{int(item['attempts'])} correct)"
        for item in items
    )


def build_adaptive_question_plan(
    adaptive_profile: Optional[dict[str, Any]],
    num_questions: int,
) -> dict[str, Any]:
    if not adaptive_profile or not adaptive_profile.get("total_attempts") or num_questions <= 0:
        return {
            "min_weak_focus_questions": 0,
            "min_weak_category_questions": 0,
            "max_strong_focus_questions": num_questions,
            "max_strong_category_questions": num_questions,
        }

    weak_focuses = adaptive_profile.get("weak_focuses") or []
    weak_categories = adaptive_profile.get("weak_categories") or []
    strong_focuses = adaptive_profile.get("strong_focuses") or []
    strong_categories = adaptive_profile.get("strong_categories") or []

    weak_focus_pressure = min(len(weak_focuses), max(1, round(num_questions * 0.4))) if weak_focuses else 0
    weak_category_pressure = min(
        len(weak_categories),
        max(1, round(num_questions * 0.35))
    ) if weak_categories else 0

    strong_focus_cap = max(0, round(num_questions * 0.15)) if strong_focuses else num_questions
    strong_category_cap = max(0, round(num_questions * 0.2)) if strong_categories else num_questions

    return {
        "min_weak_focus_questions": min(weak_focus_pressure, num_questions),
        "min_weak_category_questions": min(weak_category_pressure, num_questions),
        "max_strong_focus_questions": min(strong_focus_cap, num_questions),
        "max_strong_category_questions": min(strong_category_cap, num_questions),
    }


def build_adaptive_constraints(
    adaptive_profile: Optional[dict[str, Any]],
    num_questions: int,
) -> str:
    if not adaptive_profile or not adaptive_profile.get("total_attempts"):
        return ""

    weak_categories = adaptive_profile.get("weak_categories") or []
    weak_focuses = adaptive_profile.get("weak_focuses") or []
    strong_categories = adaptive_profile.get("strong_categories") or []
    strong_focuses = adaptive_profile.get("strong_focuses") or []
    plan = build_adaptive_question_plan(adaptive_profile, num_questions)

    lines = ["Adaptive selection rules you must follow if the transcript allows it:"]

    if weak_focuses:
        lines.append(
            f"- Include at least {plan['min_weak_focus_questions']} question(s) that target these weaker words or phrases: {format_adaptive_items(weak_focuses)}"
        )
    if weak_categories:
        lines.append(
            f"- Include at least {plan['min_weak_category_questions']} question(s) that target these weaker categories: {format_adaptive_items(weak_categories)}"
        )
    if strong_focuses:
        lines.append(
            f"- Include at most {plan['max_strong_focus_questions']} question(s) from these stronger words or phrases: {format_adaptive_items(strong_focuses)}"
        )
    if strong_categories:
        lines.append(
            f"- Include at most {plan['max_strong_category_questions']} question(s) from these stronger categories: {format_adaptive_items(strong_categories)}"
        )

    lines.append(
        "- If an exact weak target does not appear naturally in this transcript, choose the closest similar concept, phrase, or sound pattern instead."
    )
    return "\n".join(lines)


def build_adaptive_guidance(adaptive_profile: Optional[dict[str, Any]]) -> str:
    if not adaptive_profile or not adaptive_profile.get("total_attempts"):
        return ""

    guidance_lines = ["Adaptive focus guidance from this user's past answers:"]

    weak_categories = adaptive_profile.get("weak_categories") or []
    weak_focuses = adaptive_profile.get("weak_focuses") or []
    strong_categories = adaptive_profile.get("strong_categories") or []
    strong_focuses = adaptive_profile.get("strong_focuses") or []
    accuracy = adaptive_profile.get("accuracy")

    if accuracy is not None:
        guidance_lines.append(
            f"- Historical accuracy across saved results: {round(float(accuracy) * 100)}%"
        )

    if weak_categories:
        guidance_lines.append(
            f"- Prioritise these harder categories more often: {format_adaptive_items(weak_categories)}"
        )
    if weak_focuses:
        guidance_lines.append(
            f"- Prioritise these harder words or phrases more often: {format_adaptive_items(weak_focuses)}"
        )
    if strong_categories:
        guidance_lines.append(
            f"- These categories look mostly mastered, so use them less often unless needed for variety: {format_adaptive_items(strong_categories)}"
        )
    if strong_focuses:
        guidance_lines.append(
            f"- These words or phrases look mostly mastered, so de-prioritise them in future questions: {format_adaptive_items(strong_focuses)}"
        )

    guidance_lines.append(
        "- Use these trends as a bias, not a hard rule: still keep question sets varied and natural."
    )
    return "\n".join(guidance_lines)


def save_question_result(user_id: str, result: QuestionResult):
    supabase_admin_request(
        "POST",
        "/rest/v1/question_results",
        json_body={
            "user_id": user_id,
            "video_id": result.videoId,
            "timestamp": result.timestamp,
            "correct": result.correct,
            "question_text": result.questionText,
            "selected_answer": result.selectedAnswer,
            "correct_answer": result.correctAnswer,
            "word": result.word,
            "phonetic_category": result.phoneticCategory,
        },
    )

    progress = get_user_progress(user_id)
    progress.totalQuestions += 1
    if result.correct:
        progress.correctAnswers += 1

    if result.phoneticCategory:
        category_count = progress.phoneticErrors.get(result.phoneticCategory, 0)
        if result.correct:
            if category_count <= 1:
                progress.phoneticErrors.pop(result.phoneticCategory, None)
            else:
                progress.phoneticErrors[result.phoneticCategory] = category_count - 1
        else:
            progress.phoneticErrors[result.phoneticCategory] = category_count + 1

    if result.word:
        word_count = progress.wordErrors.get(result.word, 0)
        if result.correct:
            if word_count <= 1:
                progress.wordErrors.pop(result.word, None)
            else:
                progress.wordErrors[result.word] = word_count - 1
        else:
            progress.wordErrors[result.word] = word_count + 1

    accuracy = progress.correctAnswers / progress.totalQuestions if progress.totalQuestions > 0 else 0
    if accuracy >= 0.8:
        progress.proficiencyLevel = "Advanced"
    elif accuracy >= 0.6:
        progress.proficiencyLevel = "Intermediate"
    else:
        progress.proficiencyLevel = "Beginner"

    save_user_progress(progress)


def get_question_results(user_id: str, video_id: str) -> List[QuestionResult]:
    data = supabase_admin_request(
        "GET",
        "/rest/v1/question_results",
        params={
            "user_id": f"eq.{user_id}",
            "video_id": f"eq.{video_id}",
            "select": "*",
            "order": "created_at.asc",
        },
    )

    return [
        QuestionResult(
            videoId=row["video_id"],
            timestamp=row["timestamp"],
            correct=row["correct"],
            questionText=row.get("question_text"),
            selectedAnswer=row.get("selected_answer"),
            correctAnswer=row.get("correct_answer"),
            word=row.get("word"),
            phoneticCategory=row.get("phonetic_category"),
        )
        for row in data or []
    ]


def list_score_history(user_id: str) -> List[VideoScoreRecord]:
    data = supabase_admin_request(
        "GET",
        "/rest/v1/video_score_history",
        params={
            "user_id": f"eq.{user_id}",
            "select": "*",
            "order": "completed_at.desc",
        },
    )

    return [
        VideoScoreRecord(
            id=row["id"],
            videoId=row["video_id"],
            videoName=row["video_name"],
            completedAt=row["completed_at"],
            score=row["score"],
            totalQuestions=row["total_questions"],
            percentage=row["percentage"],
        )
        for row in data or []
    ]


def save_score_record(user_id: str, record: VideoScoreRecord) -> List[VideoScoreRecord]:
    supabase_admin_request(
        "POST",
        "/rest/v1/video_score_history",
        json_body={
            "id": record.id,
            "user_id": user_id,
            "video_id": record.videoId,
            "video_name": record.videoName,
            "completed_at": record.completedAt,
            "score": record.score,
            "total_questions": record.totalQuestions,
            "percentage": record.percentage,
        },
    )
    return list_score_history(user_id)


def clear_score_history(user_id: str):
    supabase_admin_request(
        "DELETE",
        "/rest/v1/video_score_history",
        params={"user_id": f"eq.{user_id}"},
    )
    supabase_admin_request(
        "DELETE",
        "/rest/v1/question_results",
        params={"user_id": f"eq.{user_id}"},
    )
    save_user_progress(UserProgress(userId=user_id))


def fetch_profile_by_user_id(user_id: str) -> Optional[dict[str, Any]]:
    data = supabase_admin_request(
        "GET",
        "/rest/v1/profiles",
        params={
            "id": f"eq.{user_id}",
            "select": "*",
            "limit": 1,
        },
    )

    if data:
        return data[0]
    return None


def get_profile(user: dict[str, Any]) -> dict[str, Any]:
    user_id = user["id"]
    existing = fetch_profile_by_user_id(user_id)
    if existing:
        return existing

    profile = {
        "id": user_id,
        "email": user.get("email"),
        "username": user.get("user_metadata", {}).get("username") or user.get("email", "friend").split("@")[0],
        "theme": "light",
        "settings": {
            "type": "Cochlear",
            "difficulty": "Beginner",
            "frequency": "3-5",
            "cochlearAssessmentMode": "multiple-choice",
            "specificGroups": "",
            "specificSounds": "",
        },
    }
    supabase_admin_request(
        "POST",
        "/rest/v1/profiles",
        json_body=profile,
    )
    return profile


def update_profile(user_id: str, payload: ProfileUpdateRequest) -> dict[str, Any]:
    existing = fetch_profile_by_user_id(user_id) or {
        "id": user_id,
        "email": None,
        "username": "friend",
        "theme": "light",
        "settings": {},
    }
    updated = {
        "id": user_id,
        "email": existing.get("email"),
        "username": payload.username if payload.username is not None else existing.get("username"),
        "theme": payload.theme if payload.theme is not None else existing.get("theme", "light"),
        "settings": payload.settings if payload.settings is not None else existing.get("settings", {}),
    }
    supabase_admin_request(
        "POST",
        "/rest/v1/profiles",
        params={"on_conflict": "id"},
        json_body=updated,
    )
    return updated


def download_audio(url: str) -> str:
    output_path = str(DOWNLOADS_PATH / f"{uuid.uuid4()}.%(ext)s")
    opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_path,
        'quiet': True,
        'noplaylist': True,
        'restrictfilenames': True,
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

        requested_downloads = info.get("requested_downloads") or []
        path = (
            requested_downloads[0].get("filepath")
            if requested_downloads
            else info.get("filepath")
        )
        if not path:
            with yt_dlp.YoutubeDL(opts) as ydl:
                path = ydl.prepare_filename(info)

        resolved_path = Path(path).resolve()
        if not resolved_path.exists():
            raise RuntimeError(f"Audio download failed: file not found at {resolved_path}")
        return str(resolved_path)
    except Exception:
        logger.exception("Failed to download audio for URL: %s", url)
        raise


def cleanup_file(file_path: str) -> None:
    if not file_path:
        return

    try:
        path = Path(file_path)
        if path.exists():
            path.unlink()
    except OSError:
        logger.warning("Failed to clean up temporary file: %s", file_path, exc_info=True)


def save_uploaded_media(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "").suffix.lower()
    filename = f"{uuid.uuid4()}{suffix}"
    destination = DOWNLOADS_PATH / filename

    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)

    return destination


def transcribe(audio_file: str):
    config = aai.TranscriptionConfig(
        speech_models=["universal-3-pro", "universal-2"],
        language_code="en",
        punctuate=True,
        format_text=True,
    )
    transcript = aai.Transcriber(config=config).transcribe(audio_file)
    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(f"Transcription failed: {transcript.error}")
    return transcript


def build_transcript_lines(transcript) -> str:
    lines = []
    if transcript.utterances:
        for u in transcript.utterances:
            start_sec = u.start // 1000
            lines.append(f"[{start_sec}s] {u.text}")
    else:
        words = transcript.words or []
        chunk_size = 50
        for i in range(0, len(words), chunk_size):
            chunk = words[i:i + chunk_size]
            start_sec = chunk[0].start // 1000
            text = " ".join(w.text for w in chunk)
            lines.append(f"[{start_sec}s] {text}")
    return "\n".join(lines)


def build_word_transcript(transcript) -> str:
    """Word-level transcript with start, end, and pause_at times for Cochlear mode.
    pause_at is the start of the next word, so the video pauses one word after the target."""
    words = transcript.words or []
    lines = []
    for i, w in enumerate(words):
        start_sec = w.start // 1000
        end_sec = w.end // 1000
        if i + 1 < len(words):
            pause_at_sec = words[i + 1].start // 1000
        else:
            pause_at_sec = end_sec + 1
        lines.append(f"[start:{start_sec}s end:{end_sec}s pause_at:{pause_at_sec}s] {w.text}")
    return "\n".join(lines)


def estimate_transcript_duration_seconds(transcript) -> int:
    """Best-effort duration estimate from transcript metadata or final timestamps."""
    audio_duration = getattr(transcript, "audio_duration", None)
    if isinstance(audio_duration, (int, float)) and audio_duration > 0:
        return max(1, int(round(audio_duration / 1000)))

    words = transcript.words or []
    if words:
        return max(1, int(words[-1].end // 1000))

    utterances = transcript.utterances or []
    if utterances:
        return max(1, int(utterances[-1].end // 1000))

    return 300


def calculate_question_count(frequency: str) -> int:
    """Use the user's selected frequency directly instead of scaling by media length."""
    frequency_to_count = {
        "3-5": 4,
        "5-10": 8,
        "10-15": 12,
    }

    return frequency_to_count.get(frequency, 4)


def calculate_blank_count(frequency: str) -> int:
    frequency_to_blanks = {
        "3-5": 1,
        "5-10": 2,
        "10-15": 3,
    }

    return frequency_to_blanks.get(frequency, 1)


def generate_questions(
    transcript,
    quiz_type: str = "Cochlear",
    difficulty: str = "Beginner",
    frequency: str = "3-5",
    cochlear_assessment_mode: str = "multiple-choice",
    specific_groups: str = "",
    specific_sounds: str = "",
    user_progress: Optional[UserProgress] = None,
    adaptive_profile: Optional[dict[str, Any]] = None,
) -> list:
    duration_seconds = estimate_transcript_duration_seconds(transcript)
    num_questions = calculate_question_count(frequency)
    blank_count = calculate_blank_count(frequency)
    duration_minutes = max(duration_seconds / 60, 1)

    timed_transcript = build_transcript_lines(transcript)
    settings_summary = [
        f"- Quiz type: {quiz_type}",
        f"- Difficulty selected by the user: {difficulty}",
        f"- Question density preference: {frequency}",
        f"- Target question count from the user's frequency selection: {num_questions}",
        f"- Assessment style: {cochlear_assessment_mode}",
    ]

    if quiz_type == "Cochlear":
        settings_summary.append(
            f"- Cochlear assessment mode: {cochlear_assessment_mode}"
        )
        if specific_groups:
            settings_summary.append(f"- Focus phonetic group: {specific_groups}")
        if specific_sounds:
            settings_summary.append(f"- Focus sound: {specific_sounds}")

    if user_progress:
        settings_summary.append(
            f"- User proficiency history for reference only: {user_progress.proficiencyLevel}"
        )
    adaptive_guidance = build_adaptive_guidance(adaptive_profile)
    adaptive_constraints = build_adaptive_constraints(adaptive_profile, num_questions)
    if adaptive_guidance:
        settings_summary.append(adaptive_guidance)
    if adaptive_constraints:
        settings_summary.append(adaptive_constraints)

    settings_block = "\n".join(settings_summary)

    if quiz_type == "Cochlear":
        word_transcript = build_word_transcript(transcript)
        extra_instructions = []
        if specific_groups:
            extra_instructions.append(f"- Prioritise words from the phonetic group: {specific_groups}")
        if specific_sounds:
            extra_instructions.append(f"- Prioritise words containing the sound: {specific_sounds}")
        
        # Add adaptive learning instructions based on user progress
        if user_progress and user_progress.phoneticErrors:
            error_phonetics = sorted(user_progress.phoneticErrors.items(), key=lambda x: x[1], reverse=True)
            top_errors = [phonetic for phonetic, count in error_phonetics[:3]]
            extra_instructions.append(f"- HIGH PRIORITY: Focus on phonetics the user struggles with: {', '.join(top_errors)}")
        if adaptive_guidance:
            extra_instructions.append(f"- Follow this adaptive profile when selecting targets:\n{adaptive_guidance}")
        if adaptive_constraints:
            extra_instructions.append(f"- Treat these as hard selection constraints when possible:\n{adaptive_constraints}")
        
        extra = "\n".join(extra_instructions)

        prompt = f"""You are generating hearing rehabilitation exercises for a cochlear implant or hearing-impaired patient.

Given this word-level transcript (each word has a start and end time in seconds):

{word_transcript}

Use these quiz settings exactly:
{settings_block}

Identify {num_questions} words in the transcript that are phonetically difficult or ambiguous — words commonly confused by people with hearing loss (e.g. minimal pairs, fricatives, vowel contrasts, words that sound similar in context).

For each word, create a question where the patient must identify which word was actually said, given 4 phonetically similar choices.

For a beginner student: atleast 1-2 syllables apart but similar sounding
For an intermediate: same amount of syllables apart but different sounding in 2 different phonemes
For advanced: same amount of syllables but just one phoneme apart

Each question should:
- Be appropriate for a {difficulty} level patient
- Present the choices as plausible-sounding alternatives (minimal pairs or near-homophones)
- Use the word's PAUSE_AT time as the timestamp, so the video pauses one word after the target word has been spoken
- Help train auditory discrimination
{extra}

Return ONLY a JSON array with this exact structure, no other text:
[
{{
    "timestamp": <pause_at time integer seconds>,
    "question": "Which word did the speaker say?",
    "choices": ["<actual word>", "<similar word>", "<similar word>", "<similar word>"],
    "answerIndex": <index of the actual word, 0-3>,
    "phoneticCategory": "<phonetic category like 'fricatives', 'vowel_contrast', 'minimal_pairs', etc.>",
    "word": "<the actual target word>"
}}
]"""

        prompt = f"""You are generating hearing rehabilitation exercises for a cochlear implant or hearing-impaired patient.

Given this word-level transcript (each word has a start and end time in seconds):

{word_transcript}

Also use this sentence-level transcript to preserve natural phrasing:

{timed_transcript}

Use these quiz settings exactly:
{settings_block}

Identify phonetically difficult or ambiguous listening moments - words commonly confused by people with hearing loss (for example minimal pairs, fricatives, vowel contrasts, and words that sound similar in context).

You must return exactly {num_questions} questions total.

Question mix rules:
- If cochlear assessment mode is "multiple-choice", every question must be kind "multiple-choice".
- If cochlear assessment mode is "fill-in-the-blanks", every question must be kind "fill-in-the-blanks".
- If cochlear assessment mode is "both", return a balanced mix of both kinds across the full set.
- You must satisfy the adaptive selection rules below whenever the transcript contains enough relevant material.

For "multiple-choice" questions:
- Create a question where the patient must identify which word was actually said, given 4 phonetically similar choices.
- Use the word's PAUSE_AT time as the timestamp, so the media pauses one word after the target word has been spoken.

For "fill-in-the-blanks" questions:
- Select a short sentence or utterance the speaker just said.
- Blank out acoustically important words from that sentence.
- Use {blank_count} blanks per sentence, unless the sentence is too short, in which case use the maximum sensible number up to {blank_count}.
- Use markers [BLANK_1], [BLANK_2], and so on inside sentenceWithBlanks.
- Return the original full sentence in promptSentence.
- Return the correct missing words in order in the blanks array.
- Use a timestamp after the sentence has been spoken.

For a beginner student: atleast 1-2 syllables apart but similar sounding
For an intermediate: same amount of syllables apart but different sounding in 2 different phonemes
For advanced: same amount of syllables but just one phoneme apart

Each question should:
- Be appropriate for a {difficulty} level patient
- Help train auditory discrimination
{extra}

Return ONLY a JSON array with this exact structure, no other text:
[
{{
    "kind": "multiple-choice",
    "timestamp": <pause_at time integer seconds>,
    "question": "Which word did the speaker say?",
    "choices": ["<actual word>", "<similar word>", "<similar word>", "<similar word>"],
    "answerIndex": <index of the actual word, 0-3>,
    "phoneticCategory": "<phonetic category like 'fricatives', 'vowel_contrast', 'minimal_pairs', etc.>",
    "word": "<the actual target word>"
}},
{{
    "kind": "fill-in-the-blanks",
    "timestamp": <integer seconds after the sentence is spoken>,
    "question": "Fill in the missing words from the sentence.",
    "sentenceWithBlanks": "<sentence with [BLANK_1], [BLANK_2], ... markers>",
    "promptSentence": "<the full original sentence>",
    "blanks": ["<correct word 1>", "<correct word 2>"],
    "phoneticCategory": "<phonetic category like 'fricatives', 'vowel_contrast', 'minimal_pairs', etc.>",
    "word": "<main target word or short phrase>"
}}
]"""
    else:  # Lecture (default)
        prompt = f"""You are generating comprehension quiz questions for an interactive video lecture player.

Given this transcript (with timestamps in seconds) from a video that is about {duration_minutes:.1f} minutes long:

{timed_transcript}

Use these quiz settings exactly:
{settings_block}

Generate exactly {num_questions} lecture questions spread throughout the video. Place each question shortly after the relevant topic has been fully explained - not mid-explanation.

Question mix rules:
- If assessment style is "multiple-choice", every question must be kind "multiple-choice".
- If assessment style is "fill-in-the-blanks", every question must be kind "fill-in-the-blanks".
- If assessment style is "both", return a balanced mix of both kinds across the full set.
- You must satisfy the adaptive selection rules below whenever the transcript contains enough relevant material.

For "multiple-choice" questions:
- Test understanding of a concept, fact, or idea from the lecture.
- Have exactly 4 answer choices.
- Have one clearly correct answer.

For "fill-in-the-blanks" questions:
- Use a short sentence summarizing an important point that was explicitly covered in the lecture.
- Blank out {blank_count} important concept words or fewer if the sentence is too short.
- Use markers [BLANK_1], [BLANK_2], and so on inside sentenceWithBlanks.
- Return the original full sentence in promptSentence.
- Return the correct missing words in order in the blanks array.

Each question should:
- Be appropriate for a {difficulty} level learner
- Use a timestamp (in seconds) that is AFTER the topic was covered
- Be fully answerable from the lecture content alone
- Avoid trivia that was only mentioned in passing
- Bias selection toward the user's weak areas and away from already-mastered words, phrases, or categories whenever the transcript allows it

{adaptive_constraints}

Return ONLY a JSON array with this exact structure, no other text:
[
{{
    "kind": "multiple-choice",
    "timestamp": <integer seconds>,
    "question": "<question text>",
    "choices": ["<choice 0>", "<choice 1>", "<choice 2>", "<choice 3>"],
    "answerIndex": <0-3>
}},
{{
    "kind": "fill-in-the-blanks",
    "timestamp": <integer seconds>,
    "question": "Fill in the missing words from the sentence.",
    "sentenceWithBlanks": "<sentence with [BLANK_1], [BLANK_2], ... markers>",
    "promptSentence": "<the full original sentence>",
    "blanks": ["<correct word 1>", "<correct word 2>"]
}}
]"""

    message = anthropic_client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()

    # Extract the JSON array from the response, handling code fences or surrounding text
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        raw = raw[start:end + 1]

    questions = json.loads(raw)

    normalized_questions = []
    for question in questions:
        if not isinstance(question, dict):
            continue

        kind = question.get("kind") or "multiple-choice"
        question["kind"] = kind

        if kind == "fill-in-the-blanks":
            question["blanks"] = [
                str(blank).strip()
                for blank in question.get("blanks", [])
                if str(blank).strip()
            ]
            question["sentenceWithBlanks"] = question.get(
                "sentenceWithBlanks",
                question.get("promptSentence", ""),
            )
            question["promptSentence"] = question.get(
                "promptSentence",
                question.get("sentenceWithBlanks", ""),
            )
        else:
            question["choices"] = question.get("choices", [])
            question["answerIndex"] = int(question.get("answerIndex", 0))

        question["timestamp"] = int(question.get("timestamp", 0))
        normalized_questions.append(question)

    normalized_questions.sort(key=lambda item: item.get("timestamp", 0))
    return normalized_questions


def run_generation_job(job_id: str, req: QuestionRequest, user_id: str) -> None:
    audio_path = ""
    try:
        update_job(
            job_id,
            status="running",
            stage="Downloading audio",
            progress=10,
        )
        audio_path = download_audio(req.url)

        update_job(
            job_id,
            stage="Transcribing audio",
            progress=45,
        )
        transcript = transcribe(audio_path)

        update_job(
            job_id,
            stage="Generating questions",
            progress=80,
        )
        user_progress = get_user_progress(user_id)
        adaptive_profile = build_adaptive_learning_profile(user_id)
        questions = generate_questions(
            transcript,
            req.type,
            req.difficulty,
            req.frequency,
            req.cochlearAssessmentMode,
            req.specificGroups,
            req.specificSounds,
            user_progress,
            adaptive_profile,
        )

        update_job(
            job_id,
            status="completed",
            stage="Complete",
            progress=100,
            questions=questions,
        )
    except Exception as e:
        logger.exception("Question generation job failed: %s", job_id)
        update_job(
            job_id,
            status="failed",
            stage="Failed",
            error=str(e),
        )
    finally:
        cleanup_file(audio_path)


def run_uploaded_generation_job(
    job_id: str,
    req: UploadQuestionRequest,
    user_id: str,
    media_path: str,
) -> None:
    try:
        update_job(
            job_id,
            status="running",
            stage="Processing upload",
            progress=15,
        )

        update_job(
            job_id,
            stage="Transcribing upload",
            progress=45,
        )
        transcript = transcribe(media_path)

        update_job(
            job_id,
            stage="Generating questions",
            progress=80,
        )
        user_progress = get_user_progress(user_id)
        adaptive_profile = build_adaptive_learning_profile(user_id)
        questions = generate_questions(
            transcript,
            req.type,
            req.difficulty,
            req.frequency,
            req.cochlearAssessmentMode,
            req.specificGroups,
            req.specificSounds,
            user_progress,
            adaptive_profile,
        )

        update_job(
            job_id,
            status="completed",
            stage="Complete",
            progress=100,
            questions=questions,
            mediaId=req.mediaId,
            title=req.filename,
        )
    except Exception as e:
        logger.exception("Uploaded media job failed: %s", job_id)
        update_job(
            job_id,
            status="failed",
            stage="Failed",
            error=str(e),
        )
    finally:
        cleanup_file(media_path)


@app.post("/questions")
def get_questions(req: QuestionRequest, authorization: Optional[str] = Header(default=None)):
    user = get_authenticated_user(authorization)
    try:
        audio_path = download_audio(req.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Download failed: {e}")

    try:
        transcript = transcribe(audio_path)
    except Exception as e:
        logger.exception("Transcription failed for URL request: %s", req.url)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        cleanup_file(audio_path)

    try:
        user_progress = get_user_progress(user["id"])
        adaptive_profile = build_adaptive_learning_profile(user["id"])
        questions = generate_questions(
            transcript,
            req.type,
            req.difficulty,
            req.frequency,
            req.cochlearAssessmentMode,
            req.specificGroups,
            req.specificSounds,
            user_progress,
            adaptive_profile,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Question generation failed: {e}")

    return questions


@app.post("/questions/jobs")
def create_questions_job(req: QuestionRequest, authorization: Optional[str] = Header(default=None)):
    user = get_authenticated_user(authorization)
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "stage": "Queued",
            "progress": 0,
            "questions": None,
            "error": None,
        }

    Thread(target=run_generation_job, args=(job_id, req, user["id"]), daemon=True).start()
    return {"jobId": job_id}


@app.post("/questions/jobs/upload")
async def create_uploaded_questions_job(
    file: UploadFile = File(...),
    type: str = Form("Cochlear"),
    difficulty: str = Form("Beginner"),
    frequency: str = Form("3-5"),
    cochlearAssessmentMode: str = Form("multiple-choice"),
    specificGroups: str = Form(""),
    specificSounds: str = Form(""),
    authorization: Optional[str] = Header(default=None),
):
    user = get_authenticated_user(authorization)

    allowed_extensions = {
        ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
        ".mp4", ".mov", ".m4v", ".webm", ".mpeg", ".mpg",
    }
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Unsupported media type")

    media_path = save_uploaded_media(file)
    job_id = str(uuid.uuid4())
    media_id = f"upload-{job_id}"
    req = UploadQuestionRequest(
        filename=file.filename or "Uploaded media",
        mediaId=media_id,
        type=type,
        difficulty=difficulty,
        frequency=frequency,
        cochlearAssessmentMode=cochlearAssessmentMode,
        specificGroups=specificGroups,
        specificSounds=specificSounds,
    )

    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "stage": "Queued",
            "progress": 0,
            "questions": None,
            "error": None,
            "mediaId": media_id,
            "title": req.filename,
        }

    Thread(
        target=run_uploaded_generation_job,
        args=(job_id, req, user["id"], str(media_path)),
        daemon=True,
    ).start()
    return {"jobId": job_id, "mediaId": media_id, "title": req.filename}


@app.get("/questions/jobs/{job_id}")
def get_questions_job(job_id: str):
    return get_job(job_id)


@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/questions/results")
def submit_question_result(result: QuestionResult, authorization: Optional[str] = Header(default=None)):
    try:
        user = get_authenticated_user(authorization)
        save_question_result(user["id"], result)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/questions/results/{video_id}")
def get_question_results_endpoint(video_id: str, authorization: Optional[str] = Header(default=None)):
    user = get_authenticated_user(authorization)
    return get_question_results(user["id"], video_id)


@app.get("/profile")
def get_profile_endpoint(authorization: Optional[str] = Header(default=None)):
    user = get_authenticated_user(authorization)
    return get_profile(user)


@app.put("/profile")
def update_profile_endpoint(
    payload: ProfileUpdateRequest,
    authorization: Optional[str] = Header(default=None),
):
    user = get_authenticated_user(authorization)
    return update_profile(user["id"], payload)


@app.get("/history")
def get_history_endpoint(authorization: Optional[str] = Header(default=None)):
    user = get_authenticated_user(authorization)
    return list_score_history(user["id"])


@app.post("/history")
def save_history_endpoint(
    record: VideoScoreRecord,
    authorization: Optional[str] = Header(default=None),
):
    user = get_authenticated_user(authorization)
    return save_score_record(user["id"], record)


@app.delete("/history")
def clear_history_endpoint(authorization: Optional[str] = Header(default=None)):
    user = get_authenticated_user(authorization)
    clear_score_history(user["id"])
    return {"status": "success"}
