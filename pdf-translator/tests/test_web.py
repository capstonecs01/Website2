"""Exercise the Flask example end to end with the stand-in client.

    python tests/test_web.py
"""
import io
import os
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "examples"))

from fake_claude import FakeClient  # noqa: E402
from flask_app import create_app  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    app = create_app(workdir=tmp, client=FakeClient())
    web = app.test_client()

    bad = web.post("/api/translations", data={"file": (io.BytesIO(b"hello"), "x.pdf")})
    assert bad.status_code == 400

    pdf = open(os.path.join(ROOT, "samples", "sample_ja.pdf"), "rb").read()
    r = web.post("/api/translations", data={"file": (io.BytesIO(pdf), "invite.pdf"), "review": "1"})
    assert r.status_code == 202, r.data
    job_id = r.get_json()["id"]

    for _ in range(120):
        st = web.get(f"/api/translations/{job_id}").get_json()
        if st["status"] in ("done", "failed"):
            break
        time.sleep(0.25)
    assert st["status"] == "done", st
    print("status:", st["status"], "| review notes:", len(st["review"]), "| est. cost:", st["usage"]["estimated_cost_usd"])

    out = web.get(f"/api/translations/{job_id}/pdf")
    assert out.status_code == 200 and out.data[:5] == b"%PDF-"
    assert "invite_translated.pdf" in out.headers["Content-Disposition"]

    segs = web.get(f"/api/translations/{job_id}/segments").get_json()
    title = next(s for s in segs if s["id"] == "p1-6")
    print("title:", title["source"], "->", title["translation"])

    r = web.put(f"/api/translations/{job_id}/segments", json={"p1-6": "You're Invited: SakuraScan Pro Launch"})
    assert r.status_code == 200, r.data
    segs = web.get(f"/api/translations/{job_id}/segments").get_json()
    assert next(s for s in segs if s["id"] == "p1-6")["translation"] == "You're Invited: SakuraScan Pro Launch"
    assert web.put(f"/api/translations/{job_id}/segments", json={"nope": "x"}).status_code == 400
    print("web api ok")
