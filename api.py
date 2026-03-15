"""
api.py  —  Audiobook Index REST API
─────────────────────────────────────
Run:  uvicorn api:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

import threading
from typing import Literal, Optional

from fastapi import FastAPI, Query, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from indexer import get_client, search_books, aggregations, ensure_index, bulk_upsert

# ─────────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "Audiobook Index API",
    description = "Search audiobooks by audio quality, speaker, speech rate, and genre.",
    version     = "2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],
    allow_methods  = ["*"],
    allow_headers  = ["*"],
)

# Shared ingest state (so the frontend can poll progress)
_ingest_state: dict = {"running": False, "indexed": 0, "skipped": 0, "log": []}
_ingest_lock         = threading.Lock()


def _es():
    return get_client()


# ─────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"], summary="Health check")
def health():
    """Returns OK if Elasticsearch is reachable."""
    try:
        info = _es().info()
        return {"status": "ok", "elasticsearch": info["version"]["number"]}
    except Exception as e:
        raise HTTPException(503, detail=f"Elasticsearch unreachable: {e}")


# ─────────────────────────────────────────────────────────────────
# SEARCH  —  the main endpoint
# ─────────────────────────────────────────────────────────────────

@app.get("/search", tags=["Search"], summary="Search and filter audiobooks")
def search(
    # ── Full-text ────────────────────────────────────────────────
    q: Optional[str] = Query(
        None,
        description="Full-text search across title and author. "
                    "Also used as the YouTube search query when ingesting.",
        example="George Orwell thriller",
    ),

    # ── Label filters ────────────────────────────────────────────
    quality: Optional[Literal["clear", "noisy"]] = Query(
        None, description="Audio quality label"),

    speaker: Optional[Literal["male", "female", "child", "unknown"]] = Query(
        None, description="Detected speaker gender"),

    speech_rate: Optional[Literal["slow", "medium", "fast"]] = Query(
        None, description="Speaking pace"),

    genre: Optional[str] = Query(
        None,
        description="Genre label. One of: science_fiction, mystery_thriller, "
                    "adventure, horror, romance, historical_fiction, "
                    "informational_science, philosophy, biography, classic_literature",
        example="mystery_thriller",
    ),

    # ── Numeric range filters ────────────────────────────────────
    min_clarity: Optional[float] = Query(
        None, ge=0.0, le=1.0,
        description="Minimum clarity score (0–1). 0.8+ = very clean audio."),

    min_snr_db: Optional[float] = Query(
        None, description="Minimum signal-to-noise ratio in dB. 30+ = clear."),

    max_duration_mins: Optional[float] = Query(
        None, description="Maximum audiobook duration in minutes."),

    min_duration_mins: Optional[float] = Query(
        None, description="Minimum audiobook duration in minutes."),

    # ── Sorting ──────────────────────────────────────────────────
    sort_by: Literal[
        "relevance",
        "clarity",
        "speech_rate",
        "duration",
        "indexed_at",
    ] = Query("relevance", description=(
        "relevance = best text match first | "
        "clarity = clearest audio first | "
        "speech_rate = fastest first | "
        "duration = longest first | "
        "indexed_at = newest first"
    )),

    sort_order: Literal["asc", "desc"] = Query("desc"),

    # ── Pagination ───────────────────────────────────────────────
    page:      int = Query(1, ge=1,   description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
):
    """
    Search and filter the audiobook index.

    All parameters are optional — calling `/search` with no params returns
    everything. Combine freely, e.g.:

        /search?q=thriller&speaker=male&quality=clear&sort_by=clarity
        /search?genre=science_fiction&speech_rate=medium&page=2
        /search?min_clarity=0.85&sort_by=clarity&sort_order=desc
    """

    # Map friendly sort names to ES field paths
    sort_field_map = {
        "relevance":   "_score",
        "clarity":     "quality.clarity_score",
        "speech_rate": "speech_rate.syllables_per_second",
        "duration":    "total_time_secs",
        "indexed_at":  "indexed_at",
    }
    es_sort = sort_field_map[sort_by]

    # Build extra filter clauses for duration
    extra_filters = []
    if min_duration_mins is not None:
        extra_filters.append(
            {"range": {"total_time_secs": {"gte": min_duration_mins * 60}}})
    if max_duration_mins is not None:
        extra_filters.append(
            {"range": {"total_time_secs": {"lte": max_duration_mins * 60}}})

    result = search_books(
        _es(),
        query         = q,
        quality_label = quality,
        speaker_label = speaker,
        speech_rate   = speech_rate,
        genre         = genre,
        min_clarity   = min_clarity,
        min_snr_db    = min_snr_db,
        sort_by       = es_sort,
        sort_order    = sort_order,
        size          = page_size,
        from_         = (page - 1) * page_size,
        extra_filters = extra_filters,
    )

    return {
        "total":      result["total"],
        "page":       page,
        "page_size":  page_size,
        "total_pages": max(1, -(-result["total"] // page_size)),  # ceiling div
        "results":    result["books"],
    }


# ─────────────────────────────────────────────────────────────────
# SINGLE BOOK
# ─────────────────────────────────────────────────────────────────

@app.get("/books/{book_id}", tags=["Search"], summary="Get a single book by ID")
def get_book(book_id: str):
    """
    Fetch the full document for one book.

    IDs look like:  `yt-kc78arfcmRo`  or  `librivox-128`
    """
    try:
        r = _es().get(index="audiobooks", id=book_id)
        return r["_source"]
    except Exception:
        raise HTTPException(404, detail=f"Book '{book_id}' not found")


# ─────────────────────────────────────────────────────────────────
# FACETS  —  counts for every filter dimension
# ─────────────────────────────────────────────────────────────────

@app.get("/facets", tags=["Search"], summary="Filter option counts")
def get_facets():
    """
    Returns the count of books for every possible filter value.
    Use this to build filter dropdowns / chips in the frontend.

    Example response:
    ```json
    {
      "quality":     [{"value": "clear", "count": 18}, {"value": "noisy", "count": 2}],
      "speaker":     [{"value": "male",  "count": 9},  {"value": "female", "count": 8}],
      "speech_rate": [{"value": "medium","count": 12}, ...],
      "genre":       [{"value": "mystery_thriller", "count": 6}, ...]
    }
    ```
    """
    raw = aggregations(_es())

    def buckets(key: str) -> list[dict]:
        return [
            {"value": b["key"], "count": b["doc_count"]}
            for b in raw.get(key, {}).get("buckets", [])
        ]

    return {
        "quality":     buckets("quality_labels"),
        "speaker":     buckets("speaker_labels"),
        "speech_rate": buckets("speech_rate_labels"),
        "genre":       buckets("genres"),
        "stats": {
            "avg_clarity_score":     round(raw.get("avg_clarity",    {}).get("value") or 0, 3),
            "avg_f0_hz":             round(raw.get("avg_f0",         {}).get("value") or 0, 1),
            "avg_syllables_per_sec": round(raw.get("avg_syl_per_sec",{}).get("value") or 0, 2),
        },
    }


# ─────────────────────────────────────────────────────────────────
# INGEST  —  trigger YouTube search + index
# ─────────────────────────────────────────────────────────────────

def _run_ingest(query: str, limit: int) -> None:
    """Background ingest task — updates _ingest_state as it goes."""
    import datetime
    from youtube    import search_youtube, download_snippets_parallel, normalise
    from classifier import analyse_audio_file
    from concurrent.futures import ThreadPoolExecutor, as_completed

    with _ingest_lock:
        _ingest_state.update({"running": True, "indexed": 0,
                               "skipped": 0, "log": [], "query": query})

    def log(msg: str):
        _ingest_state["log"].append(msg)

    try:
        es = _es()
        ensure_index(es)

        log(f"Searching YouTube: {query!r} …")
        videos = search_youtube(query, max_results=limit)
        if not videos:
            log("No results found.")
            return

        metas      = [normalise(v) for v in videos]
        video_ids  = [m["_video_id"] for m in metas]
        id_to_meta = {m["_video_id"]: m for m in metas}

        log(f"Downloading {len(video_ids)} snippets …")
        paths = download_snippets_parallel(video_ids)

        log(f"Classifying {len(paths)} snippets …")
        docs = []

        def classify_one(vid: str, path) -> dict | None:
            meta = id_to_meta[vid]
            try:
                from classifier import analyse_audio_file
                analysis = analyse_audio_file(
                    str(path),
                    title           = meta["title"],
                    description     = meta["description"],
                    subjects        = meta.get("subjects", []),
                    sample_duration = 20.0,
                )
                doc = {k: v for k, v in meta.items() if not k.startswith("_")}
                doc.update({**analysis,
                            "indexed_at": datetime.datetime.utcnow().isoformat() + "Z"})
                return doc
            except Exception as e:
                log(f"✗ {meta['title'][:40]}: {e}")
                return None

        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(classify_one, vid, path): vid
                       for vid, path in paths.items()}
            for future in as_completed(futures):
                doc = future.result()
                if doc:
                    docs.append(doc)
                    log(f"✓ {doc['title'][:50]}")
                else:
                    _ingest_state["skipped"] += 1

        if docs:
            ok, errors = bulk_upsert(es, docs)
            _ingest_state["indexed"] = ok
            _ingest_state["skipped"] += len(errors)
            log(f"Done — {ok} indexed, {len(errors)} errors")
        else:
            log("Nothing to index.")

    except Exception as e:
        log(f"Pipeline error: {e}")
    finally:
        _ingest_state["running"] = False


@app.post("/ingest", tags=["Ingest"], summary="Search YouTube and index results")
def ingest(
    q: str = Query(
        ...,
        description="YouTube search query, e.g. 'sci fi audiobook' or 'Agatha Christie full audiobook'",
        example="mystery thriller audiobook",
    ),
    limit: int = Query(
        20, ge=1, le=50,
        description="Number of YouTube results to process (max 50)"),
    background_tasks: BackgroundTasks = None,
):
    """
    Search YouTube for `q`, download 20-second snippets from each result,
    classify them, and add to the index.

    This runs in the background. Poll `/ingest/status` to track progress.
    """
    if _ingest_state.get("running"):
        raise HTTPException(409, detail="An ingest job is already running. "
                                        "Check /ingest/status for progress.")

    background_tasks.add_task(_run_ingest, q, limit)
    return {"status": "started", "query": q, "limit": limit,
            "poll": "/ingest/status"}


@app.get("/ingest/status", tags=["Ingest"], summary="Check ingest job progress")
def ingest_status():
    """Poll this endpoint after calling POST /ingest to track progress."""
    return {
        "running":  _ingest_state.get("running", False),
        "query":    _ingest_state.get("query", ""),
        "indexed":  _ingest_state.get("indexed", 0),
        "skipped":  _ingest_state.get("skipped", 0),
        "log":      _ingest_state.get("log", [])[-20:],  # last 20 lines
    }