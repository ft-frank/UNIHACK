"""
youtube.py
──────────
Search YouTube for audiobooks and download 20-second snippets.
Uses threads for parallel stream URL resolution + async for parallel downloads.
"""

from __future__ import annotations
import asyncio
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

CACHE_DIR     = Path(".cache/mp3")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

PARTIAL_BYTES = 400_000   # ~20 sec @ 128 kbps
HEADERS       = {"User-Agent": "AudiobookIndexer/1.0"}
URL_WORKERS   = 6         # parallel stream URL resolution threads


def _cache_path(video_id: str) -> Path:
    return CACHE_DIR / f"yt_{video_id}.mp3"


# ──────────────────────────────────────────────
# SEARCH
# ──────────────────────────────────────────────

def search_youtube(query: str, max_results: int = 20) -> list[dict]:
    print(f"  🔍 Searching YouTube: {query!r}  (up to {max_results} results) …")
    cmd = [
        "yt-dlp",
        f"ytsearch{max_results}:{query}",
        "--dump-json",
        "--flat-playlist",
        "--no-warnings",
        "--quiet",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    videos = []
    for line in result.stdout.strip().splitlines():
        try:
            videos.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    print(f"  ✓ {len(videos)} results")
    return videos


# ──────────────────────────────────────────────
# STREAM URL RESOLUTION  (threaded, one per video)
# ──────────────────────────────────────────────

def _get_stream_url_one(video_id: str) -> tuple[str, str | None]:
    """Resolve direct audio URL for one video. Returns (video_id, url_or_None)."""
    cmd = [
        "yt-dlp",
        f"https://www.youtube.com/watch?v={video_id}",
        "--get-url",
        "--format", "bestaudio",
        "--no-warnings",
        "--quiet",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        lines = [l.strip() for l in r.stdout.strip().splitlines() if l.strip()]
        if r.returncode != 0 or not lines:
            # Print stderr only on failure to help diagnose
            if r.stderr.strip():
                print(f"    ⚠ [{video_id}] {r.stderr.strip()[:120]}")
            return video_id, None
        return video_id, lines[0]
    except subprocess.TimeoutExpired:
        return video_id, None
    except Exception as e:
        return video_id, None


def get_stream_urls(video_ids: list[str]) -> dict[str, str]:
    """Resolve stream URLs for all videos in parallel threads."""
    print(f"  ⚡ Resolving stream URLs ({URL_WORKERS} parallel) …")
    results = {}
    with ThreadPoolExecutor(max_workers=URL_WORKERS) as pool:
        futures = {pool.submit(_get_stream_url_one, vid): vid for vid in video_ids}
        done = 0
        for future in as_completed(futures):
            vid, url = future.result()
            done += 1
            if url:
                results[vid] = url
            print(f"    {done}/{len(video_ids)}  {'✓' if url else '✗'}  {vid}", end="\r")
    print(f"  ✓ Got {len(results)}/{len(video_ids)} stream URLs          ")
    return results


# ──────────────────────────────────────────────
# ASYNC PARALLEL DOWNLOADS
# ──────────────────────────────────────────────

async def _download_one(client: httpx.AsyncClient,
                         video_id: str, stream_url: str) -> Path | None:
    dest = _cache_path(video_id)
    if dest.exists() and dest.stat().st_size > 5_000:
        return dest
    try:
        h = {**HEADERS, "Range": f"bytes=0-{PARTIAL_BYTES - 1}"}
        async with client.stream("GET", stream_url, headers=h) as r:
            if r.status_code not in (200, 206):
                return None
            with open(dest, "wb") as f:
                written = 0
                async for chunk in r.aiter_bytes(65_536):
                    f.write(chunk)
                    written += len(chunk)
                    if written >= PARTIAL_BYTES:
                        break
        return dest if dest.stat().st_size > 5_000 else None
    except Exception:
        if dest.exists():
            dest.unlink()
        return None


async def _download_all(stream_url_map: dict[str, str]) -> dict[str, Path]:
    limits = httpx.Limits(max_connections=8, max_keepalive_connections=8)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True,
                                  limits=limits) as client:
        tasks = {vid: asyncio.create_task(_download_one(client, vid, url))
                 for vid, url in stream_url_map.items()}
        results = {}
        for vid, task in tasks.items():
            path = await task
            if path:
                results[vid] = path
    return results


def download_snippets_parallel(video_ids: list[str]) -> dict[str, Path]:
    """Resolve stream URLs + download all snippets. Returns {video_id: path}."""
    cached  = {vid: _cache_path(vid) for vid in video_ids
               if _cache_path(vid).exists() and _cache_path(vid).stat().st_size > 5_000}
    need_dl = [vid for vid in video_ids if vid not in cached]

    if cached:
        print(f"  ↩ {len(cached)} already cached")
    if not need_dl:
        return cached

    stream_urls = get_stream_urls(need_dl)
    if not stream_urls:
        return cached

    print(f"  ↓ Downloading {len(stream_urls)} snippets in parallel …")
    downloaded = asyncio.run(_download_all(stream_urls))
    kb = sum(p.stat().st_size // 1024 for p in downloaded.values())
    print(f"  ✓ {len(downloaded)} downloaded  ({kb} KB total)")

    return {**cached, **downloaded}


# ──────────────────────────────────────────────
# NORMALISE
# ──────────────────────────────────────────────

def normalise(video: dict) -> dict:
    vid_id   = video.get("id") or ""
    duration = int(video.get("duration") or 0)
    h, m, s  = duration // 3600, (duration % 3600) // 60, duration % 60
    return {
        "id":              f"yt-{vid_id}",
        "title":           (video.get("title") or "Unknown").strip(),
        "author":          (video.get("channel") or video.get("uploader") or "Unknown").strip(),
        "language":        "English",
        "subjects":        [],
        "description":     (video.get("description") or "").strip(),
        "total_time":      f"{h}:{m:02d}:{s:02d}",
        "total_time_secs": duration,
        "url_youtube":     f"https://www.youtube.com/watch?v={vid_id}",
        "url_librivox":    "",
        "url_archive_org": "",
        "cover_image_url": video.get("thumbnail") or "",
        "_video_id":       vid_id,
    }