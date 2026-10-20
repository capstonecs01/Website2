"""A minimal web API around the translator, ready to call from your website.

    pip install flask
    export ANTHROPIC_API_KEY=...
    python examples/flask_app.py            # http://localhost:5000

Endpoints
    POST /api/translations                  multipart form: file=<pdf>, source and target (optional,
                                            default "auto": Japanese <-> English is detected),
                                            review=1 (optional), instructions=... (optional)
                                            -> 202 {"id": ...}
    GET  /api/translations/<id>             status, progress, languages, warnings, review notes, cost estimate
    GET  /api/translations/<id>/pdf         the translated PDF
    GET  /api/translations/<id>/segments    every text box: source, translation, page, kind
    PUT  /api/translations/<id>/segments    {"<segment id>": "corrected text", ...}
                                            -> re-renders the PDF without calling the model

Translation runs in a background thread and takes roughly 10-30 seconds per
page. For production, move the work to a task queue (Celery, RQ, Cloud Tasks),
keep files in object storage, and add authentication and upload limits.
"""
import json
import os
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, abort, jsonify, request, send_file

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pdf_translator import Job, Options, rerender, translate_pdf  # noqa: E402

MAX_UPLOAD_MB = 50


def create_app(workdir: str = "translation_jobs", client=None, workers: int = 2) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
    os.makedirs(workdir, exist_ok=True)
    pool = ThreadPoolExecutor(max_workers=workers)
    lock = threading.Lock()
    state: dict = {}  # id -> status dict (use Redis or a database in production)

    def paths(job_id):
        d = os.path.join(workdir, job_id)
        return d, os.path.join(d, "source.pdf"), os.path.join(d, "translated.pdf"), os.path.join(d, "job.json")

    def run(job_id, opts):
        _, src, out, job_json = paths(job_id)

        def progress(stage, done, total):
            with lock:
                state[job_id].update(status="running", stage=stage, done=done, total=total)

        def languages(source, target, detection):
            with lock:
                state[job_id]["languages"] = {"source": source, "target": target, "detected": detection is not None,
                                              "detection": detection}

        try:
            job = translate_pdf(src, out, options=opts, client=client, on_progress=progress, job_path=job_json,
                                on_languages=languages)
            with lock:
                state[job_id].update(status="done", warnings=job.warnings, review=job.review, usage=job.usage)
        except Exception as e:  # report the failure to the website instead of losing it
            with lock:
                state[job_id].update(status="failed", error=f"{type(e).__name__}: {e}")

    @app.post("/api/translations")
    def create():
        f = request.files.get("file")
        if f is None:
            abort(400, "upload a PDF as 'file'")
        head = f.stream.read(5)
        f.stream.seek(0)
        if head != b"%PDF-":
            abort(400, "that file is not a PDF")
        job_id = uuid.uuid4().hex
        d, src, _, _ = paths(job_id)
        os.makedirs(d)
        f.save(src)
        opts = Options(
            source_lang=request.form.get("source", "auto"),
            target_lang=request.form.get("target", "auto"),
            review=request.form.get("review") in ("1", "true", "on"),
            extra_instructions=request.form.get("instructions", ""),
        )
        with lock:
            state[job_id] = {"id": job_id, "status": "queued", "stage": "queued", "done": 0, "total": 0,
                             "filename": f.filename}
        pool.submit(run, job_id, opts)
        return jsonify({"id": job_id}), 202

    def get_state(job_id):
        with lock:
            if job_id not in state:
                abort(404)
            return dict(state[job_id])

    @app.get("/api/translations/<job_id>")
    def status(job_id):
        return jsonify(get_state(job_id))

    @app.get("/api/translations/<job_id>/pdf")
    def download(job_id):
        if get_state(job_id)["status"] != "done":
            abort(409, "not finished yet")
        _, _, out, _ = paths(job_id)
        name = os.path.splitext(get_state(job_id).get("filename") or "document")[0] + "_translated.pdf"
        return send_file(os.path.abspath(out), mimetype="application/pdf", download_name=name)

    @app.get("/api/translations/<job_id>/segments")
    def segments(job_id):
        if get_state(job_id)["status"] != "done":
            abort(409, "not finished yet")
        job = Job.load(paths(job_id)[3])
        return jsonify([{"id": s.id, "page": s.page + 1, "kind": s.kind, "source": s.text,
                         "translation": s.translation, "overflow": s.overflow} for s in job.segments()])

    @app.put("/api/translations/<job_id>/segments")
    def edit(job_id):
        if get_state(job_id)["status"] != "done":
            abort(409, "not finished yet")
        changes = request.get_json(force=True) or {}
        _, _, out, job_json = paths(job_id)
        data = json.load(open(job_json, encoding="utf-8"))
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
        job = rerender(job_json, out)
        with lock:
            state[job_id]["warnings"] = job.warnings
        return jsonify({"ok": True, "warnings": job.warnings})

    return app


if __name__ == "__main__":
    create_app().run(port=5000, debug=False)
