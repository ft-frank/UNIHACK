"""
indexer.py
──────────
Creates the Elasticsearch index with the right mapping and provides
functions to upsert audiobook documents.

Index name: audiobooks
"""

from __future__ import annotations
import json
from elasticsearch import Elasticsearch, helpers
from elasticsearch.exceptions import NotFoundError

ES_HOST  = "http://localhost:9200"
INDEX    = "audiobooks"

# ──────────────────────────────────────────────
# MAPPING
# ──────────────────────────────────────────────

MAPPING = {
    "mappings": {
        "properties": {
            # ── Identification ──────────────────────────────
            "id":              {"type": "keyword"},
            "title":           {"type": "text",    "fields": {"raw": {"type": "keyword"}}},
            "author":          {"type": "text",    "fields": {"raw": {"type": "keyword"}}},
            "description":     {"type": "text"},
            "subjects":        {"type": "keyword"},
            "url_librivox":    {"type": "keyword", "index": False},
            "url_archive_org": {"type": "keyword", "index": False},
            "url_youtube":     {"type": "keyword", "index": False},
            "cover_image_url": {"type": "keyword", "index": False},
            "language":        {"type": "keyword"},
            "total_time":      {"type": "keyword"},   # human-readable HH:MM:SS
            "total_time_secs": {"type": "float"},

            # ── Audio Quality ───────────────────────────────
            "quality": {
                "properties": {
                    "snr_db":         {"type": "float"},
                    "spectral_score": {"type": "float"},
                    "clarity_score":  {"type": "float"},
                    "label":          {"type": "keyword"},  # clear | noisy
                }
            },

            # ── Speaker ─────────────────────────────────────
            "speaker": {
                "properties": {
                    "f0_median_hz": {"type": "float"},
                    "f0_std_hz":    {"type": "float"},
                    "label":        {"type": "keyword"},   # male | female | child | unknown
                }
            },

            # ── Speech Rate ──────────────────────────────────
            "speech_rate": {
                "properties": {
                    "syllables_per_second": {"type": "float"},
                    "label":                {"type": "keyword"},  # slow | medium | fast
                }
            },

            # ── Genre ────────────────────────────────────────
            "genre": {
                "properties": {
                    "genre":            {"type": "keyword"},
                    "genre_confidence": {"type": "float"},
                    "genre_scores":     {"type": "object", "enabled": False},  # raw dict, not queried
                }
            },

            # ── Chapter list ─────────────────────────────────
            "chapters": {
                "type": "nested",
                "properties": {
                    "chapter_number": {"type": "integer"},
                    "title":          {"type": "text"},
                    "play_time":      {"type": "keyword"},
                    "mp3_url":        {"type": "keyword", "index": False},
                }
            },

            "indexed_at": {"type": "date"},
        }
    },
    "settings": {
        "number_of_shards":   1,
        "number_of_replicas": 0,
        "analysis": {
            "analyzer": {
                "default": {
                    "type":      "standard",
                    "stopwords": "_english_",
                }
            }
        },
    },
}


# ──────────────────────────────────────────────
# CLIENT HELPERS
# ──────────────────────────────────────────────

def get_client(host: str = ES_HOST) -> Elasticsearch:
    return Elasticsearch(host)


def ensure_index(es: Elasticsearch) -> None:
    """Create index if it does not already exist."""
    if not es.indices.exists(index=INDEX):
        es.indices.create(index=INDEX, body=MAPPING)
        print(f"✓ Created index '{INDEX}'")
    else:
        print(f"✓ Index '{INDEX}' already exists")


def delete_index(es: Elasticsearch) -> None:
    try:
        es.indices.delete(index=INDEX)
        print(f"✓ Deleted index '{INDEX}'")
    except NotFoundError:
        pass


# ──────────────────────────────────────────────
# UPSERT / BULK HELPERS
# ──────────────────────────────────────────────

def upsert_document(es: Elasticsearch, doc: dict) -> None:
    """Insert or overwrite a single audiobook document."""
    es.index(index=INDEX, id=doc["id"], document=doc)


def bulk_upsert(es: Elasticsearch, docs: list[dict]) -> tuple[int, list]:
    """Bulk upsert a list of documents. Returns (success_count, errors)."""
    actions = [
        {
            "_op_type": "index",
            "_index":   INDEX,
            "_id":      doc["id"],
            "_source":  doc,
        }
        for doc in docs
    ]
    success, errors = helpers.bulk(es, actions, raise_on_error=False)
    return success, errors


# ──────────────────────────────────────────────
# SEARCH HELPERS
# ──────────────────────────────────────────────

def search_books(
    es: Elasticsearch,
    *,
    query:           str | None      = None,
    quality_label:   str | None      = None,   # clear | noisy
    speaker_label:   str | None      = None,   # male | female | child | unknown
    speech_rate:     str | None      = None,   # slow | medium | fast
    genre:           str | None      = None,
    min_clarity:     float | None    = None,   # 0-1
    min_snr_db:      float | None    = None,
    sort_by:         str             = "_score",
    sort_order:      str             = "desc",
    size:            int             = 20,
    extra_filters:   list            = None,
    from_:           int             = 0,
) -> dict:
    """
    Flexible search + filter.  All params are optional.
    sort_by can be any dot-notation field, e.g.:
        "quality.clarity_score", "speech_rate.syllables_per_second",
        "speaker.f0_median_hz", "_score"
    """
    must_clauses    = []
    filter_clauses  = []

    # Full-text
    if query:
        must_clauses.append({
            "multi_match": {
                "query":  query,
                "fields": ["title^3", "author^2", "description", "subjects"],
            }
        })

    # Exact label filters
    for field, value in [
        ("quality.label",     quality_label),
        ("speaker.label",     speaker_label),
        ("speech_rate.label", speech_rate),
        ("genre.genre",       genre),
    ]:
        if value:
            filter_clauses.append({"term": {field: value}})

    # Extra filters (duration etc)
    for f in (extra_filters or []):
        filter_clauses.append(f)

    # Numeric range filters
    if min_clarity is not None:
        filter_clauses.append({"range": {"quality.clarity_score": {"gte": min_clarity}}})
    if min_snr_db is not None:
        filter_clauses.append({"range": {"quality.snr_db": {"gte": min_snr_db}}})

    body: dict = {
        "query": {
            "bool": {
                "must":   must_clauses   or [{"match_all": {}}],
                "filter": filter_clauses,
            }
        },
        "sort": [{sort_by: {"order": sort_order}}],
        "size": size,
        "from": from_,
        "_source": {
            "excludes": ["genre.genre_scores", "chapters"]
        },
    }

    result  = es.search(index=INDEX, body=body)
    hits    = result["hits"]["hits"]
    total   = result["hits"]["total"]["value"]

    return {
        "total":  total,
        "books": [
            {**h["_source"], "_score": h["_score"]}
            for h in hits
        ],
    }


def aggregations(es: Elasticsearch) -> dict:
    """Return facet counts for all classification dimensions."""
    body = {
        "size": 0,
        "aggs": {
            "quality_labels":   {"terms": {"field": "quality.label"}},
            "speaker_labels":   {"terms": {"field": "speaker.label"}},
            "speech_rate_labels": {"terms": {"field": "speech_rate.label"}},
            "genres":           {"terms": {"field": "genre.genre", "size": 20}},
            "avg_clarity":      {"avg": {"field": "quality.clarity_score"}},
            "avg_f0":           {"avg": {"field": "speaker.f0_median_hz"}},
            "avg_syl_per_sec":  {"avg": {"field": "speech_rate.syllables_per_second"}},
        },
    }
    result = es.search(index=INDEX, body=body)
    return result["aggregations"]