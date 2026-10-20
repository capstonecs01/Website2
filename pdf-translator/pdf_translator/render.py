"""Rebuild the PDF: remove the original text, keep everything else, and draw
the translations into each segment's box.

The original page content (backgrounds, table rules, images, vector art) is
kept as is. Only the text-drawing operators are removed from the page and its
form XObjects, then a new text layer is overlaid.
"""
from __future__ import annotations

import io
import re

import pikepdf
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from .extract import SCRIPT_TAG, is_cjk_lang
from .fonts import FontKit
from .models import Job, Segment

TEXT_SHOW = {"Tj", "TJ"}
TOKEN = re.compile(r"[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]|[^\s　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]+\s*|\s+")
NO_LINE_START = set("、。，．・：；？！ー）」』】〕,.;:!?)]}")
SCRIPT_PIECE = re.compile(r"<(sup|sub)>(.*?)</\1>", re.S)
SCRIPT_SCALE = 0.62                      # superscripts/subscripts are drawn at this share of the text size
SCRIPT_SHIFT = {"sup": 0.36, "sub": -0.14}  # raised / lowered by this share of the text size
LANG_CODES = {"english": "en", "japanese": "ja", "chinese": "zh", "korean": "ko", "french": "fr",
              "german": "de", "spanish": "es", "italian": "it", "portuguese": "pt", "vietnamese": "vi",
              "thai": "th", "indonesian": "id"}


# ---------------------------------------------------------------- strip text

def _strip_stream(obj) -> bytes:
    out = []
    for ins in pikepdf.parse_content_stream(obj):
        op = str(getattr(ins, "operator", ""))
        if op in TEXT_SHOW or op == "Tf":
            continue
        if op == "'":
            out.append(pikepdf.ContentStreamInstruction([], pikepdf.Operator("T*")))
            continue
        if op == '"':
            aw, ac = ins.operands[0], ins.operands[1]
            out.append(pikepdf.ContentStreamInstruction([aw], pikepdf.Operator("Tw")))
            out.append(pikepdf.ContentStreamInstruction([ac], pikepdf.Operator("Tc")))
            out.append(pikepdf.ContentStreamInstruction([], pikepdf.Operator("T*")))
            continue
        out.append(ins)
    return pikepdf.unparse_content_stream(out)


def _strip_forms(resources, seen: set) -> None:
    if resources is None or "/XObject" not in resources:
        return
    for _, xobj in resources.XObject.items():
        if not isinstance(xobj, pikepdf.Stream) or xobj.get("/Subtype") != "/Form":
            continue
        key = xobj.objgen
        if key in seen:
            continue
        seen.add(key)
        xobj.write(_strip_stream(xobj))
        _strip_forms(xobj.get("/Resources"), seen)


def strip_text(pdf: pikepdf.Pdf, page_index: int, seen: set) -> None:
    page = pdf.pages[page_index]
    page.obj.Contents = pdf.make_stream(_strip_stream(page.obj))
    _strip_forms(page.resources, seen)


# ---------------------------------------------------------------- superscript markup

def clean_tags(text: str) -> str:
    """Keep well-formed <sup>..</sup>/<sub>..</sub>; drop any stray or unclosed tags."""
    out, pos = [], 0
    for m in SCRIPT_PIECE.finditer(text):
        out.append(SCRIPT_TAG.sub("", text[pos:m.start()]))
        out.append(m.group(0) if m.group(2) and not SCRIPT_TAG.search(m.group(2)) else SCRIPT_TAG.sub("", m.group(2)))
        pos = m.end()
    out.append(SCRIPT_TAG.sub("", text[pos:]))
    return "".join(out)


def pieces(text: str) -> list:
    """Split text into (string, kind) pieces, kind being None, "sup" or "sub"."""
    out, pos = [], 0
    for m in SCRIPT_PIECE.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], None))
        out.append((m.group(2), m.group(1)))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], None))
    return out


def text_width(fk: FontKit, text: str, font: str, size: float) -> float:
    return sum(fk.width(t, font, size * SCRIPT_SCALE if kind else size) for t, kind in pieces(text))


def _tokens(para: str):
    """Words for line wrapping; a superscript is one token glued to the word before it."""
    for t, kind in pieces(para):
        if kind:
            yield f"<{kind}>{t}</{kind}>"
        else:
            yield from TOKEN.findall(t)


# ---------------------------------------------------------------- layout

def wrap(text: str, fk: FontKit, font: str, size: float, width: float) -> list[str]:
    lines = []
    for para in text.split("\n"):
        line = ""
        for tok in _tokens(para):
            cand = line + tok
            script = tok.startswith("<su")
            if (not line.strip() or script or tok[0] in NO_LINE_START
                    or text_width(fk, cand.rstrip(), font, size) <= width):
                if not line.strip() and not script and fk.width(tok.rstrip(), font, size) > width:
                    for ch in tok:  # a word or URL longer than the box: break it
                        if line.strip() and fk.width((line + ch).rstrip(), font, size) > width:
                            lines.append(line.rstrip())
                            line = ch.lstrip()
                        else:
                            line += ch
                else:
                    line = cand
            else:
                lines.append(line.rstrip())
                line = tok.lstrip()
        lines.append(line.rstrip())
    return lines


def _dims(seg: Segment, rect) -> tuple[float, float]:
    x0, top, x1, bottom = rect
    return (bottom - top, x1 - x0) if seg.kind == "vertical" else (x1 - x0, bottom - top)


def _single_line_slot(seg: Segment) -> bool:
    w, h = _dims(seg, seg.box)
    return seg.lines == 1 and h < 2.4 * seg.size


def fit(seg: Segment, text: str, fk: FontKit, font: str, min_scale: float):
    """Find the largest font size (up to the original) at which the text fits.

    Tries the original area first, then the grown box, then shrinks.
    Returns (size, leading, lines, rect, overflow)."""
    s0 = seg.size
    cell = seg.kind == "table_cell"
    lead0 = 1.15 if cell else min(max(seg.leading if seg.kind == "paragraph" else 1.2, 1.15), 1.6)

    def attempt(size, lead, rect):
        w, h = _dims(seg, rect)
        lines = wrap(text, fk, font, size, w)
        block = size + (len(lines) - 1) * lead * size
        widest = max((text_width(fk, l, font, size) for l in lines), default=0)
        slack = 0.0 if cell and len(lines) > 1 else 0.25 * size  # cell borders are hard limits
        return block <= h + slack and widest <= w + 0.5, lines

    for rect in (seg.bbox, seg.box):
        ok, lines = attempt(s0, lead0, rect)
        if ok and (len(lines) == 1 or not _single_line_slot(seg)):
            return s0, lead0, lines, rect, False
    if _single_line_slot(seg):
        # A one-line slot (a table row, a label): shrinking a little to stay on
        # one line looks better than squeezing in a second line.
        size = s0
        while size > s0 * 0.82:
            size -= max(0.2, s0 * 0.03)
            ok, lines = attempt(size, lead0, seg.box)
            if ok and len(lines) == 1:
                return size, lead0, lines, seg.box, False
        ok, lines = attempt(s0, lead0, seg.box)
        if ok:
            return s0, lead0, lines, seg.box, False
    lead = min(lead0, 1.25)
    size = s0
    floor = max(4.0, s0 * min_scale)
    while size > floor:
        size = max(floor, size - max(0.2, s0 * 0.03))
        ok, lines = attempt(size, lead, seg.box)
        if ok:
            return size, lead, lines, seg.box, False
    ok, lines = attempt(floor, 1.15, seg.box)
    return floor, 1.15, lines, seg.box, not ok


# ---------------------------------------------------------------- draw

def _draw_line(c, fk: FontKit, primary: str, size: float, x: float, y: float, text: str) -> None:
    for piece, kind in pieces(text):
        s = size * SCRIPT_SCALE if kind else size
        yy = y + SCRIPT_SHIFT[kind] * size if kind else y
        for run, f in fk.runs(piece, primary):
            c.setFont(f, s)
            c.drawString(x, yy, run)
            x += pdfmetrics.stringWidth(run, f, s)


def draw_segment(c, seg: Segment, page_h: float, fk: FontKit, target_cjk: bool, min_scale: float) -> None:
    text = seg.translation if seg.translation is not None else seg.text
    text = clean_tags(text).strip("\n ")
    if not text:
        return
    font = fk.primary(seg.serif, seg.bold, target_cjk)
    size, lead, lines, rect, overflow = fit(seg, text, fk, font, min_scale)
    seg.render_size, seg.overflow = round(size, 2), overflow
    x0, top, x1, bottom = rect
    w, h = _dims(seg, rect)
    step = lead * size
    n = len(lines)

    c.saveState()
    c.setFillColorRGB(*seg.color)
    if seg.angle:
        # Sideways text: its box is in a frame rotated by `angle`, where y-up is -top.
        c.rotate(seg.angle)
        page_h = 0.0
    if seg.kind == "vertical":
        # English in a vertical column: rotate 90 degrees clockwise, centred across the column.
        c.translate(x1, page_h - top)
        c.rotate(-90)
        first = (x1 - x0) / 2 - (n - 1) * step / 2 + 0.35 * size
    elif seg.kind == "table_cell" or seg.baseline is None:
        mid = (seg.box[1] + seg.box[3]) / 2 if seg.kind == "table_cell" else top + min(h, (n - 1) * step + size) / 2
        c.translate(x0, page_h - top)
        first = (mid - top) - (n - 1) * step / 2 + 0.35 * size
    else:
        # Keep the first line where the original first line was.
        c.translate(x0, page_h - top)
        first = (seg.baseline - top) - 0.38 * (seg.size - size)
    for i, line in enumerate(lines):
        lw = text_width(fk, line, font, size)
        if seg.align == "center":
            x = (w - lw) / 2
        elif seg.align == "right":
            x = w - lw
        else:
            x = 0.0
        _draw_line(c, fk, font, size, x, -(first + i * step), line)
    c.restoreState()


def render(job: Job, out_path: str, fonts: FontKit | None = None) -> None:
    opts = job.options
    fk = fonts or FontKit(opts.font_dir)
    target_cjk = is_cjk_lang(opts.target_lang)
    pdf = pikepdf.open(job.source_path)

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    boxes = []
    for info in job.pages:
        boxes.append([float(v) for v in pdf.pages[info.index].mediabox])
        # Draw as the page is displayed; when the overlay is placed, pikepdf
        # compensates for the page's /Rotate.
        c.setPageSize((info.width, info.height))
        if info.status == "ok":
            for seg in info.segments:
                draw_segment(c, seg, info.height, fk, target_cjk, opts.min_font_scale)
        c.showPage()
    c.save()
    buf.seek(0)
    overlay = pikepdf.open(buf)

    seen: set = set()
    for info in job.pages:
        if info.status != "ok":
            continue
        strip_text(pdf, info.index, seen)
        page = pdf.pages[info.index]
        page.add_overlay(overlay.pages[info.index], rect=pikepdf.Rectangle(*boxes[info.index]))
    pdf.remove_unreferenced_resources()
    code = LANG_CODES.get(opts.target_lang.strip().lower())
    if code:
        pdf.Root.Lang = pikepdf.String(code)
    pdf.save(out_path)

    overflowing = [s.id for s in job.segments() if s.overflow]
    job.warnings = [w for w in job.warnings if not w.startswith("text may overflow")]
    if overflowing:
        job.warnings.append("text may overflow its box: " + ", ".join(overflowing))
