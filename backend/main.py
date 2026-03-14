import os
import json
import uuid
import yt_dlp
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import assemblyai as aai
import anthropic

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
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
    difficulty: str = "Beginner"
    frequency: str = "3-5"
    specificGroups: str = ""
    specificSounds: str = ""


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

    num_questions = frequency.split("-")[1] if "-" in frequency else "5"
    extra_instructions = []
    if specific_groups:
        extra_instructions.append(f"- Focus questions on the phonetic group: {specific_groups}")
    if specific_sounds:
        extra_instructions.append(f"- Focus questions on the specific sound: {specific_sounds}")
    extra = "\n".join(extra_instructions)

    prompt = f"""You are generating quiz questions for an interactive video player.

Given this transcript (with timestamps in seconds):

{timed_transcript}

Generate {num_questions} multiple-choice questions spread throughout the video. Each question should:
- Be appropriate for a {difficulty} level learner
- Test comprehension of something mentioned in the transcript
- Have exactly 4 answer choices (a, b, c, d)
- Have one correct answer
- Use a timestamp (in seconds) that is AFTER the relevant content was spoken
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


@app.get("/health")
def health():
    return {"status": "ok"}
