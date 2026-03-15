# EchoLearn

An interactive language learning app that turns any YouTube video into a listening comprehension quiz. The video auto-pauses at key moments and asks you questions about what was just said — helping you train your ear and build vocabulary in context.

## Features

- Paste any YouTube URL and start a quiz instantly
- Video auto-pauses after spoken words to test comprehension
- Multiple choice and fill-in-the-blanks question types
- Adaptive difficulty, question frequency, and language focus settings
- Score tracking and past attempts history
- Support for uploaded video/audio files

## Tech Stack

- **Frontend** — React + TypeScript + Tailwind CSS (Vite)
- **Backend** — FastAPI (Python)
- **Transcription** — AssemblyAI
- **Question generation** — Anthropic Claude API
- **Deployment** — Docker Compose

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [AssemblyAI](https://www.assemblyai.com/) API key
- [Anthropic](https://console.anthropic.com/) API key

### Run with Docker

```bash
git clone https://github.com/ft-frank/UNIHACK.git
cd UNIHACK
cp .env.example .env   # then fill in your API keys
docker compose up --build
```

Open **http://localhost** in your browser.

| Service  | URL                   |
|----------|-----------------------|
| Frontend | http://localhost      |
| Backend  | http://localhost:8000 |

### Run without Docker

**Backend**
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Frontend runs at **http://localhost:5173**.

## Usage

1. Paste a YouTube URL and click **Load Video**
2. The video plays while questions are generated in the background
3. The video auto-pauses after a word is spoken — answer the question, then continue
4. Adjust difficulty, frequency, and focus areas in **Settings** before loading

## Stopping

```bash
docker compose down
```
