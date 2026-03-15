"""
ingest.py
─────────
Parallel ingest pipeline:
  1. Search YouTube
  2. Batch-resolve stream URLs (one yt-dlp call)
  3. Download all snippets in parallel (async httpx)
  4. Classify all in parallel (thread pool)
  5. Bulk upsert into Elasticsearch

Usage:
    python ingest.py
    python ingest.py --query "mystery audiobook" --limit 30
    python ingest.py --dry-run
"""

from __future__ import annotations

import argparse
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from youtube    import search_youtube, download_snippets_parallel, normalise
from classifier import analyse_audio_file
from indexer    import get_client, ensure_index, bulk_upsert

CLASSIFIER_WORKERS = 4   # parallel classification threads


def classify_one(meta: dict, mp3_path) -> dict | None:
    try:
        analysis = analyse_audio_file(
            str(mp3_path),
            title           = meta["title"],
            description     = meta["description"],
            subjects        = meta.get("subjects", []),
            sample_duration = 20.0,
        )
    except Exception as e:
        print(f"  ✗ {meta['title'][:40]!r}: {e}")
        return None

    doc = {k: v for k, v in meta.items() if not k.startswith("_")}
    doc.update({
        "quality":     analysis["quality"],
        "speaker":     analysis["speaker"],
        "speech_rate": analysis["speech_rate"],
        "genre":       analysis["genre"],
        "indexed_at":  datetime.datetime.utcnow().isoformat() + "Z",
    })
    return doc


def run_pipeline(
    *,
    query:   str  = "full audiobook",
    limit:   int  = 20,
    dry_run: bool = False,
) -> None:
    es = None
    if not dry_run:
        es = get_client()
        ensure_index(es)

    # 1. Search
    videos = search_youtube(query, max_results=limit)
    if not videos:
        print("No results.")
        return

    metas     = [normalise(v) for v in videos]
    video_ids = [m["_video_id"] for m in metas]
    id_to_meta = {m["_video_id"]: m for m in metas}

    # 2 + 3. Batch URL resolve + parallel download
    paths = download_snippets_parallel(video_ids)
    if not paths:
        print("No audio downloaded.")
        return

    # 4. Parallel classification
    print(f"\n  🔬 Classifying {len(paths)} snippets "
          f"({CLASSIFIER_WORKERS} threads) …")

    docs = []
    with ThreadPoolExecutor(max_workers=CLASSIFIER_WORKERS) as pool:
        futures = {
            pool.submit(classify_one, id_to_meta[vid], path): vid
            for vid, path in paths.items()
        }
        for future in as_completed(futures):
            vid = futures[future]
            doc = future.result()
            if doc:
                title = doc.get("title", vid)[:45]
                q     = doc["quality"]["label"]
                s     = doc["speaker"]["label"]
                r     = doc["speech_rate"]["label"]
                g     = doc["genre"]["genre"]
                print(f"    ✓ {title!r:47s}  {q:5s} {s:7s} {r:6s} {g}")
                docs.append(doc)

    if not docs:
        print("Nothing to index.")
        return

    # 5. Bulk upsert
    if dry_run:
        import json
        print(json.dumps(docs[0], indent=2, default=str))
        print(f"  … and {len(docs)-1} more")
    else:
        ok, errors = bulk_upsert(es, docs)
        print(f"\n{'='*60}")
        print(f"Done.  ✓ {ok} indexed   ✗ {len(errors)} errors")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--query",   default="full audiobook")
    parser.add_argument("--limit",   type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run_pipeline(query=args.query, limit=args.limit, dry_run=args.dry_run)