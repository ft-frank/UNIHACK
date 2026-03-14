import os
import json
import uuid
import sqlite3
from threading import Lock, Thread
from typing import Any

import yt_dlp
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import assemblyai as aai
import anthropic

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DOWNLOADS_DIR = "downloads"
os.makedirs(DOWNLOADS_DIR, exist_ok=True)
DB_PATH = os.path.join(os.path.dirname(__file__), "score_history.db")

from dotenv import load_dotenv
load_dotenv()
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
anthropic_client = anthropic.Anthropic()


class QuestionRequest(BaseModel):
    url: str
    difficulty: str = "Beginner"
    frequency: str = "3-5"
    specificGroups: str = ""
    specificSounds: str = ""


class ScoreRecordCreate(BaseModel):
    videoId: str
    videoName: str
    completedAt: str
    score: int
    totalQuestions: int


def get_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    connection = get_db_connection()
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS score_history (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL,
                video_name TEXT NOT NULL,
                completed_at TEXT NOT NULL,
                score INTEGER NOT NULL,
                total_questions INTEGER NOT NULL,
                percentage INTEGER NOT NULL
            )
            """
        )
        connection.commit()
    finally:
        connection.close()


def serialize_score_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "videoId": row["video_id"],
        "videoName": row["video_name"],
        "completedAt": row["completed_at"],
        "score": row["score"],
        "totalQuestions": row["total_questions"],
        "percentage": row["percentage"],
    }


init_db()


jobs_lock = Lock()
jobs: dict[str, dict[str, Any]] = {}


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


def download_audio(url: str) -> str:
    output_path = os.path.join(DOWNLOADS_DIR, f"{uuid.uuid4()}.%(ext)s")
    mp3_file = {}

    def hook(d):
        if d["status"] == "finished":
            mp3_file["path"] = d["info_dict"].get("filepath", d["info_dict"].get("_filename", ""))

    opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': output_path,
        'quiet': True,
        'postprocessor_hooks': [hook],
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    path = mp3_file.get("path", "")
    if not path or not os.path.exists(path):
        raise RuntimeError("Audio download failed")
    return path


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


def get_transcript_duration_seconds(transcript) -> int:
    if getattr(transcript, "audio_duration", None):
        return max(1, int(transcript.audio_duration // 1000))

    if transcript.utterances:
        return max(1, int(transcript.utterances[-1].end // 1000))

    words = transcript.words or []
    if words:
        return max(1, int(words[-1].end // 1000))

    return 60


def calculate_question_count(duration_seconds: int, frequency: str) -> int:
    base_count = max(2, round(duration_seconds / 90))
    frequency_multiplier = {
        "3-5": 0.8,
        "5-10": 1.0,
        "10-15": 1.35,
    }.get(frequency, 1.0)
    adjusted_count = round(base_count * frequency_multiplier)
    return max(2, min(20, adjusted_count))


def generate_questions(transcript, difficulty: str = "Beginner", frequency: str = "3-5", specific_groups: str = "", specific_sounds: str = "") -> list:
    # Build a condensed transcript with timestamps for Claude
    lines = []
    if transcript.utterances:
        for u in transcript.utterances:
            start_sec = u.start // 1000
            lines.append(f"[{start_sec}s] {u.text}")
    else:
        # Fall back to words if no utterances
        words = transcript.words or []
        chunk_size = 50
        for i in range(0, len(words), chunk_size):
            chunk = words[i:i + chunk_size]
            start_sec = chunk[0].start // 1000
            text = " ".join(w.text for w in chunk)
            lines.append(f"[{start_sec}s] {text}")

    timed_transcript = "\n".join(lines)

    duration_seconds = get_transcript_duration_seconds(transcript)
    num_questions = calculate_question_count(duration_seconds, frequency)
    extra_instructions = []
    if specific_groups:
        extra_instructions.append(f"- Focus questions on the phonetic group: {specific_groups}")
    if specific_sounds:
        extra_instructions.append(f"- Focus questions on the specific sound: {specific_sounds}")
    extra = "\n".join(extra_instructions)

    prompt = f"""You are generating quiz questions for an interactive video player.

Given this transcript (with timestamps in seconds):

{timed_transcript}

The video is approximately {duration_seconds} seconds long.

Generate exactly {num_questions} multiple-choice questions spread throughout the video. Each question should:
- Be appropriate for a {difficulty} level learner
- Test comprehension of something mentioned in the transcript
- Have exactly 4 answer choices (a, b, c, d)
- Have one correct answer
- Use a timestamp (in seconds) that is AFTER the relevant content was spoken
- Scale naturally to the video length, with fewer questions for short videos and more for longer videos
{extra}

Return ONLY a JSON array with this exact structure, no other text:
[
{{
    "timestamp": <integer seconds>,
    "question": "<question text>",
    "choices": ["<choice 0>", "<choice 1>", "<choice 2>", "<choice 3>"],
    "answerIndex": <0-3>
    }}
]"""

    message = anthropic_client.messages.create(
        model="claude-opus-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    questions = json.loads(raw)
    return questions


def run_generation_job(job_id: str, req: QuestionRequest) -> None:
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
        questions = generate_questions(
            transcript,
            req.difficulty,
            req.frequency,
            req.specificGroups,
            req.specificSounds,
        )

        update_job(
            job_id,
            status="completed",
            stage="Complete",
            progress=100,
            questions=questions,
        )
    except Exception as e:
        update_job(
            job_id,
            status="failed",
            stage="Failed",
            error=str(e),
        )
    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)


@app.post("/questions")
def get_questions(req: QuestionRequest):
    try:
        audio_path = download_audio(req.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Download failed: {e}")

    try:
        transcript = transcribe(audio_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        if os.path.exists(audio_path):
            os.remove(audio_path)

    try:
        questions = generate_questions(transcript, req.difficulty, req.frequency, req.specificGroups, req.specificSounds)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Question generation failed: {e}")

    return questions


@app.post("/questions/jobs")
def create_questions_job(req: QuestionRequest):
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

    Thread(target=run_generation_job, args=(job_id, req), daemon=True).start()
    return {"jobId": job_id}


@app.get("/questions/jobs/{job_id}")
def get_questions_job(job_id: str):
    return get_job(job_id)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/scores")
def get_scores():
    connection = get_db_connection()
    try:
        rows = connection.execute(
            """
            SELECT id, video_id, video_name, completed_at, score, total_questions, percentage
            FROM score_history
            ORDER BY datetime(completed_at) DESC, id DESC
            """
        ).fetchall()
        return [serialize_score_row(row) for row in rows]
    finally:
        connection.close()


@app.post("/scores")
def create_score(record: ScoreRecordCreate):
    percentage = round((record.score / record.totalQuestions) * 100) if record.totalQuestions > 0 else 0
    record_id = str(uuid.uuid4())

    connection = get_db_connection()
    try:
        connection.execute(
            """
            INSERT INTO score_history (
                id, video_id, video_name, completed_at, score, total_questions, percentage
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record_id,
                record.videoId,
                record.videoName,
                record.completedAt,
                record.score,
                record.totalQuestions,
                percentage,
            ),
        )
        connection.commit()

        row = connection.execute(
            """
            SELECT id, video_id, video_name, completed_at, score, total_questions, percentage
            FROM score_history
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()
        return serialize_score_row(row)
    finally:
        connection.close()


@app.delete("/scores")
def delete_scores():
    connection = get_db_connection()
    try:
        connection.execute("DELETE FROM score_history")
        connection.commit()
        return {"status": "cleared"}
    finally:
        connection.close()
