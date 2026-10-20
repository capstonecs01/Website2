"""Read a PDF's text layer and turn each page into positioned text segments.

Each segment is one box in the layout (a paragraph, a single line, a label, a
table cell or a vertical label) with its font size, style, colour and
alignment, plus a "box": the original area grown into nearby empty space, so
a longer translation has somewhere to go without overlapping anything.
"""
from __future__ import annotations

import math
import re
import statistics
from collections import Counter

import pdfplumber

from .models import Options, PageInfo, Segment

CJK_LANGS = ("japanese", "chinese", "korean", "ja", "zh", "ko")
CJK_CHAR = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ가-힯]")
WIDE_CHAR = re.compile(r"[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]")
BULLET = re.compile(r"^\s*([・●○■□◆◇▪▶►•※\-–—]|\(?\d{1,2}[.)）]\s|[①-⑳]|[（(][0-9一二三四五六七八九十]+[)）])")
SENTENCE_END = tuple("。．.！？!?：:")


def is_cjk_lang(lang: str) -> bool:
    return lang.strip().lower() in CJK_LANGS


def needs_translation(text: str, source_lang: str) -> bool:
    text = plain_text(text)  # "<sup>k</sup>" is markup, not a word
    if is_cjk_lang(source_lang):
        return bool(CJK_CHAR.search(text))
    words = re.findall(r"[^\W\d_]{2,}", text)
    looks_technical = re.fullmatch(r"\S+@\S+|https?://\S+|www\.\S+", text.strip())
    return bool(words) and not looks_technical


# ---------------------------------------------------------------- superscripts and subscripts
#
# Small raised (or lowered) characters touching normal text, such as the
# significance letters in "4.67 ± 0.62ᵃ", "kg m⁻²", "Ca²⁺", author numbers
# and footnote marks, are attached to that text and stored as
# "<sup>a</sup>" / "<sub>2</sub>" instead of becoming separate lines.

SCRIPT_TAG = re.compile(r"</?su[pb]>")
SCRIPT_MAX_SIZE = 0.85   # at most this share of the neighbouring text's font size
SCRIPT_MIN_RISE = 0.20   # superscript: baseline raised by at least this share of the neighbour's size
SCRIPT_MIN_DROP = 0.10   # subscript: baseline lowered by at least this share
SCRIPT_MAX_GAP = 0.50    # touching: gap to the neighbour under half a character
SCRIPT_MAX_RUN = 6       # longer small raised text is a label, not a superscript


def plain_text(text: str) -> str:
    """Text with the <sup>/<sub> markup removed (the characters are kept)."""
    return SCRIPT_TAG.sub("", text or "")


def _baseline(c) -> float:
    """Baseline position, measured from the top like c["top"]."""
    m = c.get("matrix")
    if m is not None and "y1" in c:
        return c["top"] + (c["y1"] - m[5])
    return c["bottom"] - 0.2 * c["size"]


def _mark_scripts(chars) -> list:
    """Return chars with superscript/subscript characters marked and tied to the
    row of the text they belong to (so they are not read as a separate line)."""
    ink = [c for c in chars if (c.get("text") or "").strip()]
    if len(ink) < 2:
        return chars
    bands: dict = {}
    for c in ink:
        bands.setdefault(int((c["top"] + c["bottom"]) / 2 // 8), []).append(c)

    def near(c):
        k = int((c["top"] + c["bottom"]) / 2 // 8)
        span = 2 + int(c["size"] // 8)
        for kk in range(k - span, k + span + 1):
            yield from bands.get(kk, ())

    def touching(a, b, size):
        return (-0.15 * size <= a["x0"] - b["x1"] <= SCRIPT_MAX_GAP * size
                or -0.15 * size <= b["x0"] - a["x1"] <= SCRIPT_MAX_GAP * size)

    marks: dict = {}  # id(char) -> (kind, base char)
    for c in ink:
        best = None
        for b in near(c):
            if b is c or c["size"] > SCRIPT_MAX_SIZE * b["size"] or not touching(c, b, b["size"]):
                continue
            rise = _baseline(b) - _baseline(c)
            if SCRIPT_MIN_RISE * b["size"] <= rise <= 0.8 * b["size"]:
                kind = "sup"
            elif -0.6 * b["size"] <= rise <= -SCRIPT_MIN_DROP * b["size"]:
                kind = "sub"
            else:
                continue
            gap = min(abs(c["x0"] - b["x1"]), abs(b["x0"] - c["x1"]))
            if best is None or gap < best[0]:
                best = (gap, kind, b)
        if best:
            marks[id(c)] = (best[1], best[2])
    if not marks:
        return chars

    # The rest of a run ("-2", "2+", "th") touches the first marked character, not the base.
    grown = True
    while grown:
        grown = False
        for c in ink:
            if id(c) in marks:
                continue
            for m in near(c):
                if id(m) in marks and abs(c["size"] - m["size"]) <= 0.15 * m["size"] \
                        and abs(_baseline(c) - _baseline(m)) <= 0.15 * m["size"] and touching(c, m, m["size"]):
                    marks[id(c)] = marks[id(m)]
                    grown = True
                    break

    runs: dict = {}
    for c in ink:
        if id(c) in marks:
            kind, base = marks[id(c)]
            runs.setdefault((kind, id(base)), []).append(c)
    for run in runs.values():
        if len(run) > SCRIPT_MAX_RUN:
            for c in run:
                marks.pop(id(c), None)

    out = []
    for c in chars:
        if id(c) in marks:
            kind, b = marks[id(c)]
            c = {**c, "script": kind, "row_mid": (b["top"] + b["bottom"]) / 2,
                 "row_h": max(b["bottom"] - b["top"], 1.0)}
        out.append(c)
    return out


# ---------------------------------------------------------------- language detection

AUTO = "auto"
LANGUAGE_NAMES = {  # accepted spellings -> the name the rest of the program uses
    "japanese": "Japanese", "ja": "Japanese", "jp": "Japanese", "jpn": "Japanese", "日本語": "Japanese",
    "english": "English", "en": "English", "eng": "English", "英語": "English",
}
AUTO_PAIR = {"Japanese": "English", "English": "Japanese"}

DETECT_MAX_PAGES = 20
DETECT_MIN_LETTERS = 20   # fewer readable letters than this: treat as no text (scanned)
DETECT_MIN_KANA = 10      # hiragana/katakana is what separates Japanese from Chinese
DETECT_JA_SHARE = 0.25    # one Japanese character carries about as much as several Latin letters
DETECT_OTHER_SHARE = 0.25

KANA = re.compile(r"[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]")
KANJI = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
LATIN = re.compile(r"[A-Za-zÀ-ÖØ-öø-ɏＡ-Ｚａ-ｚ]")
HANGUL = re.compile(r"[ᄀ-ᇿ㄰-㆏가-힯]")


class LanguageError(ValueError):
    """The languages could not be worked out; raised before any call to Claude."""


def normalize_language(name) -> str:
    """'ja', 'JP', 'japanese' -> 'Japanese'; '', None, 'auto' -> 'auto'. Other names are kept as given."""
    if name is None or not str(name).strip() or str(name).strip().lower() == AUTO:
        return AUTO
    name = str(name).strip()
    return LANGUAGE_NAMES.get(name.lower(), name)


def detect_language(path: str, max_pages: int = DETECT_MAX_PAGES) -> dict:
    """Guess whether a PDF is in Japanese or English by counting the letters in
    its text layer (up to max_pages pages). No model call; takes well under a second.

    Returns a dict with "language" ("Japanese", "English" or None), the share
    of Japanese and Latin letters, the raw counts, and a human-readable "reason".
    """
    counts = {"kana": 0, "kanji": 0, "latin": 0, "hangul": 0, "other": 0}
    with pdfplumber.open(path) as pdf:
        pages = pdf.pages[:max_pages]
        for page in pages:
            for c in page.chars:
                for ch in c.get("text") or "":
                    if KANA.match(ch):
                        counts["kana"] += 1
                    elif KANJI.match(ch):
                        counts["kanji"] += 1
                    elif LATIN.match(ch):
                        counts["latin"] += 1
                    elif HANGUL.match(ch):
                        counts["hangul"] += 1
                    elif ch.isalpha():
                        counts["other"] += 1
        pages_checked = len(pages)

    total = sum(counts.values())
    ja_share = (counts["kana"] + counts["kanji"]) / total if total else 0.0
    latin_share = counts["latin"] / total if total else 0.0
    result = {"language": None, "japanese_share": round(ja_share, 4), "latin_share": round(latin_share, 4),
              "counts": counts, "pages_checked": pages_checked, "reason": ""}

    if total < DETECT_MIN_LETTERS:
        result["reason"] = "the PDF has no readable text (it may be a scanned document)"
    elif counts["kana"] >= DETECT_MIN_KANA and ja_share >= DETECT_JA_SHARE:
        result["language"], result["reason"] = "Japanese", "mostly Japanese characters, including kana"
    elif counts["kanji"] / total >= DETECT_OTHER_SHARE:
        result["reason"] = "it has Chinese characters but almost no Japanese kana (it may be Chinese)"
    elif counts["hangul"] / total >= DETECT_OTHER_SHARE:
        result["reason"] = "it looks like Korean"
    elif latin_share >= 0.5:
        result["language"], result["reason"] = "English", "mostly Latin letters"
    else:
        result["reason"] = "it is not clearly Japanese or English"
    return result


def resolve_languages(path: str, source, target):
    """Work out the source and target languages before anything is sent to Claude.

    - both given: used as they are, no detection
    - only the source given: Japanese <-> English picks the other one
    - source missing: detected from the PDF; the target is the other one of
      the pair unless given (and must differ from the source)

    Returns (source, target, detection), where detection is None when no
    detection was needed. Raises LanguageError with a readable message.
    """
    source, target = normalize_language(source), normalize_language(target)
    detection = None
    if source == AUTO:
        detection = detect_language(path)
        if detection["language"] is None:
            raise LanguageError(f"Couldn't tell the document's language: {detection['reason']}. "
                                "Please give both --from and --to (for example --from English --to Japanese).")
        source = detection["language"]
    if target == AUTO:
        if source not in AUTO_PAIR:
            raise LanguageError(f"Automatic choice only covers Japanese and English. "
                                f"Please give --to for a {source} document.")
        target = AUTO_PAIR[source]
    if source.lower() == target.lower():
        if detection is not None:
            raise LanguageError(f"The document already appears to be in {source}. "
                                "If that's wrong, give --from as well.")
        raise LanguageError(f"--from and --to are both {source}.")
    return source, target, detection


# ---------------------------------------------------------------- font style

def _clean_font(name: str) -> str:
    return name.split("+", 1)[-1].lower()


def is_bold(fontname: str) -> bool:
    f = _clean_font(fontname)
    return any(k in f for k in ("bold", "black", "heavy", "demi", "w6", "w7", "w8", "w9", "-b", ",b"))


def is_serif(fontname: str) -> bool:
    f = _clean_font(fontname)
    if any(k in f for k in ("sans", "gothic", "goth", "kaku", "maru", "arial", "helvet", "meiryo", "yugo")):
        return False
    return any(k in f for k in ("mincho", "min-", "minpr", "hiramin", "kozmin", "ryumin", "ming", "song",
                                "serif", "times", "georgia", "garamond", "century", "cambria", "minion",
                                "palatino", "antiqua"))


def to_rgb(color) -> tuple:
    if color is None:
        return (0.0, 0.0, 0.0)
    if isinstance(color, (int, float)):
        color = (color,)
    try:
        vals = [float(v) for v in color if isinstance(v, (int, float))]
    except TypeError:
        return (0.0, 0.0, 0.0)
    if len(vals) == 1:
        return (vals[0],) * 3
    if len(vals) == 3:
        return tuple(vals)
    if len(vals) == 4:
        c, m, y, k = vals
        return ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    return (0.0, 0.0, 0.0)


# ---------------------------------------------------------------- lines

class Line:
    """A horizontal run of characters: one line of a paragraph, or a label."""

    def __init__(self, chars):
        self.chars = sorted(chars, key=lambda c: c["x0"])
        ink = [c for c in self.chars if c["text"].strip()]
        base = [c for c in ink if not c.get("script")] or ink  # superscripts don't set size or position
        self.x0 = min(c["x0"] for c in ink)
        self.x1 = max(c["x1"] for c in ink)
        self.top = min(c["top"] for c in base)
        self.bottom = max(c["bottom"] for c in base)
        self.size = statistics.median(c["size"] for c in base)
        fonts = Counter(c["fontname"] for c in base).most_common(1)[0][0]
        self.font = fonts
        self.bold = is_bold(fonts)
        self.serif = is_serif(fonts)
        self.color = to_rgb(Counter(tuple(to_rgb(c.get("non_stroking_color"))) for c in base).most_common(1)[0][0])
        first = base[0]
        self.baseline = first["top"] + (first["y1"] - first["matrix"][5]) if "matrix" in first else self.bottom - 0.12 * self.size
        self.text = self._assemble()
        self.plain = plain_text(self.text)

    def _assemble(self) -> str:
        out = ""
        prev = None
        open_kind = None
        for c in self.chars:
            t = c["text"]
            kind = c.get("script") if t.strip() else None
            if prev is not None and t.strip() and prev["text"].strip():
                gap = c["x0"] - prev["x1"]
                if gap > 0.22 * self.size and not (WIDE_CHAR.match(t) and WIDE_CHAR.match(prev["text"])):
                    if open_kind:
                        out += f"</{open_kind}>"
                        open_kind = None
                    out += " "
            if kind != open_kind:
                if open_kind:
                    out += f"</{open_kind}>"
                if kind:
                    out += f"<{kind}>"
                open_kind = kind
            out += t
            prev = c
        if open_kind:
            out += f"</{open_kind}>"
        out = re.sub(r"[ \t]+", " ", out)
        return out.strip()


def _rows(chars):
    rows = []
    def mid_of(c):  # a superscript sits in the row of the text it belongs to
        return c.get("row_mid", (c["top"] + c["bottom"]) / 2)

    for c in sorted(chars, key=mid_of):
        mid = mid_of(c)
        h = c.get("row_h", max(c["bottom"] - c["top"], 1.0))
        for row in reversed(rows[-4:]):
            if abs(mid - row["mid"]) <= max(1.0, 0.35 * min(h, row["h"])):
                row["chars"].append(c)
                break
        else:
            rows.append({"mid": mid, "h": h, "chars": [c]})
    return [r["chars"] for r in rows]


def _split_row(chars):
    """Split one row of characters into separate lines at large gaps."""
    chars = sorted(chars, key=lambda c: c["x0"])
    frags, cur, space_w = [], [chars[0]], 0.0
    for a, b in zip(chars, chars[1:]):
        size = max(min(a["size"], b["size"]), 1.0)
        gap = b["x0"] - a["x1"]
        if b["text"] == " ":
            space_w += b["x1"] - b["x0"]
        elif b["text"].strip():
            space_w = 0.0
        if gap > max(1.0 * size, 4.0) or gap < -2 * size or space_w > 1.6 * size:
            frags.append(cur)
            cur, space_w = [], 0.0
        cur.append(b)
    frags.append(cur)
    frags = [f for f in frags if any(c["text"].strip() for c in f)]
    # Letter-spaced titles ("ご　案　内") look like many tiny fragments with even
    # gaps: keep them as one line.
    if len(frags) >= 3 and all(sum(1 for c in f if c["text"].strip()) <= 2 for f in frags):
        gaps = [b[0]["x0"] - a[-1]["x1"] for a, b in zip(frags, frags[1:])]
        if min(gaps) > 0 and max(gaps) / min(gaps) < 1.5:
            frags = [[c for f in frags for c in f]]
    return frags


def _vertical_columns(lines):
    """Find tategaki: stacks of single-character lines sharing an x centre."""
    singles = [l for l in lines if len(l.plain) == 1 and WIDE_CHAR.match(l.plain)]
    singles.sort(key=lambda l: ((l.x0 + l.x1) / 2, l.top))
    columns, used = [], set()
    for i, l in enumerate(singles):
        if id(l) in used:
            continue
        col = [l]
        for m in singles[i + 1:]:
            last = col[-1]
            if id(m) in used:
                continue
            if abs((m.x0 + m.x1) / 2 - (last.x0 + last.x1) / 2) < 0.3 * last.size and 0 <= m.top - last.bottom < 0.8 * last.size:
                col.append(m)
        if len(col) >= 3:
            columns.append(col)
            used.update(id(x) for x in col)
    return columns, used


def _blocks(lines):
    """Group lines into paragraphs."""
    blocks = []
    for line in sorted(lines, key=lambda l: (l.top, l.x0)):
        best = None
        for b in blocks:
            last = b[-1]
            if abs(line.size - last.size) > 0.15 * last.size or line.bold != last.bold:
                continue
            if any(abs(x - y) > 0.25 for x, y in zip(line.color, last.color)):
                continue
            vgap = line.top - last.bottom
            if not (-0.2 * last.size <= vgap <= 0.9 * last.size):
                continue
            left = min(l.x0 for l in b)
            right = max(l.x1 for l in b)
            aligned_left = left - 1.5 * line.size <= line.x0 <= left + 2.5 * line.size
            aligned_center = abs((line.x0 + line.x1) / 2 - (left + right) / 2) < line.size
            if not (aligned_left or aligned_center) or line.x0 > last.x1 or line.x1 < last.x0:
                continue
            if BULLET.match(line.plain):
                continue
            if last.plain.endswith(SENTENCE_END) and last.x1 < right - 2 * last.size:
                continue  # previous line closed its paragraph
            best = b
        if best is None:
            blocks.append([line])
        else:
            best.append(line)
    return blocks


def _join(lines, align: str) -> tuple[str, bool]:
    """Join a block's lines. Lines that stop short are real line breaks ("\\n");
    lines that run to the edge are wrapped text and are joined. Returns the
    text and whether every break was a real one (an address, a sign-off)."""
    right = max(l.x1 for l in lines)
    text, hard_all = lines[0].text, True
    for prev, l in zip(lines, lines[1:]):
        size = prev.size
        # Right-aligned and centred blocks (a sender's name and title, a
        # signature) almost always break lines on purpose.
        hard = prev.x1 < right - 2 * size if align == "left" else True
        hard_all = hard_all and hard
        if hard:
            text += "\n" + l.text
        elif WIDE_CHAR.match(plain_text(text)[-1:]) or WIDE_CHAR.match(l.plain[:1]):
            text += l.text
        else:
            text += " " + l.text
    return text, hard_all and len(lines) > 1


def _align(lines, content_left, content_right) -> str:
    size = lines[0].size
    if len(lines) >= 2:
        def spread(vals):
            return max(vals) - min(vals)
        body = lines[1:] if len(lines) > 2 else lines  # ignore a first-line indent
        spreads = [("left", spread([l.x0 for l in body])),
                   ("right", spread([l.x1 for l in lines])),
                   ("center", spread([(l.x0 + l.x1) / 2 for l in lines]))]
        best, value = min(spreads, key=lambda kv: kv[1])
        return best if value < 0.8 * size else "left"
    l = lines[0]
    span = max(content_right - content_left, 1.0)
    if abs((l.x0 + l.x1) / 2 - (content_left + content_right) / 2) < max(0.04 * span, size) and l.x0 - content_left > 0.08 * span:
        return "center"
    if abs(l.x1 - content_right) < max(size, 0.015 * span) and l.x0 > content_left + 0.35 * span:
        return "right"
    return "left"


# ---------------------------------------------------------------- free space

def _overlap(a0, a1, b0, b1) -> bool:
    return min(a1, b1) - max(a0, b0) > 0.5


def _grow(seg: Segment, obstacles, page_w, page_h, content_left, content_right):
    """Grow a segment's box sideways (single lines) and down into empty space."""
    x0, top, x1, bottom = seg.bbox
    size = seg.size
    others = [o for o in obstacles if o is not seg.bbox]
    right_cap = max(x1, page_w - content_left, content_right)
    left_cap = min(x0, content_left)

    def room_right():
        lim = right_cap
        for o in others:
            if _overlap(top, bottom, o[1], o[3]) and o[0] >= x1 - 0.5:
                lim = min(lim, o[0] - 0.6 * size)
        return max(x1, lim)

    def room_left():
        lim = left_cap
        for o in others:
            if _overlap(top, bottom, o[1], o[3]) and o[2] <= x0 + 0.5:
                lim = max(lim, o[2] + 0.6 * size)
        return min(x0, lim)

    nx0, nx1 = x0, x1
    if seg.kind != "paragraph":  # wrapped paragraphs keep their column width
        if seg.align == "left" and seg.kind != "vertical":
            nx1 = room_right()
        elif seg.align == "right":
            nx0 = room_left()
        else:
            extra = min(room_right() - x1, x0 - room_left())
            nx0, nx1 = x0 - extra, x1 + extra

    lim = page_h - 20
    for o in others:
        if _overlap(nx0, nx1, o[0], o[2]) and o[1] >= bottom - 0.5 * size:
            lim = min(lim, o[1] - 0.25 * size)
    nbottom = max(bottom, lim)
    return (nx0, top, nx1, nbottom)


def _max_chars(seg: Segment, target_cjk: bool) -> int:
    x0, top, x1, bottom = seg.box
    length, thick = (bottom - top, x1 - x0) if seg.kind == "vertical" else (x1 - x0, bottom - top)
    per_char = (1.0 if target_cjk else 0.5) * seg.size
    lines = max(1, int((thick + 0.25 * seg.size) / (1.2 * seg.size)))
    return max(4, int(lines * length / per_char * 0.95))


# ---------------------------------------------------------------- pages

def _shift(obj: dict, ox: float, oy: float) -> dict:
    """pdfplumber reports positions relative to the page box's origin, which is
    not always (0, 0). Normalise everything to the page's top-left corner."""
    o = dict(obj)
    o["x0"] -= ox
    o["x1"] -= ox
    o["top"] -= oy
    o["bottom"] -= oy
    return o


def _page_status(width, height, images, chars):
    area = width * height
    covered = 0.0
    for im in images:
        w = max(0.0, min(im["x1"], width) - max(im["x0"], 0))
        h = max(0.0, min(im["bottom"], height) - max(im["top"], 0))
        covered = max(covered, w * h)
    if not chars:
        return ("scanned", "page has no text layer (looks scanned)") if covered > 0.3 * area else ("empty", "")
    if covered > 0.85 * area:
        return "scanned", "text sits on a full-page image (likely an OCR layer); left untranslated"
    return "ok", ""


def _angle(c) -> int:
    a, b = c["matrix"][0], c["matrix"][1]
    return int(round(math.degrees(math.atan2(b, a))))


def _to_frame(c, angle: int, page_h: float) -> dict:
    """Express a rotated character in a frame where its text runs left to right."""
    t = math.radians(-angle)
    cos_t, sin_t = math.cos(t), math.sin(t)

    def rot(x, y):
        return x * cos_t - y * sin_t, x * sin_t + y * cos_t

    corners = [rot(x, page_h - y) for x in (c["x0"], c["x1"]) for y in (c["top"], c["bottom"])]
    us, vs = [p[0] for p in corners], [p[1] for p in corners]
    ou, ov = rot(c["matrix"][4], c["matrix"][5])
    return {**c, "x0": min(us), "x1": max(us), "top": -max(vs), "bottom": -min(vs),
            "y1": max(vs), "matrix": (1, 0, 0, 1, ou, ov), "upright": True}


def extract_page(page, index: int, opts: Options) -> PageInfo:
    info = PageInfo(index=index, width=float(page.width), height=float(page.height),
                    rotation=int(page.rotation or 0) % 360)
    ox, oy = float(page.bbox[0]), float(page.bbox[1])
    chars = [_shift(c, ox, oy) for c in page.chars if c.get("text")]
    images = [_shift(im, ox, oy) for im in page.images]
    edges = [_shift(e, ox, oy) for e in page.edges]
    ink = [c for c in chars if c["text"].strip()]
    info.status, info.note = _page_status(info.width, info.height, images, ink)
    if info.status != "ok":
        return info

    # Sideways text (rotated labels, landscape tables) is handled in its own frame.
    rotated: dict = {}
    level = []
    for c in chars:
        a = _angle(c) if "matrix" in c else 0
        if a == 0:  # note pdfminer calls upside-down text "upright", so go by the angle
            level.append(c)
        else:
            rotated.setdefault(a, []).append(_to_frame(c, a, info.height))
    level = _mark_scripts(level)
    rotated = {a: _mark_scripts(cs) for a, cs in rotated.items()}

    level_ink = [c for c in level if c["text"].strip()] or ink
    content_left = min(c["x0"] for c in level_ink)
    content_right = max(c["x1"] for c in level_ink)
    body = statistics.median(c["size"] for c in ink)
    target_cjk = is_cjk_lang(opts.target_lang)
    segs: list[Segment] = []

    # Table cells become one segment each.
    cells = []
    for table in page.find_tables():
        cells.extend((x0 - ox, t - oy, x1 - ox, b - oy) for x0, t, x1, b in table.cells)
    cell_chars = {i: [] for i in range(len(cells))}
    free_chars = []
    for c in level:
        cx, cy = (c["x0"] + c["x1"]) / 2, (c["top"] + c["bottom"]) / 2
        for i, (x0, t, x1, b) in enumerate(cells):
            if x0 <= cx <= x1 and t <= cy <= b:
                cell_chars[i].append(c)
                break
        else:
            free_chars.append(c)

    pending = []  # (kind, lines, cell box, angle, content bounds)
    bounds = (content_left, content_right)
    for i, cc in cell_chars.items():
        if not any(c["text"].strip() for c in cc):
            continue
        lines = [Line(f) for row in _rows(cc) for f in _split_row(row)]
        lines.sort(key=lambda l: (l.top, l.x0))
        pending.append(("table_cell", lines, cells[i], 0, bounds))

    lines = [Line(f) for row in _rows(free_chars) for f in _split_row(row)] if free_chars else []
    columns, used = _vertical_columns(lines)
    for col in columns:
        pending.append(("vertical", col, None, 0, bounds))
    lines = [l for l in lines if id(l) not in used]
    for block in _blocks(lines):
        pending.append(("text", block, None, 0, bounds))

    for angle, rchars in rotated.items():
        rink = [c for c in rchars if c["text"].strip()]
        if not rink:
            continue
        rbounds = (min(c["x0"] for c in rink), max(c["x1"] for c in rink))
        rlines = [Line(f) for row in _rows(rchars) for f in _split_row(row)]
        for block in _blocks(rlines):
            pending.append(("text", block, None, angle, rbounds))

    for kind, block, cell, angle, (cl, cr) in pending:
        size = statistics.median(l.size for l in block)
        x0 = min(l.x0 for l in block)
        x1 = max(l.x1 for l in block)
        top = min(l.top for l in block)
        bottom = max(l.bottom for l in block)
        hard = False
        if kind == "vertical":
            text = "".join(l.text for l in block)
            align = "center"
        else:
            if kind == "table_cell":
                cx0, ct, cx1, cb = cell
                lgap, rgap = x0 - cx0, cx1 - x1
                align = "center" if abs(lgap - rgap) < 0.15 * (cx1 - cx0) and lgap > 4 else ("right" if rgap < lgap * 0.5 else "left")
            else:
                align = _align(block, cl, cr)
            text, hard = _join(block, align)
        if kind == "text":
            heading = size >= 1.18 * body or (block[0].bold and len(block) == 1 and len(text) <= 60 and size >= body)
            kind = "heading" if heading else ("paragraph" if len(block) > 1 and not hard else "line")
        pitches = [b.top - a.top for a, b in zip(block, block[1:]) if b.top > a.top]
        leading = statistics.median(pitches) / size if pitches and kind != "vertical" else 1.2
        seg = Segment(
            id="", page=index, kind=kind, text=text,
            bbox=(x0, top, x1, bottom), box=(x0, top, x1, bottom),
            size=round(size, 2), leading=round(max(1.0, min(leading, 2.2)), 3), lines=len(block),
            bold=block[0].bold, serif=block[0].serif, color=block[0].color, align=align,
            translate=needs_translation(text, opts.source_lang),
            baseline=round(block[0].baseline, 2) if kind != "vertical" else None,
            angle=float(angle),
        )
        if kind == "table_cell":
            # Keep the cell's original padding on the side the text is anchored to.
            cx0, ct, cx1, cb = cell
            bx0 = x0 if align == "left" else cx0 + 3
            bx1 = x1 if align == "right" else cx1 - 3
            seg.box = (min(bx0, x0), ct + 2, max(bx1, x1), cb - 2)
        segs.append(seg)

    # Grow boxes into free space, avoiding other text, rules, borders and images.
    level_segs = [s for s in segs if not s.angle]
    obstacles = [s.bbox for s in level_segs if s.kind != "table_cell"] + [tuple(c) for c in cells]
    obstacles += [(e["x0"], e["top"], e["x1"], e["bottom"]) for e in edges]
    obstacles += [(im["x0"], im["top"], im["x1"], im["bottom"]) for im in images]
    for s in segs:
        if s.kind != "table_cell" and not s.angle:
            own = [o for o in obstacles if o != s.bbox and not _contains(o, s.bbox)]
            s.box = _grow(s, own, info.width, info.height, content_left, content_right)
        s.max_chars = _max_chars(s, target_cjk)

    segs.sort(key=lambda s: (s.angle != 0, round(s.bbox[1] / 4), s.bbox[0]))
    for n, s in enumerate(segs, 1):
        s.id = f"p{index + 1}-{n}"
    info.segments = segs
    if rotated:
        info.note = "page has sideways text; it is translated in place at its original angle"
    return info


def _contains(outer, inner) -> bool:
    """True for a rectangle (like a filled box or a table) that encloses the text."""
    return outer[0] <= inner[0] + 0.5 and outer[1] <= inner[1] + 0.5 and outer[2] >= inner[2] - 0.5 and outer[3] >= inner[3] - 0.5


def extract_document(path: str, opts: Options) -> list[PageInfo]:
    if AUTO in (normalize_language(opts.source_lang), normalize_language(opts.target_lang)):
        from dataclasses import replace
        source, target, _ = resolve_languages(path, opts.source_lang, opts.target_lang)
        opts = replace(opts, source_lang=source, target_lang=target)
    with pdfplumber.open(path) as pdf:
        return [extract_page(p, i, opts) for i, p in enumerate(pdf.pages)]
