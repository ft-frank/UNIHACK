# Install the assemblyai package by executing the command "pip install assemblyai"

import os
from dotenv import load_dotenv
import assemblyai as aai

load_dotenv()
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")


audio_file = "./local_file.mp3"

# Uses universal-3-pro for en, es, de, fr, it, pt. Else uses universal-2 for support across all other languages
config = aai.TranscriptionConfig(speech_models=["universal-3-pro", "universal-2"], language_detection=True)

transcript = aai.Transcriber(config=config).transcribe(audio_file)

if transcript.status == "error":
  raise RuntimeError(f"Transcription failed: {transcript.error}")

print(transcript.text)