# PDF Translator: recreate a PDF in another language with Claude

Takes a PDF (built for Japanese → English, works for other pairs) and produces
a new PDF in the target language with the same layout: same backgrounds,
tables, images, colours, alignment and positions. Claude reads the whole document
first, so the translation follows the document's purpose, tone and
conventions instead of going sentence by sentence.

## How it works

1. **Read the layout** (`extract.py`). Every page's text layer becomes text
   boxes: paragraphs, single lines, table cells, vertical (tategaki) labels and
   sideways text. Each box keeps its position, font size, bold/serif style,
   colour and alignment, and is given extra room where the page has empty space
   next to or below it.
2. **Understand the document** (`llm.py`, `analyze_document`). Claude reads the
   whole PDF and writes a translation brief: what the document is, who it is
   for, its tone, how the English should read, concrete conventions (era dates →
   Western dates, name order, 拝啓/敬具, ※ notes…), and a glossary.
3. **Translate page by page** (`translate_page`). For each page Claude sees an
   image of the page plus its text boxes, with a character budget per box, and
   follows the brief. Pages run in parallel. Numbers, codes and URLs skip the
   model.
4. **Rebuild the PDF** (`render.py`). The original text is removed from the
   page; everything else stays. The translations are drawn into their boxes, at
   the original size when they fit, otherwise using nearby free space, otherwise
   slightly smaller.
5. **Review (optional)** (`review_page`). Claude compares the original and
   translated page images, reports problems, and its text fixes are applied
   automatically.

Every run also writes a **job file** (`<output>.job.json`) with each box's
source text, translation and position. Corrections can be made there and the
PDF re-drawn without another model call (`rerender`).

## Setup

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
```

Fonts: translated text is drawn with TrueType fonts found in `./fonts`,
`PDF_TRANSLATOR_FONTS`, or the system font folders (Liberation Sans/Serif or
Arial/Times, DejaVu for symbols, Noto Sans JP or IPAex Gothic for any Japanese
that stays in the output). On a server, put the `.ttf` files you want in
`./fonts` so output looks the same everywhere.

## Use it

Command line:

```bash
python -m pdf_translator invoice.pdf -o invoice_en.pdf        # language detected: Japanese <-> English
python -m pdf_translator article.pdf -o article_ja.pdf --from English --to Japanese
python -m pdf_translator brochure.pdf -o brochure_en.pdf --review \
    --instructions "American English, friendly tone" --glossary terms.csv
python -m pdf_translator --rerender invoice_en.job.json -o invoice_en.pdf   # after editing translations
```

Languages: leave out `--from` and `--to` and the program counts the letters
in the PDF (no model call, under a second). Mostly Japanese (kana present and
at least 25% Japanese characters) is translated to English; mostly Latin
letters is translated to Japanese. It prints what it decided, e.g.
`Detected English (Japanese 0.0%, Latin 100.0%) -> translating to Japanese`.
Give only `--from` and the target is the other of the pair; give only `--to`
and the source is detected. Both given means no detection. If it can't tell
(no text layer, Chinese, Korean, ...), it stops before calling Claude and asks
for `--from` and `--to`. Other languages always need both options.

Python:

```python
from pdf_translator import translate_pdf, Options

job = translate_pdf("in.pdf", "out.pdf", options=Options(
    review=True,               # source_lang / target_lang default to "auto"
    glossary={"さくらテック": "Sakura Tech"},
))
print(job.warnings, job.usage["estimated_cost_usd"])
```

Website: `server.py` runs the translator as a web server for the Junction
website (upload → progress → download → edit text boxes → re-render). Copy
`.env.example` to `.env`, fill in `ANTHROPIC_API_KEY` and `TRANSLATOR_SECRET`
(the website's `backend/.env` needs the same secret), then:

```bash
python server.py          # real translations, http://127.0.0.1:5000
python server.py --test   # free test mode: Claude is never called
```

It only accepts requests from this computer that carry the shared secret,
refuses PDFs over `MAX_PAGES` (default 20) before any work starts, and keeps
job status on disk so finished jobs survive a restart. The full list of
endpoints is at the top of `server.py`. `examples/flask_app.py` is the original
minimal version of the same API.

## Models and cost

Defaults: `claude-opus-5-5` reads the document and does the review,
`claude-sonnet-5-5` translates the pages. Both can be changed in `Options`.
Calls use structured outputs (JSON schemas), which these models support.

Rough cost at list prices: about 2–4 US cents per page for translation, plus
about 5–10 cents per page with review, plus a few cents per document for the
read-through. The job file records real token usage and an estimate for every
run; check those numbers on your own documents before setting prices.

## What it handles, and what it doesn't yet

Handled: text PDFs from Word, Excel, LibreOffice, InDesign and similar; tables
with ruled borders (each cell is its own box); multi-column layouts; letter-style
layouts (right-aligned dates and senders); coloured text and backgrounds;
vertical Japanese labels (drawn as rotated English); rotated pages and sideways
text; pages whose page box doesn't start at (0, 0).

Superscripts and subscripts (significance letters like 4.67 ± 0.62ᵃ, author
and footnote numbers, kg m⁻², Ca²⁺, H₂O) are recognised while reading: a small
character, raised or lowered, touching normal text, at most 6 characters long.
They are stored as `<sup>a</sup>` / `<sub>2</sub>` in the job file (you can type
these tags when editing), Claude is told to keep markers exactly, and after
translation the program warns about any text box whose markers went missing.
They are drawn at 62% size, raised or lowered, and never start a new line.

Not yet:
- **Scanned PDFs** (no text layer) are left untouched with a warning. Next step:
  OCR (for example Google Document AI or Azure Document Intelligence for
  positions, with Claude reading the page image), then paint over the old text
  and draw the new.
- **Text inside images** (logos, screenshots, charts saved as pictures).
- **Form fields and annotations** (fillable forms, comments) are not translated.
- **Long vertical-text documents** (novels, newspapers): only short vertical
  labels are handled well.
- **Right-to-left target languages** (Arabic, Hebrew) are not supported in drawing.
- Very long translations in tight boxes are shrunk (to 55% at most); anything
  that still doesn't fit is listed in the job's warnings.

Licences: everything here is permissively licensed (MIT/BSD/MPL/Apache).
PyMuPDF was avoided on purpose; it is AGPL, which can require you to publish
your site's source unless you buy a commercial licence.

## Tests

```bash
python tests/make_sample.py samples/sample_ja.pdf   # builds the Japanese sample
python tests/test_offline.py                        # full pipeline with a stand-in Claude client
python tests/test_web.py                            # the Flask API end to end
python tests/test_server.py                         # server.py: secret, page limit, restarts
python tests/test_detect.py                         # automatic language detection
python tests/test_superscripts.py                   # superscripts and subscripts
```

The stand-in client (`tests/fake_claude.py`) checks that every request is
well-formed and answers with fixed translations for the sample, so the tests
need no API key. Run a real document with your key to check translation quality.
