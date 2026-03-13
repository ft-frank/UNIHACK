import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
if not API_KEY:
    raise RuntimeError("Missing ASSEMBLYAI_API_KEY in .env")

headers = {"authorization": API_KEY}

filename = "The Most Beautiful Equation in Math [IUTGFQpKaPU].mp4"

with open(filename, "rb") as f:
    upload_res = requests.post(
        "https://api.assemblyai.com/v2/upload",
        headers=headers,
        data=f
    )

if upload_res.status_code != 200:
    raise RuntimeError(f"Upload failed: {upload_res.status_code} {upload_res.text}")

audio_url = upload_res.json()["upload_url"]

transcript_res = requests.post(
    "https://api.assemblyai.com/v2/transcript",
    headers=headers,
    json={
        "audio_url": audio_url
    }
)

if transcript_res.status_code != 200:
    raise RuntimeError(f"Transcript request failed: {transcript_res.status_code} {transcript_res.text}")

transcript_id = transcript_res.json()["id"]

while True:
    poll_res = requests.get(
        f"https://api.assemblyai.com/v2/transcript/%7Btranscript_id%7D",
        headers=headers
    )
    data = poll_res.json()

    if data["status"] == "completed":
        print(data["text"])
        break
    elif data["status"] == "error":
        raise RuntimeError(f"Transcription failed: {data['error']}")

    time.sleep(3)