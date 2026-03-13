import os
import uuid
import yt_dlp
import assemblyai as aai
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

app = FastAPI()

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
DOWNLOADS_DIR = "downloads"
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

YOUTUBE_URL = "https://www.youtube.com/watch?v=-jYfC4YYXIw"


class TranscribeResponse(BaseModel):
    url: str
    transcript: str


@app.get("/", response_model=TranscribeResponse)
def transcribe():
    if not ASSEMBLYAI_API_KEY:
        raise HTTPException(status_code=500, detail="ASSEMBLYAI_API_KEY is not set")

    file_id = str(uuid.uuid4())
    output_path = os.path.join(DOWNLOADS_DIR, file_id)

    actual_mp3 = {}

    def pp_hook(d):
        if d["status"] == "finished":
            actual_mp3["path"] = d["info_dict"].get("filepath", d["info_dict"].get("_filename", ""))

    ydl_opts = {
        "format": "bestaudio/best",
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "outtmpl": output_path,
        "quiet": True,
        "postprocessor_hooks": [pp_hook],
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([YOUTUBE_URL])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Download failed: {e}")

    mp3_path = actual_mp3.get("path", output_path + ".mp3")
    if not os.path.exists(mp3_path):
        raise HTTPException(status_code=500, detail="MP3 file not found after download")

    try:
        aai.settings.api_key = ASSEMBLYAI_API_KEY
        transcriber = aai.Transcriber()
        result = transcriber.transcribe(mp3_path)

        if result.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {result.error}")

        transcript_text = result.text
    finally:
        if os.path.exists(mp3_path):
            os.remove(mp3_path)

    return TranscribeResponse(url=YOUTUBE_URL, transcript=transcript_text)


@app.get("/health")
def health():
    return {"status": "ok"}
