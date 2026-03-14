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
    allow_origins=["http://localhost:5173"],
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
        speech_model=aai.SpeechModel.best,
        language_detection=True,
        punctuate=True,
        format_text=True,
    )
    transcript = aai.Transcriber(config=config).transcribe(audio_file)
    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(f"Transcription failed: {transcript.error}")
    return transcript


def generate_questions(transcript) -> list:
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

    prompt = f"""You are generating quiz questions for an interactive video player.

Given this transcript (with timestamps in seconds):

{timed_transcript}

Generate 5 multiple-choice questions spread throughout the video. Each question should:
- Test comprehension of something mentioned in the transcript
- Have exactly 4 answer choices (a, b, c, d)
- Have one correct answer
- Use a timestamp (in seconds) that is AFTER the relevant content was spoken

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
    return [
        {
            "timestamp": 10,
            "question": "What is the main topic of this video?",
            "choices": ["Option A", "Option B", "Option C", "Option D"],
            "answerIndex": 0
        },
        {
            "timestamp": 30,
            "question": "Which concept was introduced second?",
            "choices": ["Option A", "Option B", "Option C", "Option D"],
            "answerIndex": 1
        },
        {
            "timestamp": 60,
            "question": "What did the speaker emphasize?",
            "choices": ["Option A", "Option B", "Option C", "Option D"],
            "answerIndex": 2
        },
    ]


@app.get("/health")
def health():
    return {"status": "ok"}
