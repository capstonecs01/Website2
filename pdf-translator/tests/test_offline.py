"""Run the whole pipeline on the sample PDF with the stand-in client.

    python tests/test_offline.py [output_dir]
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from fake_claude import FakeClient  # noqa: E402
from pdf_translator import Job, Options, rerender, translate_pdf  # noqa: E402

out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), "samples")
src = os.path.join(os.path.dirname(HERE), "samples", "sample_ja.pdf")
out = os.path.join(out_dir, "sample_en.pdf")

client = FakeClient()
stages = []
job = translate_pdf(src, out, options=Options(review=True), client=client,
                    on_progress=lambda s, d, t: stages.append((s, d, t)))

calls = client.messages.calls
tools = [c["tool"] for c in calls]
assert tools[0] == "submit_brief" and calls[0]["model"] == "claude-opus-5-5"
assert tools.count("submit_translations") == 3, tools  # 2 pages + 1 retry for the dropped segment
assert tools.count("submit_review") == 2
assert all(c["model"] == "claude-sonnet-5-5" for c in calls if c["tool"] == "submit_translations")

segs = {s.id: s for s in job.segments()}
assert all(s.translation is not None for s in segs.values()), [s.id for s in segs.values() if s.translation is None]
assert segs["p1-3"].translation == "October 7, 2026"
assert segs["p2-18"].translation == "¥128,000" and not segs["p2-18"].translate  # numbers skip the model
assert segs["p1-14"].translation.startswith("Osaka International Convention Center, Room 1001")  # review fix applied
assert any(i.get("applied") for i in job.review)
assert job.usage["by_model"]["claude-sonnet-5-5"]["calls"] == 3
assert stages[-1][0] == "done"

job_path = os.path.splitext(out)[0] + ".job.json"
reloaded = Job.load(job_path)
assert len(list(reloaded.segments())) == len(segs)

# Simulate a person editing one translation in the job file, then re-render.
data = json.load(open(job_path, encoding="utf-8"))
for seg in data["pages"][1]["segments"]:
    if seg["id"] == "p2-2":
        seg["translation"] = "Faster, more accurate document digitization."
edited = os.path.join(out_dir, "sample_en.edited.job.json")
json.dump(data, open(edited, "w", encoding="utf-8"), ensure_ascii=False)
rerender(edited, os.path.join(out_dir, "sample_en_edited.pdf"))

print("ok:", len(calls), "model calls,", len(segs), "segments")
print("warnings:", job.warnings)
for s in segs.values():
    if s.render_size and s.render_size < s.size:
        print(f"shrunk {s.id}: {s.size} -> {s.render_size}pt  {s.translation[:50]!r}")
