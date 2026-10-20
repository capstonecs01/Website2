"""Data structures shared by every stage of the pipeline.

A Job is the full record of one translation: the pages, every text segment
with its position and style, the translation brief, and token usage. It is
saved as JSON next to the output so a person can correct translations and
re-render the PDF without calling the model again.
"""
from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from typing import Optional

# Rough per-million-token prices in USD (input, output). Cache writes cost
# 1.25x input and cache reads 0.1x input. Check current pricing before relying
# on these numbers for billing: https://platform.claude.com/docs/en/models/overview
PRICES = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
}


@dataclass
class Segment:
    """One text box on a page: a paragraph, a line, a label or a table cell."""

    id: str
    page: int
    kind: str                     # heading | paragraph | line | table_cell | vertical
    text: str                     # source text
    bbox: tuple                   # (x0, top, x1, bottom) of the original text, top-left origin
    box: tuple                    # area the translation may use (bbox grown into free space)
    size: float                   # dominant font size in points
    leading: float = 1.2          # line pitch / font size
    lines: int = 1
    bold: bool = False
    serif: bool = False
    color: tuple = (0.0, 0.0, 0.0)
    align: str = "left"           # left | center | right
    translate: bool = True        # False for numbers, codes, URLs and the like
    max_chars: Optional[int] = None
    baseline: Optional[float] = None  # first line's baseline (top-left origin)
    angle: float = 0.0                # text rotation in degrees; boxes are then in the rotated frame
    translation: Optional[str] = None
    render_size: Optional[float] = None
    overflow: bool = False

    @classmethod
    def from_dict(cls, d: dict) -> "Segment":
        d = dict(d)
        for k in ("bbox", "box", "color"):
            d[k] = tuple(d[k])
        return cls(**d)


@dataclass
class PageInfo:
    index: int
    width: float
    height: float
    rotation: int = 0             # the page's /Rotate; positions are as displayed
    status: str = "ok"            # ok | scanned | empty
    note: str = ""
    segments: list = field(default_factory=list)


@dataclass
class Options:
    # "auto" detects Japanese or English from the PDF and translates to the
    # other one. Any language name works when given explicitly.
    source_lang: str = "auto"
    target_lang: str = "auto"
    # A stronger model reads the whole document and reviews the result;
    # a faster one does the page-by-page translation. Swap freely.
    analysis_model: str = "claude-opus-5-5"
    translate_model: str = "claude-sonnet-5-5"
    review_model: str = "claude-opus-5-5"
    review: bool = False          # visual QA pass on each translated page
    review_autofix: bool = True   # apply the reviewer's replacement text and re-render
    extra_instructions: str = ""  # e.g. a customer's tone or terminology requests
    glossary: dict = field(default_factory=dict)  # customer terms, source -> target
    max_workers: int = 4          # pages translated in parallel
    max_analysis_pages: int = 100
    font_dir: Optional[str] = None
    min_font_scale: float = 0.55  # never shrink text below this share of its original size


class Usage:
    """Thread-safe token counter with a cost estimate."""

    def __init__(self):
        self._lock = threading.Lock()
        self.by_model: dict = {}

    def add(self, model: str, usage) -> None:
        if usage is None:
            return
        row = {
            "input": getattr(usage, "input_tokens", 0) or 0,
            "output": getattr(usage, "output_tokens", 0) or 0,
            "cache_write": getattr(usage, "cache_creation_input_tokens", 0) or 0,
            "cache_read": getattr(usage, "cache_read_input_tokens", 0) or 0,
        }
        with self._lock:
            tot = self.by_model.setdefault(model, {"calls": 0, "input": 0, "output": 0, "cache_write": 0, "cache_read": 0})
            tot["calls"] += 1
            for k, v in row.items():
                tot[k] += v

    def cost_usd(self) -> float:
        total = 0.0
        for model, t in self.by_model.items():
            pin, pout = PRICES.get(model, (0.0, 0.0))
            total += (t["input"] * pin + t["cache_write"] * pin * 1.25 + t["cache_read"] * pin * 0.1 + t["output"] * pout) / 1e6
        return round(total, 4)

    def to_dict(self) -> dict:
        return {"by_model": self.by_model, "estimated_cost_usd": self.cost_usd()}


@dataclass
class Job:
    source_path: str
    options: Options
    pages: list = field(default_factory=list)
    brief: Optional[dict] = None
    review: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    usage: Optional[dict] = None
    detection: Optional[dict] = None  # what language detection found; None when both languages were given

    def segments(self):
        for p in self.pages:
            yield from p.segments

    def save(self, path: str) -> None:
        data = {
            "source_path": self.source_path,
            "options": asdict(self.options),
            "brief": self.brief,
            "review": self.review,
            "warnings": self.warnings,
            "usage": self.usage,
            "detection": self.detection,
            "pages": [
                {**{k: v for k, v in asdict(p).items() if k != "segments"},
                 "segments": [asdict(s) for s in p.segments]}
                for p in self.pages
            ],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)

    @classmethod
    def load(cls, path: str) -> "Job":
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        pages = []
        for p in data["pages"]:
            segs = [Segment.from_dict(s) for s in p.pop("segments")]
            pages.append(PageInfo(**p, segments=segs))
        return cls(
            source_path=data["source_path"],
            options=Options(**data["options"]),
            pages=pages,
            brief=data.get("brief"),
            review=data.get("review") or [],
            warnings=data.get("warnings") or [],
            usage=data.get("usage"),
            detection=data.get("detection"),
        )
