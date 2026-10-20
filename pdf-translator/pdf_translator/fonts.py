"""Fonts for the translated text.

The original fonts are usually embedded subsets that only contain the glyphs
the source document used, so translated text is drawn with new fonts:
a sans or serif family (matching the original's style), a symbol fallback,
and a CJK fallback for any Japanese/Chinese/Korean text that stays in the
output (company names, kept terms) or for CJK target languages.

Put .ttf files in a ./fonts folder (or pass font_dir / set PDF_TRANSLATOR_FONTS)
to control exactly which fonts your server uses. Good free choices:
Liberation Sans/Serif (metric-compatible with Arial/Times), Noto Sans JP
(static .ttf files) or IPAex Gothic for Japanese.
"""
from __future__ import annotations

import os
from functools import lru_cache

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont

CANDIDATES = {
    "sans": ["LiberationSans-Regular.ttf", "Arial.ttf", "arial.ttf", "DejaVuSans.ttf", "FreeSans.ttf"],
    "sans-bold": ["LiberationSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf", "FreeSansBold.ttf"],
    "serif": ["LiberationSerif-Regular.ttf", "Times New Roman.ttf", "times.ttf", "DejaVuSerif.ttf", "FreeSerif.ttf"],
    "serif-bold": ["LiberationSerif-Bold.ttf", "Times New Roman Bold.ttf", "timesbd.ttf", "DejaVuSerif-Bold.ttf", "FreeSerifBold.ttf"],
    "symbols": ["DejaVuSans.ttf", "FreeSans.ttf", "Arial Unicode.ttf"],
    "cjk": ["NotoSansJP-Regular.ttf", "ipaexg.ttf", "IPAexGothic.ttf", "ipag.ttf", "fonts-japanese-gothic.ttf"],
    "cjk-bold": ["NotoSansJP-Bold.ttf"],
}
BASE14 = {"sans": "Helvetica", "sans-bold": "Helvetica-Bold", "serif": "Times-Roman", "serif-bold": "Times-Bold"}
SYSTEM_DIRS = [
    "./fonts", "/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts"),
    "/Library/Fonts", "/System/Library/Fonts/Supplemental", "C:/Windows/Fonts",
]


@lru_cache(maxsize=4)
def _font_index(dirs: tuple) -> dict:
    index = {}
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        for root, _, files in os.walk(d):
            for f in files:
                if f.lower().endswith(".ttf"):
                    index.setdefault(f.lower(), os.path.join(root, f))
    return index


class FontKit:
    """Picks fonts per segment and splits text into runs each font can draw."""

    def __init__(self, font_dir: str | None = None):
        dirs = tuple(d for d in (font_dir, os.environ.get("PDF_TRANSLATOR_FONTS"), *SYSTEM_DIRS) if d)
        index = _font_index(dirs)
        self.names: dict = {}
        self._glyphs: dict = {}
        for role, files in CANDIDATES.items():
            for fname in files:
                path = index.get(fname.lower())
                if not path:
                    continue
                name = f"pt-{role}"
                try:
                    font = TTFont(name, path)
                    pdfmetrics.registerFont(font)
                except Exception:
                    continue
                self.names[role] = name
                # glyph 0 is the font's "missing glyph" box, not real coverage
                self._glyphs[name] = {cp for cp, gid in font.face.charToGlyph.items() if gid}
                break
        for role, base in BASE14.items():
            self.names.setdefault(role, base)
        if "cjk" not in self.names:
            pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
            self.names["cjk"] = "HeiseiKakuGo-W5"
        self.names.setdefault("cjk-bold", self.names["cjk"])
        self.names.setdefault("symbols", self.names["sans"])

    def primary(self, serif: bool, bold: bool, cjk_target: bool = False) -> str:
        if cjk_target:
            return self.names["cjk-bold" if bold else "cjk"]
        return self.names[("serif" if serif else "sans") + ("-bold" if bold else "")]

    def _covers(self, font: str, ch: str) -> bool:
        glyphs = self._glyphs.get(font)
        if glyphs is not None:
            return ord(ch) in glyphs
        if font.startswith("Heisei"):
            return True
        try:  # base-14 fonts use WinAnsi encoding
            ch.encode("cp1252")
            return True
        except UnicodeEncodeError:
            return False

    def runs(self, text: str, primary: str):
        """Split text into (substring, font) runs, falling back per character."""
        out = []
        for ch in text:
            if self._covers(primary, ch):
                font = primary
            elif ch.isspace() and not self._covers(self.names["cjk"], ch):
                ch, font = " ", primary
            elif self._covers(self.names["symbols"], ch):
                font = self.names["symbols"]
            else:
                font = self.names["cjk"]
            if out and out[-1][1] == font:
                out[-1][0] += ch
            else:
                out.append([ch, font])
        return [(s, f) for s, f in out]

    def width(self, text: str, primary: str, size: float) -> float:
        return sum(pdfmetrics.stringWidth(s, f, size) for s, f in self.runs(text, primary))
