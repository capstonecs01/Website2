"""End-to-end orchestration: extract → brief → translate pages → render → review."""
from __future__ import annotations

import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from typing import Callable, Optional

from .extract import extract_document, resolve_languages
from .fonts import FontKit
from .llm import analyze_document, page_png, review_page, translate_page
from .models import Job, Options, Usage
from .render import render

Progress = Callable[[str, int, int], None]
# Called once the languages are settled: (source, target, detection or None).
LanguagesDecided = Callable[[str, str, Optional[dict]], None]


MARKER_TAG = re.compile(r"<(sup|sub)>([^<]*)</\1>")
MARKER_WARNING = "superscript/subscript markers missing or changed"


def markers(text: str) -> list:
    """Superscripts/subscripts that must survive translation unchanged: single
    letters (significance letters, footnotes), footnote symbols, and numbers
    used as footnote or author marks. Exponents and units (m<sup>2</sup>,
    10<sup>6</sup>, 4<sup>0</sup>C, <sup>-2</sup>, <sup>th</sup>) are not markers."""
    found = []
    for m in MARKER_TAG.finditer(text or ""):
        content = m.group(2).strip()
        before, after = text[:m.start()], text[m.end():m.end() + 1]
        if re.fullmatch(r"[A-Za-z]|[*\u2020\u2021\u00a7\u00b6#]+", content):
            found.append(content)
        elif re.fullmatch(r"\d{1,3}(,\s*\d{1,3})*", content):
            unit = re.search(r"(?<![A-Za-z])[A-Za-z]{1,2}$", before)  # m, cm, kg ... (exponent)
            if before and not before[-1].isdigit() and not unit and after not in ("C", "F", "\u00b0"):
                found.append(content)
    return found


def check_markers(job: Job) -> None:
    """Warn about text boxes whose translation lost or changed a marker."""
    job.warnings = [w for w in job.warnings if MARKER_WARNING not in w]
    for s in job.segments():
        if not s.translate or s.translation is None:
            continue
        missing = Counter(markers(s.text)) - Counter(markers(s.translation))
        if missing:
            job.warnings.append(f"{s.id}: {MARKER_WARNING}: {', '.join(sorted(missing.elements()))}")


def default_job_path(output_path: str) -> str:
    return os.path.splitext(output_path)[0] + ".job.json"


def translate_pdf(input_path: str, output_path: str, *, options: Optional[Options] = None, client=None,
                  on_progress: Optional[Progress] = None, job_path: Optional[str] = None,
                  on_languages: Optional[LanguagesDecided] = None) -> Job:
    """Translate a PDF and write the recreated PDF to output_path.

    Languages left as "auto" are detected from the PDF first (Japanese <-> English);
    if that isn't possible a LanguageError is raised before any call to Claude.

    Also writes a job file (JSON) with every segment, the brief, warnings and
    token usage. Edit translations in it and call rerender() to fix things
    without another model call.
    """
    opts = options or Options()
    source, target, detection = resolve_languages(input_path, opts.source_lang, opts.target_lang)
    opts = replace(opts, source_lang=source, target_lang=target)
    if on_languages:
        on_languages(source, target, detection)
    if client is None:
        import anthropic  # imported here so the rest of the package works without it
        client = anthropic.Anthropic(max_retries=4)
    progress = on_progress or (lambda stage, done, total: None)
    usage = Usage()

    progress("reading", 0, 1)
    pages = extract_document(input_path, opts)
    job = Job(source_path=os.path.abspath(input_path), options=opts, pages=pages, detection=detection)
    for p in pages:
        if p.note:
            job.warnings.append(f"page {p.index + 1}: {p.note}")
    for s in job.segments():
        if not s.translate:
            s.translation = s.text

    progress("analyzing", 0, 1)
    job.brief = analyze_document(client, input_path, opts, usage)

    todo = [p for p in pages if p.status == "ok" and any(s.translate for s in p.segments)]
    images = {p.index: page_png(input_path, p.index) for p in todo}  # pdfium is not thread-safe
    progress("translating", 0, len(todo))

    def work(p):
        return p, translate_page(client, images[p.index], p.segments, p.index + 1, len(pages), job.brief, opts, usage)

    with ThreadPoolExecutor(max_workers=max(1, opts.max_workers)) as pool:
        futures = [pool.submit(work, p) for p in todo]
        for done, fut in enumerate(as_completed(futures), 1):
            try:
                p, result = fut.result()
            except Exception as e:  # keep going; the job file records what failed
                job.warnings.append(f"translation failed on a page: {e!r}")
                continue
            for s in p.segments:
                if s.translate:
                    if s.id in result:
                        s.translation = result[s.id]
                    else:
                        job.warnings.append(f"{s.id}: no translation returned; original text kept")
            progress("translating", done, len(todo))

    check_markers(job)
    fonts = FontKit(opts.font_dir)
    progress("rendering", 0, 1)
    render(job, output_path, fonts)

    if opts.review:
        reviewed = [p for p in todo]
        progress("reviewing", 0, len(reviewed))
        changed = False
        for n, p in enumerate(reviewed, 1):
            try:
                issues = review_page(client, images[p.index], page_png(output_path, p.index), p.segments,
                                     job.brief, opts, usage)
            except Exception as e:
                job.warnings.append(f"review failed on page {p.index + 1}: {e!r}")
                continue
            by_id = {s.id: s for s in p.segments}
            for issue in issues:
                issue["page"] = p.index + 1
                seg = by_id.get(issue.get("segment_id", ""))
                if opts.review_autofix and seg and issue.get("replacement"):
                    issue["applied"] = True
                    seg.translation = issue["replacement"]
                    changed = True
                job.review.append(issue)
            progress("reviewing", n, len(reviewed))
        if changed:
            check_markers(job)
            render(job, output_path, fonts)

    job.usage = usage.to_dict()
    job.save(job_path or default_job_path(output_path))
    progress("done", 1, 1)
    return job


def rerender(job_path: str, output_path: str, font_dir: Optional[str] = None) -> Job:
    """Re-draw a PDF from a (possibly hand-edited) job file. No model calls."""
    job = Job.load(job_path)
    if font_dir:
        job.options.font_dir = font_dir
    check_markers(job)
    render(job, output_path, FontKit(job.options.font_dir))
    job.save(job_path)
    return job
