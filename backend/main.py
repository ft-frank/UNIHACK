import os
import json
import uuid
from threading import Lock, Thread
from typing import Any, List, Optional
from datetime import datetime
from pathlib import Path

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

from dotenv import load_dotenv
load_dotenv()
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
anthropic_client = anthropic.Anthropic()


class QuestionRequest(BaseModel):
    url: str
    type: str = "Lecture"
    difficulty: str = "Beginner"
    frequency: str = "3-5"
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
    word: Optional[str] = None
    phoneticCategory: Optional[str] = None

DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)


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


# Data storage functions
def get_user_progress(user_id: str = "default_user") -> UserProgress:
    """Load user progress from file"""
    progress_file = Path(DATA_DIR) / f"{user_id}_progress.json"
    if progress_file.exists():
        try:
            with open(progress_file, 'r') as f:
                data = json.load(f)
                return UserProgress(**data)
        except Exception:
            pass
    return UserProgress(userId=user_id)


def save_user_progress(progress: UserProgress):
    """Save user progress to file"""
    progress_file = Path(DATA_DIR) / f"{progress.userId}_progress.json"
    progress.lastUpdated = datetime.now().isoformat()
    with open(progress_file, 'w') as f:
        json.dump(progress.dict(), f, indent=2)


def save_question_result(result: QuestionResult):
    """Save a question result and update user progress"""
    results_file = Path(DATA_DIR) / f"{result.videoId}_results.json"
    
    # Load existing results
    results = []
    if results_file.exists():
        try:
            with open(results_file, 'r') as f:
                results = json.load(f)
        except Exception:
            results = []
    
    # Add new result
    results.append(result.dict())
    
    # Save results
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2)
    
    # Update user progress
    progress = get_user_progress()
    progress.totalQuestions += 1
    if result.correct:
        progress.correctAnswers += 1
    
    # Track phonetic errors
    if not result.correct and result.phoneticCategory:
        progress.phoneticErrors[result.phoneticCategory] = progress.phoneticErrors.get(result.phoneticCategory, 0) + 1
    
    # Track word errors
    if not result.correct and result.word:
        progress.wordErrors[result.word] = progress.wordErrors.get(result.word, 0) + 1
    
    # Update proficiency level
    accuracy = progress.correctAnswers / progress.totalQuestions if progress.totalQuestions > 0 else 0
    if accuracy >= 0.8:
        progress.proficiencyLevel = "Advanced"
    elif accuracy >= 0.6:
        progress.proficiencyLevel = "Intermediate"
    else:
        progress.proficiencyLevel = "Beginner"
    
    save_user_progress(progress)


def get_question_results(video_id: str) -> List[QuestionResult]:
    """Get all question results for a video"""
    results_file = Path(DATA_DIR) / f"{video_id}_results.json"
    if results_file.exists():
        try:
            with open(results_file, 'r') as f:
                data = json.load(f)
                return [QuestionResult(**r) for r in data]
        except Exception:
            pass
    return []


def download_audio(url: str) -> str:
    output_path = os.path.join(DOWNLOADS_DIR, f"{uuid.uuid4()}.%(ext)s")
    downloaded_file: dict[str, str] = {}

    def hook(d):
        if d["status"] == "finished":
            downloaded_file["path"] = d["info_dict"].get("filepath", d["info_dict"].get("_filename", ""))

    opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_path,
        'quiet': True,
        'postprocessor_hooks': [hook],
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    path = downloaded_file.get("path", "")
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


def generate_questions(transcript, quiz_type: str = "Lecture", difficulty: str = "Beginner", frequency: str = "3-5", specific_groups: str = "", specific_sounds: str = "", user_progress: Optional[UserProgress] = None) -> list:
    num_questions = frequency.split("-")[1] if "-" in frequency else "5"

    timed_transcript = build_transcript_lines(transcript)

    # Adaptive Difficulty Override
    if user_progress and user_progress.totalQuestions >= 5:
        difficulty = user_progress.proficiencyLevel

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
        
        extra = "\n".join(extra_instructions)

        prompt = f"""You are generating hearing rehabilitation exercises for a cochlear implant or hearing-impaired patient.

Given this word-level transcript (each word has a start and end time in seconds):

{word_transcript}

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

    else:  # Lecture (default)
        prompt = f"""You are generating comprehension quiz questions for an interactive video lecture player.

Given this transcript (with timestamps in seconds):

{timed_transcript}

Generate {num_questions} multiple-choice questions spread throughout the video. Place each question shortly after the relevant topic has been fully explained — not mid-explanation.

Each question should:
- Be appropriate for a {difficulty} level learner
- Test understanding of a concept, fact, or idea from the lecture
- Have exactly 4 answer choices
- Have one clearly correct answer
- Use a timestamp (in seconds) that is AFTER the topic was covered

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

    # Extract the JSON array from the response, handling code fences or surrounding text
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        raw = raw[start:end + 1]

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
        user_progress = get_user_progress()
        questions = generate_questions(
            transcript,
            req.type,
            req.difficulty,
            req.frequency,
            req.specificGroups,
            req.specificSounds,
            user_progress
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
        user_progress = get_user_progress()
        questions = generate_questions(transcript, req.type, req.difficulty, req.frequency, req.specificGroups, req.specificSounds, user_progress)
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

@app.post("/questions/results")
def submit_question_result(result: QuestionResult):
    try:
        save_question_result(result)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/questions/results/{video_id}")
def get_question_results_endpoint(video_id: str):
    return get_question_results(video_id)
