# Setup Guide

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)
- A [Supabase](https://supabase.com/) project
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
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
VITE_AUTH_REDIRECT_URL=http://localhost:5173
```

## 3. Create the Supabase database schema

1. Open your Supabase project dashboard.
2. Go to `SQL Editor`.
3. Run the contents of `supabase/schema.sql`.

This creates:

- `profiles`
- `user_progress`
- `video_score_history`
- `question_results`
- Row Level Security policies
- A trigger that auto-creates a profile and progress row whenever a new auth user signs up

## 4. Configure Supabase authentication

In your Supabase dashboard:

1. Go to `Authentication` -> `URL Configuration`
2. Set `Site URL` to `http://localhost:5173` for Vite dev or `http://localhost` for Docker
3. Add these redirect URLs:
   - `http://localhost:5173`
   - `http://localhost`

If you keep email confirmation enabled, new users will need to confirm their email before signing in. The app now supports that flow.

## 5. Start the app

```bash
docker compose up --build
```

This builds and starts both services:

| Service  | URL                    | Description              |
|----------|------------------------|--------------------------|
| Frontend | http://localhost       | React app (port 80)      |
| Backend  | http://localhost:8000  | FastAPI server (port 8000)|

> First build takes a few minutes — it installs Python packages and compiles the frontend.

## 6. Open the app

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

For Vite dev, the frontend reads `VITE_*` values from the root `.env` because `frontend/vite.config.ts` points `envDir` to the repo root.
