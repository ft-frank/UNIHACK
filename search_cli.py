"""
search_cli.py
─────────────
Quick command-line search tool (no API server required).

Examples:
    python search_cli.py                           # show all books
    python search_cli.py --genre science_fiction
    python search_cli.py --quality clear --speaker male
    python search_cli.py --rate slow
    python search_cli.py -q "darwin evolution"
    python search_cli.py --sort quality.clarity_score
    python search_cli.py --facets
"""

import argparse
import json
import sys

from indexer import get_client, search_books, aggregations


def fmt_book(b: dict, i: int) -> str:
    lines = [
        f"  {i+1:>2}. [{b.get('id','')}] {b.get('title','')} — {b.get('author','')}",
    ]
    g = b.get("genre", {})
    q = b.get("quality", {})
    s = b.get("speaker", {})
    r = b.get("speech_rate", {})
    lines.append(
        f"      Genre: {g.get('genre','?'):25s}  Confidence: {g.get('genre_confidence',0):.0%}"
    )
    lines.append(
        f"      Quality: {q.get('label','?'):6s} (clarity={q.get('clarity_score','?'):.2f}, "
        f"SNR={q.get('snr_db','?'):.1f} dB)"
    )
    lines.append(
        f"      Speaker: {s.get('label','?'):8s}  F0={s.get('f0_median_hz','?')} Hz"
    )
    lines.append(
        f"      Rate:    {r.get('label','?'):8s}  {r.get('syllables_per_second','?')} syl/s"
    )
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Search the audiobook index")
    parser.add_argument("-q", "--query",   default=None, help="Full-text query")
    parser.add_argument("--quality",       choices=["clear","noisy"])
    parser.add_argument("--speaker",       choices=["male","female","child","unknown"])
    parser.add_argument("--rate",          choices=["slow","medium","fast"])
    parser.add_argument("--genre",         default=None)
    parser.add_argument("--min-clarity",   type=float, default=None)
    parser.add_argument("--min-snr",       type=float, default=None)
    parser.add_argument("--sort",          default="_score")
    parser.add_argument("--order",         choices=["asc","desc"], default="desc")
    parser.add_argument("--size",          type=int, default=20)
    parser.add_argument("--facets",        action="store_true",
                        help="Show aggregation counts instead of search results")
    parser.add_argument("--json",          action="store_true",
                        help="Output raw JSON")
    args = parser.parse_args()

    es = get_client()

    if args.facets:
        aggs = aggregations(es)
        if args.json:
            print(json.dumps(aggs, indent=2))
        else:
            print("\n📊  Facet counts\n")
            for dim, bucket in aggs.items():
                if "buckets" in bucket:
                    print(f"  {dim}:")
                    for b in bucket["buckets"]:
                        print(f"    {b['key']:30s} {b['doc_count']}")
                elif "value" in bucket:
                    print(f"  {dim}: {bucket['value']:.3f}")
            print()
        return

    results = search_books(
        es,
        query         = args.query,
        quality_label = args.quality,
        speaker_label = args.speaker,
        speech_rate   = args.rate,
        genre         = args.genre,
        min_clarity   = args.min_clarity,
        min_snr_db    = args.min_snr,
        sort_by       = args.sort,
        sort_order    = args.order,
        size          = args.size,
    )

    if args.json:
        print(json.dumps(results, indent=2, default=str))
        return

    total = results["total"]
    books = results["books"]
    print(f"\n🔍  {total} book(s) found\n")
    for i, b in enumerate(books):
        print(fmt_book(b, i))
    print()


if __name__ == "__main__":
    main()