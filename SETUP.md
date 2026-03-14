# Setup Guide

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)
- An [AssemblyAI](https://www.assemblyai.com/) API key
- An [Anthropic](https://console.anthropic.com/) API key

---

## 1. Clone the repo

```bash
git clone https://github.com/ft-frank/UNIHACK.git
cd UNIHACK
```

## 2. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in your API keys:

```
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

## 3. Start the app

```bash
docker compose up --build
```

This builds and starts both services:

| Service  | URL                    | Description              |
|----------|------------------------|--------------------------|
| Frontend | http://localhost       | React app (port 80)      |
| Backend  | http://localhost:8000  | FastAPI server (port 8000)|

> First build takes a few minutes — it installs Python packages and compiles the frontend.

## 4. Open the app

Go to **http://localhost** in your browser.

---

## Usage

1. Paste a YouTube URL into the input field and click **Load Video**
2. The video starts playing immediately while questions are generated in the background
3. The video auto-pauses when a question is ready — answer it, then continue
4. Click the **settings icon** (top right) to adjust difficulty, question frequency, and focus areas before loading a video

---

## Stopping the app

```bash
docker compose down
```

---

## Development (without Docker)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at **http://localhost:5173**, backend at **http://localhost:8000**.
