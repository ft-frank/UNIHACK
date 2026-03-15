# 🎧 Audiobook Index

Search free audiobooks by things that actually matter — how clear the audio is,
who's narrating, how fast they speak, and what genre it is.

Built with YouTube (via yt-dlp), Python audio classifiers (librosa), and
Elasticsearch.

---

## How it works

```
YouTube search
     │
     ▼
yt-dlp  ──  downloads first 20 seconds of each result (parallel)
     │
     ▼
Classifiers  ──  run on the audio snippet
     │   ├── Audio quality  (SNR + spectral flatness → clear/noisy)
     │   ├── Speaker gender (librosa.yin pitch tracking → male/female/child)
     │   ├── Speech rate    (syllable nuclei count → slow/medium/fast)
     │   └── Genre          (keyword match on title → mystery_thriller etc.)
     │
     ▼
Elasticsearch  ──  stores everything, handles all search + filtering
     │
     ▼
REST API  ──  FastAPI on :8000
```

---

## Quick start

### 1 — Install dependencies

```bash
pip install -r requirements.txt
```

Also needs **ffmpeg** on your PATH (used by yt-dlp):
- Windows: `winget install ffmpeg` or download from https://ffmpeg.org/download.html
- Mac: `brew install ffmpeg`

### 2 — Start Elasticsearch

```bash
docker compose up -d
```

Wait ~15 seconds, then check: http://localhost:9200

### 3 — Start the API

```bash
uvicorn api:app --reload --port 8000
```

Interactive docs: **http://localhost:8000/docs**

### 4 — Ingest some audiobooks

Either via the API:
```bash
curl -X POST "http://localhost:8000/ingest?q=mystery+thriller+audiobook&limit=20"
```

Or via the command line:
```bash
python ingest.py --query "science fiction audiobook" --limit 20
python ingest.py --query "classic literature full audiobook"
python ingest.py --query "horror audiobook"
```

---

## API Reference

### `GET /search` — Search and filter

All parameters are optional. Combine freely.

| Parameter          | Type    | Description                                              |
|--------------------|---------|----------------------------------------------------------|
| `q`                | string  | Full-text search (title + author)                        |
| `quality`          | string  | `clear` or `noisy`                                       |
| `speaker`          | string  | `male`, `female`, `child`, or `unknown`                  |
| `speech_rate`      | string  | `slow`, `medium`, or `fast`                              |
| `genre`            | string  | See genre list below                                     |
| `min_clarity`      | float   | 0–1. Use `0.8` for clean audio only                      |
| `min_snr_db`       | float   | Minimum signal-to-noise ratio in dB. `30` = clear        |
| `min_duration_mins`| float   | Minimum audiobook length in minutes                      |
| `max_duration_mins`| float   | Maximum audiobook length in minutes                      |
| `sort_by`          | string  | `relevance`, `clarity`, `speech_rate`, `duration`, `indexed_at` |
| `sort_order`       | string  | `asc` or `desc` (default `desc`)                         |
| `page`             | int     | Page number, 1-based (default `1`)                       |
| `page_size`        | int     | Results per page, max 100 (default `20`)                 |

**Example requests:**

```bash
# Best matching thriller narrated by a male voice
GET /search?q=thriller&speaker=male&sort_by=relevance

# Clearest audio, sorted by clarity score
GET /search?quality=clear&sort_by=clarity

# Slow-paced sci-fi, longer than 3 hours
GET /search?genre=science_fiction&speech_rate=slow&min_duration_mins=180

# Second page of mystery books
GET /search?genre=mystery_thriller&page=2&page_size=10

# Everything, sorted by most recently indexed
GET /search?sort_by=indexed_at
```

**Response shape:**

```json
{
  "total":       23,
  "page":        1,
  "page_size":   20,
  "total_pages": 2,
  "results": [
    {
      "id":          "yt-kc78arfcmRo",
      "title":       "Animal Farm by George Orwell | Full Audiobook",
      "author":      "Gates of Imagination",
      "language":    "English",
      "total_time":  "3:03:23",
      "url_youtube": "https://www.youtube.com/watch?v=kc78arfcmRo",
      "quality":     { "clarity_score": 0.982, "snr_db": 48.03, "label": "clear" },
      "speaker":     { "f0_median_hz": 142.3,  "label": "male" },
      "speech_rate": { "syllables_per_second": 5.19, "label": "fast" },
      "genre":       { "genre": "classic_literature", "genre_confidence": 1.0 },
      "indexed_at":  "2026-03-15T00:43:05Z",
      "_score":      1.0
    }
  ]
}
```

---

### `GET /books/{id}` — Single book

```bash
GET /books/yt-kc78arfcmRo
```

Returns the full document for one book.

---

### `GET /facets` — Filter option counts

Use this to build filter dropdowns in a frontend. Returns how many books
exist for each possible filter value.

```bash
GET /facets
```

```json
{
  "quality":     [{"value": "clear",  "count": 20}, {"value": "noisy", "count": 3}],
  "speaker":     [{"value": "male",   "count": 9},  {"value": "female","count": 7}],
  "speech_rate": [{"value": "medium", "count": 12}, {"value": "slow",  "count": 6}],
  "genre":       [{"value": "mystery_thriller", "count": 6}, ...],
  "stats": {
    "avg_clarity_score":     0.88,
    "avg_f0_hz":             187.4,
    "avg_syllables_per_sec": 3.91
  }
}
```

---

### `POST /ingest` — Add more audiobooks

```bash
POST /ingest?q=agatha+christie+audiobook&limit=20
```

Triggers a background job: searches YouTube, downloads 20s snippets,
classifies audio, and indexes results.

| Parameter | Type | Description                              |
|-----------|------|------------------------------------------|
| `q`       | str  | YouTube search query                     |
| `limit`   | int  | Results to process, max 50 (default 20)  |

```bash
GET /ingest/status   # poll for progress
```

```json
{
  "running": true,
  "query":   "agatha christie audiobook",
  "indexed": 12,
  "skipped": 2,
  "log": [
    "Searching YouTube: 'agatha christie audiobook' …",
    "Downloading 20 snippets …",
    "✓ And Then There Were None | Full Audiobook"
  ]
}
```

---

## Genre labels

| Label                  | Examples                                        |
|------------------------|-------------------------------------------------|
| `science_fiction`      | Dune, Hunger Games, zombie apocalypse           |
| `mystery_thriller`     | Agatha Christie, Jack Reacher, James Patterson  |
| `adventure`            | Jules Verne, treasure hunts, survival           |
| `horror`               | Dracula, Lovecraft, supernatural                |
| `romance`              | Love stories, chick lit                         |
| `historical_fiction`   | Victorian, war, medieval settings               |
| `informational_science`| Darwin, physics, natural history                |
| `philosophy`           | Stoicism, ethics, Meditations                   |
| `biography`            | Memoir, autobiography                           |
| `classic_literature`   | Orwell, Dickens, Austen, Tolkien                |

---

## Storage

| What                    | Where                     | Size estimate        |
|-------------------------|---------------------------|----------------------|
| Audio snippets (20s mp3)| `.cache/mp3/` on disk     | ~400 KB each         |
| Metadata + classifiers  | Elasticsearch `audiobooks`| ~5 KB per document   |
| ES index (10k books)    | Docker volume `esdata`    | ~500 MB              |

Audio snippets are only needed at ingest time. Safe to delete `.cache/` at
any point — they'll be re-downloaded if you re-ingest the same video.

```bash
# Clear the snippet cache
rmdir /s /q .cache       # Windows
rm -rf .cache            # Mac/Linux
```

---

## Project structure

```
files/
├── api.py          ← REST API (FastAPI)
├── ingest.py       ← CLI ingest pipeline
├── classifier.py   ← Audio classifiers (quality, gender, rate, genre)
├── youtube.py      ← YouTube search + parallel download
├── indexer.py      ← Elasticsearch index setup + query helpers
├── search_cli.py   ← Terminal search tool
├── docker-compose.yml
└── requirements.txt
```