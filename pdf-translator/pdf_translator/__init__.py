"""Recreate PDF documents in another language with Claude, keeping their layout.

    from pdf_translator import translate_pdf, Options
    job = translate_pdf("in.pdf", "out.pdf")   # detects Japanese or English, translates to the other
    job = translate_pdf("in.pdf", "out.pdf", options=Options(source_lang="English", target_lang="Japanese"))
"""
from .extract import LanguageError, detect_language, resolve_languages
from .models import Job, Options, Segment
from .pipeline import rerender, translate_pdf

__all__ = ["translate_pdf", "rerender", "Options", "Job", "Segment",
           "LanguageError", "detect_language", "resolve_languages"]
