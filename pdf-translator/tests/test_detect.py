"""Checks for automatic language detection. No API key or internet needed.

    python tests/test_detect.py
"""
import json
import os
import sys
import tempfile
from types import SimpleNamespace

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.ttfonts import TTFont  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

from pdf_translator import LanguageError, detect_language, resolve_languages, translate_pdf  # noqa: E402
from pdf_translator.__main__ import main as cli_main  # noqa: E402

JA_PDF = os.path.join(ROOT, "samples", "sample_ja.pdf")
JP_FONT_FILES = [  # (path, index inside a .ttc collection)
    (os.path.join(ROOT, "fonts", "NotoSansJP-Regular.ttf"), 0),
    ("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", 0),
    ("C:/Windows/Fonts/msgothic.ttc", 0),
    ("C:/Windows/Fonts/meiryo.ttc", 0),
]


def jp_font():
    for path, index in JP_FONT_FILES:
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont("TestJP", path, subfontIndex=index))
            return "TestJP"
    return None


def make_pdf(path, lines, font="Helvetica", size=11):
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont(font, size)
    y = 780
    for line in lines:
        c.drawString(56, y, line)
        y -= 18
    if not lines:
        c.rect(56, 600, 200, 100)  # a page with a drawing but no text, like a scan without OCR
    c.showPage()
    c.save()
    return path


def expect_error(fn, words):
    try:
        fn()
    except LanguageError as e:
        assert words in str(e), f"expected {words!r} in: {e}"
        return str(e)
    raise AssertionError(f"expected LanguageError containing {words!r}")


class EchoClient:
    """Stands in for Claude: a minimal brief, and every text box marked as translated."""

    def __init__(self):
        self.messages = self
        self.calls = 0

    def create(self, **kw):
        import re
        self.calls += 1
        props = kw["output_config"]["format"]["schema"]["properties"]
        if "glossary" in props:
            out = {k: "" for k in ("document_type", "summary", "audience", "source_tone", "target_style")}
            out.update(conventions=[], glossary=[], keep_as_is=[])
        else:
            text = "\n".join(b["text"] for b in kw["messages"][0]["content"] if b["type"] == "text")
            items = json.loads(re.search(r"<segments>\n(.*)\n</segments>", text, re.S).group(1))
            out = {"translations": [{"id": it["id"], "text": "[JA] " + it["text"]} for it in items]}
        usage = SimpleNamespace(input_tokens=0, output_tokens=0, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(out, ensure_ascii=False))],
                               usage=usage, stop_reason="end_turn")


with tempfile.TemporaryDirectory() as tmp:
    en_pdf = make_pdf(os.path.join(tmp, "english.pdf"), [
        "Invitation to the product launch event",
        "We are pleased to invite you to the launch of our new document scanner.",
        "The event will be held on November 20 in Osaka. Admission is free.",
    ])
    blank_pdf = make_pdf(os.path.join(tmp, "blank.pdf"), [])

    # --- detection on its own
    d = detect_language(en_pdf)
    assert d["language"] == "English", d
    d = detect_language(JA_PDF)
    assert d["language"] == "Japanese", d
    print(f"Japanese sample: Japanese {d['japanese_share']:.0%}, Latin {d['latin_share']:.0%} -> Japanese")
    d = detect_language(blank_pdf)
    assert d["language"] is None and "no readable text" in d["reason"], d

    font = jp_font()
    if font:
        mixed_pdf = make_pdf(os.path.join(tmp, "mixed.pdf"), [  # Japanese with many English product names
            "SakuraScan Pro は、Cloud Storage と連携して PDF を自動でアップロードします。",
            "Wi-Fi Direct と Bluetooth LE に対応し、Windows・macOS・Android から操作できます。",
        ], font=font)
        d = detect_language(mixed_pdf)
        assert d["language"] == "Japanese", d
        print(f"Japanese with English terms: Japanese {d['japanese_share']:.0%}, Latin {d['latin_share']:.0%} -> Japanese")
        kanji_pdf = make_pdf(os.path.join(tmp, "kanji_only.pdf"), [  # Chinese-style text: kanji, no kana
            "本研究目的在測定健康成人血糖濃度與血清脂質變化同時評価飲料影響",
            "結果顯示血糖濃度明顯上昇而血清総膽固醇濃度亦上昇",
        ], font=font)
        d = detect_language(kanji_pdf)
        assert d["language"] is None and "Chinese" in d["reason"], d
    else:
        print("skipped the mixed and kanji-only checks: no Japanese font found")

    # --- the rules for --from / --to
    assert resolve_languages(en_pdf, "auto", "auto")[:2] == ("English", "Japanese")
    assert resolve_languages(JA_PDF, None, None)[:2] == ("Japanese", "English")
    assert resolve_languages(JA_PDF, "ja", "auto") == ("Japanese", "English", None)       # only --from, alias
    assert resolve_languages(en_pdf, "English", "Japanese") == ("English", "Japanese", None)  # both: no detection
    assert resolve_languages(blank_pdf, "English", "Japanese")[2] is None                   # both given: never reads
    assert resolve_languages(en_pdf, "auto", "Japanese")[:2] == ("English", "Japanese")   # only --to
    expect_error(lambda: resolve_languages(JA_PDF, "auto", "Japanese"), "already appears to be in Japanese")
    expect_error(lambda: resolve_languages(blank_pdf, "auto", "auto"), "no readable text")
    expect_error(lambda: resolve_languages(en_pdf, "French", "auto"), "only covers Japanese and English")
    expect_error(lambda: resolve_languages(en_pdf, "English", "english"), "both English")

    # --- the command line stops before any call to Claude when it can't tell
    out = os.path.join(tmp, "blank_out.pdf")
    assert cli_main([blank_pdf, "-o", out]) == 2
    assert not os.path.exists(out)

    # --- the whole pipeline with detection
    decided = []
    client = EchoClient()
    out = os.path.join(tmp, "english_ja.pdf")
    job = translate_pdf(en_pdf, out, client=client, on_languages=lambda *a: decided.append(a))
    assert decided and decided[0][:2] == ("English", "Japanese"), decided
    assert (job.options.source_lang, job.options.target_lang) == ("English", "Japanese")
    assert job.detection["language"] == "English"
    assert all((s.translation or "").startswith("[JA] ") for s in job.segments() if s.translate)
    saved = json.load(open(os.path.splitext(out)[0] + ".job.json", encoding="utf-8"))
    assert saved["detection"]["language"] == "English" and saved["options"]["target_lang"] == "Japanese"

print("language detection ok")
