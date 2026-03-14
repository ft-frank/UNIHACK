import os
import json
import uuid
import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import assemblyai as aai
import anthropic

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DOWNLOADS_DIR = "downloads"
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

YOUTUBE_URL = "https://www.youtube.com/watch?v=-jYfC4YYXIwx"
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


class DownloadResponse(BaseModel):
    url: str
    mp3_path: str


def transcribe(audio_file):
    config = aai.TranscriptionConfig(speech_models=["universal-3-pro", "universal-2"], language_detection=True)

    transcript = aai.Transcriber(config=config).transcribe(audio_file)

    if transcript.status == "error":
        raise RuntimeError(f"Transcription failed: {transcript.error}")

    return {
        "text": transcript.text,
        "words": [
            {
                "text": word.text,
                "start": word.start,
                "end": word.end,
                "confidence": word.confidence,
            }
            for word in transcript.words
        ],
    }


def extract_difficult_words(transcript_data: dict) -> list:
    words = transcript_data["words"]
    transcript_text = transcript_data["text"]

    words_with_timestamps = json.dumps([
        {"word": w["text"], "start_ms": w["start"], "end_ms": w["end"]}
        for w in words
    ])

    prompt = f"""Identify the 20 hardest words to hear for a cochlear implant listener from this transcript. Mix of: easily confused short words (e.g. "this"/"these", "then"/"than") and long complex words. Prioritise words that sound similar to common alternatives.

Transcript: {transcript_text}

Word timestamps (ms): {words_with_timestamps}

Return ONLY a JSON array of 20 objects with fields:
- "word": as it appears in transcript
- "start_ms": start timestamp
- "end_ms": end timestamp
- "similar_words": 3 words that sound similar (MCQ distractors)

JSON only, no explanation."""

    message = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()
    # Strip markdown code fences if present
    if response_text.startswith("```"):
        response_text = response_text.split("```")[1]
        if response_text.startswith("json"):
            response_text = response_text[4:]
        response_text = response_text.strip()

    return json.loads(response_text)


@app.get("/")
def download():
    url = 'https://www.youtube.com/watch?v=KcT3aVgrrpU'

    mp4_opts = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': '%(title)s.%(ext)s',
        'merge_output_format': 'mp4',
        'quiet': False,
    }

    mp3_file = {}

    def mp3_hook(d):
        if d["status"] == "finished":
            mp3_file["path"] = d["info_dict"].get("filepath", d["info_dict"].get("_filename", ""))

    mp3_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': '%(title)s.%(ext)s',
        'quiet': False,
        'postprocessor_hooks': [mp3_hook],
    }

    def run_download(opts, label):
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                print(f"Downloading {label}...")
                ydl.download([url])
                print(f"{label} download complete!")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"{label} download failed: {e}")

    run_download(mp4_opts, "MP4")
    run_download(mp3_opts, "MP3")

    mp3_filename = mp3_file.get("path", "")

    transcript_data = transcribe(mp3_filename)
    difficult_words = extract_difficult_words(transcript_data)
    return {"difficult_words": difficult_words}


@app.get("/health")
def health():
    return {"status": "ok"}
