"""Checks for superscripts and subscripts. No API key or internet needed.

    python tests/test_superscripts.py
"""
import json
import os
import re
import sys
import tempfile
from types import SimpleNamespace

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import pdfplumber  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.pdfbase.pdfmetrics import stringWidth  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

from pdf_translator import Job, Options, translate_pdf  # noqa: E402
from pdf_translator.extract import extract_document  # noqa: E402
from pdf_translator.fonts import FontKit  # noqa: E402
from pdf_translator.pipeline import check_markers  # noqa: E402
from pdf_translator.render import clean_tags, render, text_width, wrap  # noqa: E402


def runs(c, x, y, parts, font="Helvetica", size=10.0):
    """Draw [(text, kind)] where kind is None, "sup", "sub" or "small" (smaller, same baseline)."""
    for text, kind in parts:
        s = size * 0.65 if kind else size
        dy = {"sup": 0.35 * size, "sub": -0.15 * size}.get(kind, 0.0)
        c.setFont(font, s)
        c.drawString(x, y + dy, text)
        x += stringWidth(text, font, s)


def make_pdf(path):
    c = canvas.Canvas(path, pagesize=A4)
    runs(c, 56, 790, [("A. E. Ben-Chioma", None), ("1", "sup"), (", D. G. Tamuno-Emine", None), ("2", "sup")],
         font="Helvetica-Bold", size=11)
    runs(c, 56, 750, [("Each can was chilled to 2 to 4", None), ("0", "sup"), ("C before use.", None)])
    runs(c, 56, 720, [("BMI ranged from 19.5 to 24.8 kg m", None), ("-2", "sup"), (".", None)])
    runs(c, 56, 690, [("Blood was taken on the 5", None), ("th", "sup"), (" day.", None)])
    runs(c, 56, 660, [("Depletion of cytosolic Ca", None), ("2+", "sup"), (".", None)])
    runs(c, 56, 630, [("Water (H", None), ("2", "sub"), ("O) was given.", None)])
    runs(c, 56, 600, [("Approved by the ", None), ("COMMITTEE", "small"), (" in May.", None)])  # small caps: not a script
    runs(c, 56, 570, [("Reference", None), ("see appendix", "sup")])  # too long to be a superscript
    # a ruled table: one cell holding two values with significance letters
    c.setLineWidth(0.6)
    for x0, x1 in ((56, 200), (200, 340)):
        c.rect(x0, 460, x1 - x0, 40)
    c.setFont("Helvetica", 9)
    c.drawCentredString(128, 476, "Regular coke")
    runs(c, 236, 485, [("4.67 ± 0.62", None), ("a", "sup")], size=9)
    runs(c, 236, 470, [("5.19 ± 0.15", None), ("b", "sup")], size=9)
    c.showPage()
    c.save()


class Client:
    """Stands in for Claude. keep_tags=False imitates a translation that drops the markers."""

    def __init__(self, keep_tags=True):
        self.messages = self
        self.keep_tags = keep_tags

    def create(self, **kw):
        props = kw["output_config"]["format"]["schema"]["properties"]
        if "glossary" in props:
            out = {k: "" for k in ("document_type", "summary", "audience", "source_tone", "target_style")}
            out.update(conventions=[], glossary=[], keep_as_is=[])
        else:
            text = "\n".join(b["text"] for b in kw["messages"][0]["content"] if b["type"] == "text")
            items = json.loads(re.search(r"<segments>\n(.*)\n</segments>", text, re.S).group(1))
            tr = (lambda t: "[JA] " + t) if self.keep_tags else (lambda t: "[JA] " + re.sub(r"</?su[pb]>", "", t))
            out = {"translations": [{"id": it["id"], "text": tr(it["text"])} for it in items]}
        usage = SimpleNamespace(input_tokens=0, output_tokens=0, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(out, ensure_ascii=False))],
                               usage=usage, stop_reason="end_turn")


opts = Options(source_lang="English", target_lang="Japanese")
with tempfile.TemporaryDirectory() as tmp:
    src = os.path.join(tmp, "scripts.pdf")
    make_pdf(src)

    # --- reading: superscripts are attached to their text, with tags
    pages = extract_document(src, opts)
    segs = pages[0].segments
    texts = [s.text for s in segs]
    alltext = "\n".join(texts)

    def seg_with(words):
        return next(s for s in segs if words in s.text)

    assert seg_with("Ben-Chioma").text == "A. E. Ben-Chioma<sup>1</sup>, D. G. Tamuno-Emine<sup>2</sup>", texts
    assert "2 to 4<sup>0</sup>C before use." in alltext, texts
    assert "24.8 kg m<sup>-2</sup>." in alltext, texts
    assert "the 5<sup>th</sup> day." in alltext, texts
    assert "cytosolic Ca<sup>2+</sup>." in alltext, texts
    assert "Water (H<sub>2</sub>O) was given." in alltext, texts
    assert "<su" not in seg_with("COMMITTEE").text, "small text on the same baseline is not a superscript"
    assert "<su" not in seg_with("Reference").text, "long raised text is not a superscript"
    cell = seg_with("4.67")
    assert cell.kind == "table_cell" and cell.text == "4.67 ± 0.62<sup>a</sup>\n5.19 ± 0.15<sup>b</sup>", cell.text
    assert abs(cell.size - 9.0) < 0.2 and not cell.translate, (cell.size, cell.translate)
    assert not any(re.fullmatch(r"[0-9a-z+\-]{1,3}", t) for t in texts), "no stray superscript boxes"
    print("reading ok:", sum("<su" in t for t in texts), "boxes with superscripts/subscripts")

    # --- wrapping and tag cleanup
    fk = FontKit()
    font = fk.names["sans"]
    lines = wrap("Value 4.67<sup>a</sup>", fk, font, 10, text_width(fk, "Value 4.67", font, 10))
    assert lines == ["Value 4.67<sup>a</sup>"], lines  # a marker never starts a new line
    assert clean_tags("x<sup>a") == "xa"
    assert clean_tags("x<sup>a</sup>y</sub>") == "x<sup>a</sup>y"

    # --- drawing: small and raised, no visible tags
    job = Job(src, opts, pages=pages)
    for s in job.segments():
        s.translation = s.text
    out = os.path.join(tmp, "redrawn.pdf")
    render(job, out)
    with pdfplumber.open(out) as pdf:
        page = pdf.pages[0]
        assert "<su" not in (page.extract_text() or "")
        chars = page.chars
    i = next(i for i, c in enumerate(chars) if c["text"] == "a" and i > 0 and chars[i - 1]["text"] == "2"
             and chars[i - 2]["text"] == "6")
    a, two = chars[i], chars[i - 1]
    assert a["size"] < 0.75 * two["size"], (a["size"], two["size"])
    assert a["bottom"] < two["bottom"] - 1.5, "the letter is raised"
    print(f"drawing ok: superscript drawn at {a['size']:.1f}pt next to {two['size']:.1f}pt text, raised")

    # --- the marker check after translation
    for s in job.segments():
        s.translation = s.text
    job.warnings = []
    seg_with("Ben-Chioma").translation = "A. E. Ben-Chioma, D. G. Tamuno-Emine"   # markers lost
    seg_with("chilled").translation = "各缶は使用前に2〜4℃に冷却した。"              # unit rewritten: fine
    check_markers(job)
    marker_warnings = [w for w in job.warnings if "markers" in w]
    assert len(marker_warnings) == 1 and marker_warnings[0].endswith(": 1, 2"), job.warnings

    # --- whole pipeline: markers kept -> no warning; markers dropped -> warning
    job = translate_pdf(src, os.path.join(tmp, "kept.pdf"), options=opts, client=Client(keep_tags=True))
    assert not [w for w in job.warnings if "markers" in w], job.warnings
    job = translate_pdf(src, os.path.join(tmp, "dropped.pdf"), options=opts, client=Client(keep_tags=False))
    assert [w for w in job.warnings if "markers" in w], job.warnings
    print("marker check ok:", [w for w in job.warnings if "markers" in w][0])

print("superscripts ok")
