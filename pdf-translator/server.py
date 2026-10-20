"""The translator as a small web server, for the Junction website to call.

    python server.py           real translations with Claude (needs ANTHROPIC_API_KEY)
    python server.py --test    free test mode: Claude is never called (see "Test mode" below)

Settings come from environment variables, or from a .env file next to this
script (copy .env.example to .env):

    ANTHROPIC_API_KEY    your Claude API key (not needed with --test)
    TRANSLATOR_SECRET    shared password. The website sends it in the
                         X-Translator-Key header; any other caller is refused.
    TRANSLATOR_PORT      default 5000
    MAX_PAGES            longest document accepted, default 20
    MAX_UPLOAD_MB        default 50
    TRANSLATOR_WORKERS   documents translated at the same time, default 2
    KEEP_DAYS            finished jobs older than this are removed at start-up, default 7

The server only listens on this computer (127.0.0.1), so it can't be reached
from other machines even without the secret.

Endpoints (all except /api/health need the X-Translator-Key header):
    GET  /api/health                      {"ok", "test_mode", "max_pages", "max_upload_mb"}
    POST /api/translations                multipart: file=<pdf>; optional source and target
                                          (default "auto": Japanese <-> English is detected),
                                          review=1, instructions=...
                                          -> 202 {"id", "pages", "languages"}
                                          -> 400 {"error"} for a non-PDF, too many pages, or
                                             languages that can't be detected
    GET  /api/translations/<id>           status (queued | running | done | failed), stage,
                                          done/total, languages, warnings, review, usage, error
    GET  /api/translations/<id>/pdf       the translated PDF
    GET  /api/translations/<id>/segments  every text box: source, translation, page, kind
    PUT  /api/translations/<id>/segments  {"<segment id>": "corrected text"} -> re-renders, no model call

Job status is saved to translation_jobs/<id>/status.json, so finished jobs
survive a restart. A job that was still running when the server stopped is
marked failed and can simply be requested again.

Test mode: a stand-in Claude (tests/fake_claude.py) answers instantly and for
free. samples/sample_ja.pdf gets a realistic English translation; any other
PDF gets "[test translation] <original text>" so you can try the website flow
with your own files without paying.
"""
from __future__ import annotations

import argparse
import hmac
import json
import os
import shutil
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, abort, jsonify, request, send_file
from werkzeug.exceptions import HTTPException

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from pdf_translator import Job, LanguageError, Options, rerender, resolve_languages, translate_pdf  # noqa: E402

ACTIVE = ("queued", "running")
RESTARTED = "The translator was restarted before this document finished. Please translate it again."


def load_env(path: str) -> None:
    """Read KEY=value lines from a .env file. Variables already set in the environment win."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and not os.environ.get(key):
                os.environ[key] = value


def count_pages(path: str) -> int:
    # pikepdf, not pypdfium2: pdfium isn't thread-safe and running jobs use it.
    import pikepdf
    with pikepdf.open(path) as pdf:
        return len(pdf.pages)


def friendly_error(e: Exception) -> str:
    """Turn a failure into a sentence the website can show."""
    name = type(e).__name__
    text = str(e)
    if isinstance(e, LanguageError):
        return text
    if name == "AuthenticationError" or "api_key" in text or "x-api-key" in text:
        return "The translator's Claude API key is missing or wrong (check ANTHROPIC_API_KEY in pdf-translator/.env)."
    if name in ("RateLimitError", "OverloadedError") or "overloaded" in text.lower():
        return "Claude is busy right now. Please try again in a few minutes."
    if name in ("APIConnectionError", "APITimeoutError"):
        return "The translator could not reach Claude. Check the internet connection and try again."
    return f"{name}: {text}"


def create_app(workdir: str | None = None, *, client=None, secret: str = "", max_pages: int = 20,
               max_upload_mb: int = 50, workers: int = 2, font_dir: str | None = None,
               test_mode: bool = False, keep_days: float = 7) -> Flask:
    workdir = os.path.abspath(workdir or os.path.join(ROOT, "translation_jobs"))
    font_dir = font_dir or os.path.join(ROOT, "fonts")
    os.makedirs(workdir, exist_ok=True)

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = max_upload_mb * 1024 * 1024
    pool = ThreadPoolExecutor(max_workers=workers)
    lock = threading.Lock()
    state: dict = {}

    def job_dir(job_id: str) -> str:
        return os.path.join(workdir, job_id)

    def save(job_id: str) -> None:
        """Write a job's status to disk. Call with the lock held."""
        tmp = os.path.join(job_dir(job_id), "status.json.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state[job_id], fh, ensure_ascii=False)
        os.replace(tmp, os.path.join(job_dir(job_id), "status.json"))

    # --- start-up: reload saved jobs, fail the interrupted ones, drop old ones ---
    cutoff = time.time() - keep_days * 86400
    for job_id in os.listdir(workdir):
        status_file = os.path.join(job_dir(job_id), "status.json")
        if not os.path.isfile(status_file):
            continue
        if os.path.getmtime(status_file) < cutoff:
            shutil.rmtree(job_dir(job_id), ignore_errors=True)
            continue
        try:
            with open(status_file, encoding="utf-8") as fh:
                st = json.load(fh)
        except (OSError, ValueError):
            continue
        state[job_id] = st
        if st.get("status") in ACTIVE:
            st.update(status="failed", stage="failed", error=RESTARTED)
            save(job_id)

    # --- every answer is JSON, including errors ---
    @app.errorhandler(HTTPException)
    def http_error(e):
        return jsonify({"error": e.description}), e.code

    @app.before_request
    def check_secret():
        if request.path == "/api/health":
            return None
        given = request.headers.get("X-Translator-Key", "")
        if not secret or not hmac.compare_digest(given.encode(), secret.encode()):
            abort(401, "missing or wrong X-Translator-Key")
        return None

    def run(job_id: str, opts: Options) -> None:
        d = job_dir(job_id)

        def progress(stage, done, total):
            with lock:
                state[job_id].update(status="running", stage=stage, done=done, total=total)
                save(job_id)

        try:
            job = translate_pdf(os.path.join(d, "source.pdf"), os.path.join(d, "translated.pdf"), options=opts,
                                client=client, on_progress=progress, job_path=os.path.join(d, "job.json"))
            with lock:
                state[job_id].update(status="done", stage="done", warnings=job.warnings, review=job.review,
                                     usage=job.usage, finished_at=time.time())
                save(job_id)
        except Exception as e:  # report the failure to the website instead of losing it
            with lock:
                state[job_id].update(status="failed", stage="failed", error=friendly_error(e),
                                     finished_at=time.time())
                save(job_id)

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "test_mode": test_mode, "max_pages": max_pages, "max_upload_mb": max_upload_mb})

    # Plain text translation (used by the website's chat). Separate from the PDF
    # pipeline: one short Claude call, no layout work. In test mode it returns a
    # clearly-labelled stub so the flow can be exercised without an API key.
    @app.post("/api/translate-text")
    def translate_text():
        data = request.get_json(force=True, silent=True) or {}
        text = (data.get("text") or "").strip()
        target = (data.get("target") or "English").strip()[:40]
        if not text:
            abort(400, "text is required")
        text = text[:4000]

        if test_mode:
            is_ja = target.lower().startswith("japan") or target == "日本語"
            prefix = "（テスト翻訳）" if is_ja else "(test translation) "
            return jsonify({"text": prefix + text})

        model = os.environ.get("CHAT_TRANSLATE_MODEL") or "claude-sonnet-5-5"
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=1500,
                system=(
                    f"You are a translator. Translate the user's message into {target}. "
                    "Reply with ONLY the translation — no quotes, no explanations, no notes. "
                    "Keep URLs, @mentions, emoji, numbers and line breaks as they are. "
                    "If the text is already in the target language, return it unchanged."
                ),
                messages=[{"role": "user", "content": text}],
            )
            out = "".join(getattr(b, "text", "") for b in resp.content).strip()
            return jsonify({"text": out or text})
        except Exception as e:
            return jsonify({"error": friendly_error(e)}), 502

    @app.post("/api/translations")
    def create():
        f = request.files.get("file")
        if f is None:
            abort(400, "upload a PDF as 'file'")
        head = f.stream.read(5)
        f.stream.seek(0)
        if head != b"%PDF-":
            abort(400, "That file is not a PDF.")

        source = (request.form.get("source") or "auto").strip()[:40]
        target = (request.form.get("target") or "auto").strip()[:40]
        instructions = (request.form.get("instructions") or "").strip()[:1000]

        job_id = uuid.uuid4().hex
        d = job_dir(job_id)
        os.makedirs(d)
        src = os.path.join(d, "source.pdf")
        f.save(src)
        try:
            try:
                pages = count_pages(src)
            except Exception:
                abort(400, "This PDF could not be opened. It may be damaged or password-protected.")
            if pages > max_pages:
                abort(400, f"This PDF has {pages} pages. The limit is {max_pages} pages.")
            try:
                source, target, detection = resolve_languages(src, source, target)
            except LanguageError as e:
                abort(400, str(e))
        except HTTPException:
            shutil.rmtree(d, ignore_errors=True)
            raise

        opts = Options(source_lang=source, target_lang=target, font_dir=font_dir,
                       review=request.form.get("review") in ("1", "true", "on"),
                       extra_instructions=instructions)
        languages = {"source": source, "target": target, "detected": detection is not None, "detection": detection}
        with lock:
            state[job_id] = {"id": job_id, "status": "queued", "stage": "queued", "done": 0, "total": 0,
                             "filename": f.filename, "pages": pages, "languages": languages,
                             "review_requested": opts.review, "created_at": time.time()}
            save(job_id)
        pool.submit(run, job_id, opts)
        return jsonify({"id": job_id, "pages": pages, "languages": languages}), 202

    def get_state(job_id: str) -> dict:
        with lock:
            if job_id not in state:
                abort(404, "unknown translation id")
            return dict(state[job_id])

    def require_done(job_id: str) -> dict:
        st = get_state(job_id)
        if st["status"] != "done":
            abort(409, "not finished yet")
        return st

    @app.get("/api/translations/<job_id>")
    def status(job_id):
        return jsonify(get_state(job_id))

    @app.get("/api/translations/<job_id>/pdf")
    def download(job_id):
        st = require_done(job_id)
        name = os.path.splitext(st.get("filename") or "document")[0] + "_translated.pdf"
        return send_file(os.path.join(job_dir(job_id), "translated.pdf"), mimetype="application/pdf",
                         download_name=name)

    @app.get("/api/translations/<job_id>/segments")
    def segments(job_id):
        require_done(job_id)
        job = Job.load(os.path.join(job_dir(job_id), "job.json"))
        return jsonify([{"id": s.id, "page": s.page + 1, "kind": s.kind, "source": s.text,
                         "translation": s.translation, "overflow": s.overflow} for s in job.segments()])

    @app.put("/api/translations/<job_id>/segments")
    def edit(job_id):
        require_done(job_id)
        changes = request.get_json(force=True, silent=True) or {}
        job_json = os.path.join(job_dir(job_id), "job.json")
        with open(job_json, encoding="utf-8") as fh:
            data = json.load(fh)
        known = set()
        for page in data["pages"]:
            for seg in page["segments"]:
                known.add(seg["id"])
                if seg["id"] in changes:
                    seg["translation"] = str(changes[seg["id"]])
        unknown = [k for k in changes if k not in known]
        if unknown:
            abort(400, f"unknown segment ids: {unknown}")
        with open(job_json, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        job = rerender(job_json, os.path.join(job_dir(job_id), "translated.pdf"))
        with lock:
            state[job_id]["warnings"] = job.warnings
            save(job_id)
        return jsonify({"ok": True, "warnings": job.warnings})

    return app


def test_client():
    """The stand-in Claude from tests/, answering any text instead of only the sample's."""
    sys.path.insert(0, os.path.join(ROOT, "tests"))
    import fake_claude

    class AnyText(dict):
        def __missing__(self, text):
            return f"[test translation] {text}"

    fake_claude.TRANSLATIONS = AnyText(fake_claude.TRANSLATIONS)
    return fake_claude.FakeClient()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the PDF translator as a web server for the website.")
    parser.add_argument("--test", action="store_true", help="free test mode: never calls Claude")
    args = parser.parse_args()

    load_env(os.path.join(ROOT, ".env"))
    secret = os.environ.get("TRANSLATOR_SECRET", "")
    if not secret:
        sys.exit("TRANSLATOR_SECRET is not set. Copy .env.example to .env and fill it in "
                 "(the website's backend/.env needs the same value).")

    client = None
    if args.test:
        client = test_client()
    else:
        try:
            import anthropic  # noqa: F401
        except ImportError:
            sys.exit("The anthropic package is missing. Run: pip install -r requirements.txt")
        if not os.environ.get("ANTHROPIC_API_KEY"):
            sys.exit("ANTHROPIC_API_KEY is not set. Put your Claude API key in pdf-translator/.env, "
                     "or start with --test for the free test mode.")

    port = int(os.environ.get("TRANSLATOR_PORT") or 5000)
    max_pages = int(os.environ.get("MAX_PAGES") or 20)
    app = create_app(client=client, secret=secret, max_pages=max_pages,
                     max_upload_mb=int(os.environ.get("MAX_UPLOAD_MB") or 50),
                     workers=int(os.environ.get("TRANSLATOR_WORKERS") or 2),
                     keep_days=float(os.environ.get("KEEP_DAYS") or 7),
                     test_mode=args.test)
    mode = "TEST MODE (Claude is not called, nothing is charged)" if args.test else "using Claude"
    print(f"[translator] {mode}")
    print(f"[translator] listening on http://127.0.0.1:{port}  (max {max_pages} pages per PDF)")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
