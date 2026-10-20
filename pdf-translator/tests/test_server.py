"""Exercise server.py (the website's translator server) with the stand-in Claude.

    python tests/test_server.py
"""
import io
import json
import os
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from reportlab.pdfgen import canvas  # noqa: E402

from server import RESTARTED, create_app, test_client  # noqa: E402

SECRET = "test-secret"
KEY = {"X-Translator-Key": SECRET}
SAMPLE = open(os.path.join(ROOT, "samples", "sample_ja.pdf"), "rb").read()


def make_pdf(text_lines):
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 780
    for line in text_lines:
        c.drawString(72, y, line)
        y -= 20
    c.showPage()
    c.save()
    return buf.getvalue()


def wait(web, job_id):
    for _ in range(240):
        st = web.get(f"/api/translations/{job_id}", headers=KEY).get_json()
        if st["status"] in ("done", "failed"):
            return st
        time.sleep(0.25)
    raise AssertionError("translation did not finish")


with tempfile.TemporaryDirectory() as tmp:
    app = create_app(workdir=tmp, client=test_client(), secret=SECRET, max_pages=5, test_mode=True)
    web = app.test_client()

    # health is open, everything else needs the shared secret
    h = web.get("/api/health").get_json()
    assert h["ok"] and h["test_mode"] and h["max_pages"] == 5, h
    r = web.post("/api/translations", data={"file": (io.BytesIO(SAMPLE), "a.pdf")})
    assert r.status_code == 401 and "X-Translator-Key" in r.get_json()["error"], r.data
    assert web.get("/api/translations/x", headers={"X-Translator-Key": "wrong"}).status_code == 401
    print("✓ secret required")

    # bad input is refused before any work starts
    r = web.post("/api/translations", headers=KEY, data={"file": (io.BytesIO(b"hello"), "x.pdf")})
    assert r.status_code == 400 and "not a PDF" in r.get_json()["error"]
    r = web.post("/api/translations", headers=KEY, data={"file": (io.BytesIO(make_pdf([])), "blank.pdf")})
    assert r.status_code == 400, r.data
    print("✓ non-PDF and no-text PDF refused:", r.get_json()["error"][:70], "…")
    assert len(os.listdir(tmp)) == 0, "refused uploads must not leave files behind"

    # the Japanese sample: detected, translated, downloadable
    r = web.post("/api/translations", headers=KEY, data={"file": (io.BytesIO(SAMPLE), "invite.pdf"), "review": "1"})
    assert r.status_code == 202, r.data
    created = r.get_json()
    assert created["pages"] == 2 and created["languages"]["source"] == "Japanese"
    assert created["languages"]["target"] == "English" and created["languages"]["detected"]
    st = wait(web, created["id"])
    assert st["status"] == "done", st
    assert st["review_requested"] and st["usage"]["estimated_cost_usd"] > 0
    pdf = web.get(f"/api/translations/{created['id']}/pdf", headers=KEY)
    assert pdf.status_code == 200 and pdf.data[:5] == b"%PDF-"
    assert "invite_translated.pdf" in pdf.headers["Content-Disposition"]
    segs = web.get(f"/api/translations/{created['id']}/segments", headers=KEY).get_json()
    assert any(s["translation"] == "Invitation to the SakuraScan Pro Launch Event" for s in segs)
    print("✓ sample translated Japanese -> English, est. cost", st["usage"]["estimated_cost_usd"])

    # any other PDF works in test mode (English -> Japanese, placeholder text)
    other = make_pdf(["Quarterly report", "Sales grew by 12 percent this quarter."])
    r = web.post("/api/translations", headers=KEY, data={"file": (io.BytesIO(other), "report.pdf")})
    assert r.status_code == 202, r.data
    assert r.get_json()["languages"]["target"] == "Japanese"
    st = wait(web, r.get_json()["id"])
    assert st["status"] == "done", st
    segs = web.get(f"/api/translations/{r.get_json()['id']}/segments", headers=KEY).get_json()
    assert all(s["translation"].startswith("[test translation]") for s in segs if s["kind"] != "skip"), segs
    print("✓ any PDF works in test mode")

    # the page limit
    small = create_app(workdir=tmp, client=test_client(), secret=SECRET, max_pages=1).test_client()
    r = small.post("/api/translations", headers=KEY, data={"file": (io.BytesIO(SAMPLE), "invite.pdf")})
    assert r.status_code == 400 and "2 pages" in r.get_json()["error"] and "limit is 1" in r.get_json()["error"]
    print("✓ page limit:", r.get_json()["error"])

    # a restart keeps finished jobs and fails interrupted ones
    stuck = os.path.join(tmp, "stuck")
    os.makedirs(stuck)
    with open(os.path.join(stuck, "status.json"), "w") as fh:
        json.dump({"id": "stuck", "status": "running", "stage": "translating", "done": 1, "total": 2}, fh)
    again = create_app(workdir=tmp, client=test_client(), secret=SECRET).test_client()
    assert again.get(f"/api/translations/{created['id']}", headers=KEY).get_json()["status"] == "done"
    assert again.get(f"/api/translations/{created['id']}/pdf", headers=KEY).status_code == 200
    st = again.get("/api/translations/stuck", headers=KEY).get_json()
    assert st["status"] == "failed" and st["error"] == RESTARTED, st
    assert again.get("/api/translations/nope", headers=KEY).status_code == 404
    print("✓ restart keeps finished jobs, fails interrupted ones")

print("server ok")
