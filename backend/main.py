import os
import uuid
import yt_dlp
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import assemblyai as aai

app = FastAPI()

DOWNLOADS_DIR = "downloads"
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

YOUTUBE_URL = "https://www.youtube.com/watch?v=-jYfC4YYXIw"
aai.settings.api_key = "1de991989ccd4809a9d6acb1ab71f22f"


class DownloadResponse(BaseModel):
    url: str
    mp3_path: str


def transcribe(audio_file):
    config = aai.TranscriptionConfig(speech_models=["universal-3-pro", "universal-2"], language_detection=True)

    transcript = aai.Transcriber(config=config).transcribe(audio_file)

    if transcript.status == "error":
        raise RuntimeError(f"Transcription failed: {transcript.error}")

    return transcript.text


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

    return transcribe(mp3_filename)


@app.get("/health")
def health():
    return {"status": "ok"}
