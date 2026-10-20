"""The Claude calls: read the whole document, translate page by page, review.

Every call asks for structured JSON output (output_config with a JSON schema).
Works with the official SDK (`anthropic.Anthropic()`), or anything with the
same `client.messages.create(...)` shape.
"""
from __future__ import annotations

import base64
import io
import json

import pikepdf
import pypdfium2 as pdfium

from .extract import is_cjk_lang
from .models import Options, Segment, Usage

MAX_PDF_BYTES = 30 * 1024 * 1024
IMAGE_LONG_SIDE = 1568  # larger images are downscaled by the API anyway


class LLMError(RuntimeError):
    pass


# ---------------------------------------------------------------- output schemas
# Replies use structured outputs (output_config.format = json_schema), which the
# current models support; they reject forced tool calls. Every object needs
# additionalProperties: false, and every property is listed as required.

def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


STR = {"type": "string"}

BRIEF_SCHEMA = _obj({
    "document_type": {"type": "string", "description": "What kind of document this is."},
    "summary": {"type": "string", "description": "Two or three sentences on what the document says and what it is for."},
    "audience": {"type": "string", "description": "Who reads the original, and who will read the translation."},
    "source_tone": {"type": "string", "description": "The register and tone of the original."},
    "target_style": {"type": "string", "description": "How the translation should read so it does the same job for its readers."},
    "conventions": {"type": "array", "items": STR,
                    "description": "Concrete decisions every page must follow: dates, numbers, currency, names and "
                                   "honorifics, company names, addresses, set phrases, headings, punctuation."},
    "glossary": {"type": "array", "items": _obj({"source": STR, "target": STR, "note": STR}),
                 "description": "Names and recurring terms with the one rendering to use everywhere."},
    "keep_as_is": {"type": "array", "items": STR, "description": "Strings that must not be translated."},
})

TRANSLATE_SCHEMA = _obj({
    "translations": {"type": "array", "items": _obj({"id": STR, "text": STR}),
                     "description": "One entry per segment id you were given."},
})

REVIEW_SCHEMA = _obj({
    "issues": {"type": "array", "description": "Problems found on the recreated page; empty if the page is fine.",
               "items": _obj({
                   "segment_id": {"type": "string", "description": "The segment's id, or an empty string if the issue is not tied to one segment."},
                   "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                   "problem": STR,
                   "replacement": {"type": "string", "description": "Corrected text for that segment when the fix is a text change; otherwise an empty string."},
               })},
})


# ---------------------------------------------------------------- prompts

JAPANESE_NOTES = """Points that usually need a decision in Japanese documents:
- Era dates (令和, 平成): convert to the Western calendar unless the context needs the era.
- Personal names (family name first in Japanese) and honorifics (様, 殿, 各位, さん).
- Company names: use the company's own English name if the document shows one; otherwise a form such as "Co., Ltd." for 株式会社.
- Letter formulas with no direct English equivalent: 拝啓/敬具, 前略, seasonal greetings (秋冷の候 etc.), 記/以上, ご高配を賜り.
- Keigo: decide how its politeness should come across in the target language.
- Brackets and punctuation: 「」『』, full-width colons and parentheses, 〜 ranges, ※ notes.
- Addresses (〒, order of elements), currency (円, ¥) and tax notes (税別, 税込), units such as 枚/分.
"""

ANALYSIS_PROMPT = """You are the lead translator on a project to recreate this document in {target}. It is written in {source}.

Read the whole document first. Then write the brief that every translator on the project will follow, so that the {target} version reads as if it had been written in {target} for the same purpose and readers, while keeping the same layout.

Be concrete. A convention like "Convert 令和8年10月7日 to October 7, 2026" is useful; "translate dates appropriately" is not. Put every person, company, product, place and recurring term in the glossary with the one rendering to use everywhere. Note anything that looks like it belongs to the layout rather than the language (logos, product names, codes) under keep_as_is.

{notes}{extra}
Reply with the brief as JSON in the required format."""

TRANSLATE_SYSTEM = """You are recreating a {source} document in {target}. The result must read as if it had been written in {target} originally, for the same purpose and readers, and it must keep the exact same layout.

<brief>
{brief}
</brief>

How the work is set up
- You get one page at a time: an image of the original page, and its text segments as JSON. Each segment is one text box in the layout, in rough reading order. Use the image to see what each segment is (heading, label, value, table cell, caption) and which segments belong together.
- type tells you what the box is: heading, paragraph (wrapped text), line (a single line, or a short block whose line breaks are deliberate), table_cell, vertical (a vertical label that will be printed rotated).
- max_chars is roughly how many {target} characters fit in the box at the original font size. Stay within it whenever you can; prefer a shorter natural phrasing to going over. Labels and table cells should be terse.

How to translate
- Translate meaning and intent, not words. Rework set phrases, formulas and politeness into what a native {target} writer would use in this kind of document. If a formula has no natural equivalent and adds nothing for {target} readers, shorten it instead of translating it literally.
- Follow the brief's conventions and glossary exactly, on every page.
- One output per segment, with the same id. Never move content between segments or merge them. A segment can be a fragment that continues in the next one (a label and its value, a sentence split across boxes); translate each piece so they still read correctly together.
- Keep "\\n" line breaks where the original had deliberate breaks (an address, a sign-off block, a name and title) and they still make sense.
- If a segment exists only as a {source} convention with no role in {target} (for example a lone marker), you may return an empty string for it.
- Numbers, amounts, dates, codes, URLs, email addresses and phone numbers must stay accurate; change their format only as the brief says.
- Text inside <sup>...</sup> or <sub>...</sub> is printed as a superscript or subscript. Markers (footnote marks, author numbers, statistical significance letters such as 4.67 ± 0.62<sup>a</sup>) must be kept exactly, with the same tags, attached to the same number or word. A superscript that only stands for a symbol or unit (2 to 4<sup>0</sup>C meaning °C, kg m<sup>-2</sup>, 5<sup>th</sup>) may be written the normal {target} way instead (for example °C or kg/m², or 4℃ and 5日目 in Japanese); otherwise keep the tags. Never add tags that were not there.
{extra}
Reply with JSON in the required format, with every segment id you were given."""

REVIEW_PROMPT = """You are reviewing a document that was recreated in {target} from a {source} original. The first image is the original page; the second is the recreated page. The segments below map each text box to its source and its translation.

Check the recreated page as a careful bilingual reader would:
- meaning errors, omissions or additions compared with the original
- text that overflows its box, overlaps something, is clipped, or is far too small to read
- {source} text left untranslated where it should have been translated
- numbers, dates, amounts, names or terms that are wrong or inconsistent with the brief
- superscript or subscript markers in the original (footnote marks, significance letters, shown in the segments as <sup>...</sup> / <sub>...</sub>) that are missing, changed or attached to the wrong number; keep the tags in any replacement
- tone that does not fit the document

Only report real problems. When a problem can be fixed by changing one segment's text (for example a shorter phrasing that fits), give the full corrected text as the replacement.

<brief>
{brief}
</brief>

<segments>
{segments}
</segments>

Reply with your findings as JSON in the required format."""


def format_brief(brief: dict) -> str:
    out = [
        f"Document: {brief.get('document_type', '')}",
        f"Summary: {brief.get('summary', '')}",
        f"Audience: {brief.get('audience', '')}",
        f"Tone of the original: {brief.get('source_tone', '')}",
        f"How the translation should read: {brief.get('target_style', '')}",
    ]
    if brief.get("conventions"):
        out.append("Conventions:")
        out += [f"- {c}" for c in brief["conventions"]]
    if brief.get("glossary"):
        out.append("Glossary (always use these renderings):")
        for g in brief["glossary"]:
            note = f"  ({g['note']})" if g.get("note") else ""
            out.append(f"- {g['source']} → {g['target']}{note}")
    if brief.get("keep_as_is"):
        out.append("Keep unchanged: " + ", ".join(brief["keep_as_is"]))
    return "\n".join(out)


# ---------------------------------------------------------------- helpers

def _call_json(client, *, model, system, content, schema, max_tokens, usage: Usage) -> dict:
    request = dict(model=model, max_tokens=max_tokens, system=system,
                   messages=[{"role": "user", "content": content}])
    output_config = {"format": {"type": "json_schema", "schema": schema}}
    try:
        resp = client.messages.create(**request, output_config=output_config)
    except TypeError:  # an older SDK without the parameter: send it as a raw field
        resp = client.messages.create(**request, extra_body={"output_config": output_config})
    usage.add(model, getattr(resp, "usage", None))
    stop = getattr(resp, "stop_reason", None)
    if stop in ("max_tokens", "refusal"):
        raise LLMError(stop)
    text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", None) == "text")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"reply was not valid JSON: {e}") from e


def _b64(data: bytes) -> str:
    return base64.standard_b64encode(data).decode("ascii")


def pdf_for_analysis(path: str, max_pages: int) -> bytes:
    """The PDF to send for the read-through: the whole file if it fits the
    request limits, otherwise its first pages."""
    with open(path, "rb") as f:
        data = f.read()
    with pikepdf.open(path) as src:
        n = len(src.pages)
        if n <= max_pages and len(data) <= MAX_PDF_BYTES:
            return data
        keep = min(n, max_pages)
        while keep >= 1:
            out = pikepdf.new()
            out.pages.extend(src.pages[:keep])
            buf = io.BytesIO()
            out.save(buf)
            if buf.tell() <= MAX_PDF_BYTES or keep == 1:
                return buf.getvalue()
            keep //= 2
    return data


def page_png(path: str, index: int, long_side: int = IMAGE_LONG_SIDE) -> bytes:
    doc = pdfium.PdfDocument(path)
    try:
        page = doc[index]
        w, h = page.get_size()
        img = page.render(scale=long_side / max(w, h)).to_pil()
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "PNG", optimize=True)
        return buf.getvalue()
    finally:
        doc.close()


def _image_block(png: bytes) -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": _b64(png)}}


# ---------------------------------------------------------------- calls

def analyze_document(client, path: str, opts: Options, usage: Usage) -> dict:
    notes = JAPANESE_NOTES if opts.source_lang.strip().lower() in ("japanese", "ja") else ""
    extra = f"\nInstructions from the person who ordered this translation:\n{opts.extra_instructions}\n" if opts.extra_instructions else ""
    if opts.glossary:
        extra += "\nRequired terminology (use exactly):\n" + "\n".join(f"- {s} → {t}" for s, t in opts.glossary.items()) + "\n"
    prompt = ANALYSIS_PROMPT.format(source=opts.source_lang, target=opts.target_lang, notes=notes, extra=extra)
    content = [
        {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                        "data": _b64(pdf_for_analysis(path, opts.max_analysis_pages))}},
        {"type": "text", "text": prompt},
    ]
    brief = _call_json(client, model=opts.analysis_model, system="You are an expert translator and localization lead.",
                       content=content, schema=BRIEF_SCHEMA, max_tokens=20000, usage=usage)
    # The customer's terms always win over the model's suggestions.
    glossary = [g for g in brief.get("glossary", []) if g.get("source") not in opts.glossary]
    glossary += [{"source": src, "target": tgt, "note": "required by customer"} for src, tgt in opts.glossary.items()]
    brief["glossary"] = glossary
    return brief


def _batches(items: list, max_items: int = 50, max_chars: int = 2500):
    batch, size = [], 0
    for it in items:
        if batch and (len(batch) >= max_items or size + len(it["text"]) > max_chars):
            yield batch
            batch, size = [], 0
        batch.append(it)
        size += len(it["text"])
    if batch:
        yield batch


def translate_page(client, png: bytes, segments: list[Segment], page_no: int, page_count: int,
                   brief: dict, opts: Options, usage: Usage) -> dict:
    """Translate one page's segments. Returns {segment_id: translation}."""
    extra = f"\nAlso follow these instructions from the customer:\n{opts.extra_instructions}\n" if opts.extra_instructions else ""
    system = [{
        "type": "text",
        "text": TRANSLATE_SYSTEM.format(source=opts.source_lang, target=opts.target_lang, brief=format_brief(brief), extra=extra),
        "cache_control": {"type": "ephemeral"},  # same system prompt for every page
    }]
    items = [{"id": s.id, "type": s.kind, "text": s.text, "max_chars": s.max_chars} for s in segments if s.translate]
    image = _image_block(png)
    results: dict = {}

    def run(batch, attempt=0):
        text = (f"Page {page_no} of {page_count}.\n<segments>\n"
                f"{json.dumps(batch, ensure_ascii=False, indent=0)}\n</segments>")
        try:
            out = _call_json(client, model=opts.translate_model, system=system,
                             content=[image, {"type": "text", "text": text}],
                             schema=TRANSLATE_SCHEMA, max_tokens=20000, usage=usage)
        except LLMError as e:
            if str(e) == "max_tokens" and len(batch) > 1:
                half = len(batch) // 2
                run(batch[:half])
                run(batch[half:])
                return
            raise
        wanted = {b["id"] for b in batch}
        for t in out.get("translations", []):
            if t.get("id") in wanted and isinstance(t.get("text"), str):
                results[t["id"]] = t["text"]
        missing = [b for b in batch if b["id"] not in results]
        if missing and attempt == 0:
            run(missing, attempt=1)

    for batch in _batches(items):
        run(batch)
    return results


def review_page(client, original_png: bytes, translated_png: bytes, segments: list[Segment],
                brief: dict, opts: Options, usage: Usage) -> list[dict]:
    rows = [{"id": s.id, "source": s.text, "translation": s.translation if s.translation is not None else s.text,
             "max_chars": s.max_chars, "overflow": s.overflow} for s in segments]
    prompt = REVIEW_PROMPT.format(source=opts.source_lang, target=opts.target_lang, brief=format_brief(brief),
                                  segments=json.dumps(rows, ensure_ascii=False, indent=0))
    content = [
        {"type": "text", "text": "Original page:"}, _image_block(original_png),
        {"type": "text", "text": "Recreated page:"}, _image_block(translated_png),
        {"type": "text", "text": prompt},
    ]
    out = _call_json(client, model=opts.review_model, system="You are a meticulous bilingual reviewer.",
                     content=content, schema=REVIEW_SCHEMA, max_tokens=20000, usage=usage)
    issues = [i for i in out.get("issues", []) if isinstance(i, dict)]
    for i in issues:  # enum casing can vary
        i["severity"] = str(i.get("severity", "")).lower()
    return issues


__all__ = ["analyze_document", "translate_page", "review_page", "page_png", "format_brief", "LLMError", "is_cjk_lang"]
