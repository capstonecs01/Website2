"""Command line:

    python -m pdf_translator input.pdf -o output.pdf                 # Japanese <-> English, detected
    python -m pdf_translator input.pdf -o output.pdf --from English --to Japanese [--review]
    python -m pdf_translator --rerender output.job.json -o output.pdf
"""
import argparse
import csv
import json
import sys

from .extract import LanguageError
from .models import Options
from .pipeline import rerender, translate_pdf


def load_glossary(path: str) -> dict:
    """CSV with two columns: source term, target term (a header row is fine)."""
    out = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) >= 2 and row[0].strip() and row[0].strip().lower() != "source":
                out[row[0].strip()] = row[1].strip()
    return out


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows consoles may not be UTF-8
        try:
            stream.reconfigure(errors="replace")
        except AttributeError:
            pass
    ap = argparse.ArgumentParser(prog="pdf_translator", description="Recreate a PDF in another language with Claude.")
    ap.add_argument("input", nargs="?", help="PDF to translate")
    ap.add_argument("-o", "--output", required=True, help="where to write the translated PDF")
    ap.add_argument("--from", dest="source", default="auto",
                    help="the document's language (default: detect Japanese or English)")
    ap.add_argument("--to", dest="target", default="auto",
                    help="the language to translate into (default: the other of Japanese/English)")
    ap.add_argument("--review", action="store_true", help="have Claude check each translated page and fix what it can")
    ap.add_argument("--instructions", default="", help="extra guidance, e.g. 'American English, friendly tone'")
    ap.add_argument("--glossary", help="CSV of required terms: source,target")
    ap.add_argument("--analysis-model", default=Options.analysis_model)
    ap.add_argument("--translate-model", default=Options.translate_model)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--fonts", help="folder with .ttf fonts to use")
    ap.add_argument("--rerender", metavar="JOB_JSON", help="re-draw from an edited job file instead of translating")
    args = ap.parse_args(argv)

    if args.rerender:
        job = rerender(args.rerender, args.output, args.fonts)
    else:
        if not args.input:
            ap.error("input PDF is required unless --rerender is used")
        opts = Options(
            source_lang=args.source, target_lang=args.target, review=args.review,
            extra_instructions=args.instructions, glossary=load_glossary(args.glossary) if args.glossary else {},
            analysis_model=args.analysis_model, translate_model=args.translate_model,
            max_workers=args.workers, font_dir=args.fonts,
        )

        def progress(stage, done, total):
            print(f"\r{stage:12} {done}/{total}", end="", file=sys.stderr, flush=True)

        def languages(source, target, detection):
            if detection:
                print(f"Detected {source} (Japanese {detection['japanese_share']:.1%}, "
                      f"Latin {detection['latin_share']:.1%}) -> translating to {target}", file=sys.stderr)
            else:
                print(f"Translating {source} -> {target}", file=sys.stderr)

        try:
            job = translate_pdf(args.input, args.output, options=opts, on_progress=progress, on_languages=languages)
        except LanguageError as e:
            print(f"Stopped before translating: {e}", file=sys.stderr)
            return 2
        print(file=sys.stderr)

    segs = list(job.segments())
    print(f"wrote {args.output}: {len(job.pages)} pages, {len(segs)} text boxes")
    for w in job.warnings:
        print("warning:", w)
    for issue in job.review:
        print(f"review p{issue.get('page')} [{issue.get('severity')}] {issue.get('segment_id') or ''}: "
              f"{issue.get('problem')}{' (fixed)' if issue.get('applied') else ''}")
    if job.usage:
        print("usage:", json.dumps(job.usage))
    return 0


if __name__ == "__main__":
    sys.exit(main())
