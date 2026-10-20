"""A stand-in for anthropic.Anthropic() used to test the pipeline offline.

It checks that every request is well-formed (JSON-serialisable, a structured-
output schema the API accepts, the right content blocks) and answers with canned results for
samples/sample_ja.pdf. It also misbehaves on purpose once (drops a segment)
to exercise the retry path.
"""
import json
import re
from types import SimpleNamespace

BRIEF = {
    "document_type": "Formal business invitation letter (案内状) with an attached one-page product sheet",
    "summary": "Sakura Tech invites its business partners to the launch event for SakuraScan Pro, an AI document scanner, "
               "on November 20, 2026 in Osaka. Page 2 summarises the product's features, specifications and prices.",
    "audience": "Existing corporate customers and partners; the English version is for international partners.",
    "source_tone": "Very formal keigo with standard Japanese letter formulas (拝啓/敬具, seasonal greeting, 記/以上).",
    "target_style": "Courteous, professional business English. Warm but concise; no literal seasonal greetings.",
    "conventions": [
        "Convert era dates to the Western calendar: 令和8年10月7日 → October 7, 2026.",
        "Write dates as 'Friday, November 20, 2026' and times as '2:00–4:30 p.m.'.",
        "Personal names in Western order with no honorific: 佐藤 花子 → Hanako Sato, 山田 太郎 → Taro Yamada.",
        "拝啓 + seasonal greeting → a short courteous opening; 敬具 → 'Sincerely,'; 記 → 'Event Details'; drop 以上.",
        "※ notes → start with 'Note:'.",
        "枚/分 → 'pages/min'. Keep ¥ amounts as written.",
        "Bullets '・' → '•'.",
    ],
    "glossary": [
        {"source": "株式会社さくらテック", "target": "Sakura Tech Co., Ltd."},
        {"source": "SakuraScan Pro", "target": "SakuraScan Pro"},
        {"source": "発表会", "target": "launch event"},
        {"source": "大阪国際会議場", "target": "Osaka International Convention Center"},
    ],
    "keep_as_is": ["SakuraScan Pro", "SakuraScan Lite", "SAKURA TECH", "AI-OCR"],
}

TRANSLATIONS = {
    "株式会社さくらテック": "Sakura Tech Co., Ltd.",
    "令和8年10月7日": "October 7, 2026",
    "お取引先各位": "To our valued business partners",
    "株式会社さくらテック\n営業部長　佐藤 花子": "Sakura Tech Co., Ltd.\nHanako Sato, Sales Director",
    "新製品「SakuraScan Pro」発表会のご案内": "Invitation to the SakuraScan Pro Launch Event",
    "拝啓　秋冷の候、貴社ますますご清栄のこととお慶び申し上げます。平素は格別のご高配を賜り、厚く御礼申し上げます。":
        "Dear Partners,\nWe hope this letter finds you well, and we thank you for your continued support.",
    "さて、このたび弊社では、AIを活用した文書スキャナー「SakuraScan Pro」を開発いたしました。つきましては、下記のとおり新製品発表会を開催いたしますので、ご多忙中誠に恐縮ではございますが、ぜひご来場賜りますようお願い申し上げます。":
        "We are pleased to announce SakuraScan Pro, our new AI-powered document scanner. We will be holding a launch event "
        "as detailed below. We know how busy you are, but we would be delighted if you could join us.",
    "敬具": "Sincerely,",
    "記": "Event Details",
    "日時": "Date & time",
    "2026年11月20日（金）14:00〜16:30（受付開始 13:30）": "Friday, November 20, 2026, 2:00–4:30 p.m. (reception opens at 1:30 p.m.)",
    "会場": "Venue",
    "大阪国際会議場 10階 会議室1001（大阪市北区中之島5-3-51）":
        "Osaka International Convention Center, 10F, Room 1001 (5-3-51 Nakanoshima, Kita-ku, Osaka)",
    "内容": "Program",
    "製品デモンストレーション、開発者による技術解説、質疑応答": "Product demo, technical talk by our developers, Q&A",
    "参加費": "Fee",
    "無料（事前登録制・定員80名）": "Free (advance registration required; limited to 80 guests)",
    "以上": "",
    "※ご参加の際は、10月31日（金）までに同封の申込書にてお申し込みください。当日は名刺を1枚ご持参ください。":
        "Note: To attend, please register with the enclosed form by Friday, October 31. Please bring one business card on the day.",
    "お問い合わせ：営業部　山田 太郎　TEL 06-1234-5678　Email: yamada@sakura-tech.example.jp":
        "Contact: Taro Yamada, Sales Department   Tel: 06-1234-5678   Email: yamada@sakura-tech.example.jp",
    "SakuraScan Pro 製品概要": "SakuraScan Pro Product Overview",
    "書類のデジタル化を、もっと速く、もっと正確に。": "Digitize your documents faster and more accurately.",
    "主な特長": "Key Features",
    "・毎分60枚の高速両面スキャン": "• High-speed duplex scanning at 60 pages per minute",
    "・AI-OCRにより、手書き文字も高精度でテキスト化": "• AI-OCR turns even handwriting into accurate text",
    "・クラウドストレージと自動連携し、社内共有をスムーズに": "• Syncs automatically with cloud storage for easy sharing across your company",
    "仕様": "Specifications",
    "項目": "Item",
    "読取速度": "Scan speed",
    "60枚/分": "60 pages/min",
    "30枚/分": "30 pages/min",
    "最大用紙サイズ": "Max. paper size",
    "標準価格（税別）": "List price (excl. tax)",
    "保証期間": "Warranty",
    "3年": "3 years",
    "1年": "1 year",
    "処理速度の比較（枚/分）": "Processing Speed Comparison (pages/min)",
    "期間限定価格": "Limited-time price",
}

REVIEW = {
    1: [
        {"segment_id": "p1-14", "severity": "medium",
         "problem": "The venue line was shrunk to fit its cell and is noticeably smaller than the other rows.",
         "replacement": "Osaka International Convention Center, Room 1001 (10F), 5-3-51 Nakanoshima, Osaka"},
        {"segment_id": "", "severity": "low",
         "problem": "Sign-off sits above the details block, as in the original; acceptable for an invitation.",
         "replacement": ""},
    ],
    2: [],
}


def _check_schema(node):
    """Structured outputs need additionalProperties: false on every object."""
    if isinstance(node, dict):
        if node.get("type") == "object":
            assert node.get("additionalProperties") is False, node
            assert set(node.get("required", [])) == set(node["properties"]), node
        for v in node.values():
            _check_schema(v)
    elif isinstance(node, list):
        for v in node:
            _check_schema(v)


class FakeMessages:
    def __init__(self):
        self.calls = []
        self._dropped = False

    def create(self, **kw):
        json.dumps(kw)  # every request must be serialisable
        for key in ("model", "max_tokens", "messages", "system", "output_config"):
            assert key in kw, f"missing {key}"
        assert "tools" not in kw and "tool_choice" not in kw  # current models reject forced tool use
        fmt = kw["output_config"]["format"]
        assert fmt["type"] == "json_schema"
        _check_schema(fmt["schema"])
        props = fmt["schema"]["properties"]
        tool = "submit_brief" if "glossary" in props else "submit_translations" if "translations" in props else "submit_review"
        content = kw["messages"][0]["content"]
        types = [b["type"] for b in content]
        text = "\n".join(b["text"] for b in content if b["type"] == "text")
        self.calls.append({"tool": tool, "model": kw["model"], "blocks": types})

        if tool == "submit_brief":
            assert types[0] == "document" and content[0]["source"]["media_type"] == "application/pdf"
            out, tokens_in = json.loads(json.dumps(BRIEF)), 6000
        elif tool == "submit_translations":
            assert types == ["image", "text"]
            assert "<brief>" in kw["system"][0]["text"] and kw["system"][0]["cache_control"]["type"] == "ephemeral"
            items = json.loads(re.search(r"<segments>\n(.*)\n</segments>", text, re.S).group(1))
            rows = [{"id": it["id"], "text": TRANSLATIONS[it["text"]]} for it in items]
            if not self._dropped and len(rows) > 3:  # misbehave once: forget a segment
                rows = rows[:-1]
                self._dropped = True
            out, tokens_in = {"translations": rows}, 2500 + len(text) // 2
        elif tool == "submit_review":
            assert types == ["text", "image", "text", "image", "text"]
            page = 1 if '"p1-' in text else 2
            out, tokens_in = {"issues": REVIEW[page]}, 4000
        else:
            raise AssertionError(tool)

        body = json.dumps(out, ensure_ascii=False)
        usage = SimpleNamespace(input_tokens=tokens_in, output_tokens=len(body) // 3,
                                cache_creation_input_tokens=0, cache_read_input_tokens=0)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=body)], usage=usage, stop_reason="end_turn")


class FakeClient:
    def __init__(self):
        self.messages = FakeMessages()
