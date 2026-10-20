"""Build a realistic two-page Japanese PDF for testing the translator.

Page 1: a formal business letter (案内状) with a header band, right-aligned
date and sender, a keigo body paragraph, a bordered table and a note box.
Page 2: a product sheet with headings, bullets, a 3-column spec table, a small
bar chart with labels and a vertical (tategaki) label.

Usage: python tests/make_sample.py out.pdf
"""
import os
import sys

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

JP = "JPGothic"
JP_FONTS = [  # (path, index inside a .ttc collection)
    ("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", 0),
    ("C:/Windows/Fonts/msgothic.ttc", 0),
    ("C:/Windows/Fonts/meiryo.ttc", 0),
    ("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc", 0),
    ("/Library/Fonts/Arial Unicode.ttf", 0),
]
BOLD_FONTS = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def _register():
    for path, index in JP_FONTS:
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(JP, path, subfontIndex=index))
            break
    else:
        sys.exit("no Japanese font found; add one to JP_FONTS in tests/make_sample.py")
    for path in BOLD_FONTS:
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont("LibSansBold", path))
            return
    globals()["BOLD"] = "Helvetica-Bold"  # built into every PDF viewer


BOLD = "LibSansBold"
_register()

W, H = A4
NAVY = (0.11, 0.23, 0.42)
PINK = (0.85, 0.33, 0.52)
NO_START = "、。」）』！？ー"


def wrap_ja(text, size, width):
    lines, line = [], ""
    for ch in text:
        if pdfmetrics.stringWidth(line + ch, JP, size) > width and line and ch not in NO_START:
            lines.append(line)
            line = ch
        else:
            line += ch
    if line:
        lines.append(line)
    return lines


def text(c, x, y, s, size=10.5, color=(0, 0, 0), font=JP, align="left"):
    c.setFillColorRGB(*color)
    c.setFont(font, size)
    if align == "left":
        c.drawString(x, y, s)
    elif align == "right":
        c.drawRightString(x, y, s)
    else:
        c.drawCentredString(x, y, s)


def paragraph(c, x, y, s, size, width, leading=1.7):
    for line in wrap_ja(s, size, width):
        text(c, x, y, line, size)
        y -= size * leading
    return y


def table(c, x, y, col_widths, rows, size=10, row_h=24, header_fill=None, header_row=False, header_col=False):
    c.setStrokeColorRGB(0.4, 0.4, 0.4)
    c.setLineWidth(0.6)
    for r, row in enumerate(rows):
        cx = x
        for k, cell in enumerate(row):
            w = col_widths[k]
            shaded = (header_row and r == 0) or (header_col and k == 0)
            if shaded and header_fill:
                c.setFillColorRGB(*header_fill)
                c.rect(cx, y - row_h, w, row_h, stroke=1, fill=1)
            else:
                c.rect(cx, y - row_h, w, row_h, stroke=1, fill=0)
            align = "center" if shaded or k > 0 and header_row else "left"
            if align == "center":
                text(c, cx + w / 2, y - row_h / 2 - size * 0.35, cell, size, align="center")
            else:
                text(c, cx + 6, y - row_h / 2 - size * 0.35, cell, size)
            cx += w
        y -= row_h
    return y


def page1(c):
    c.setFillColorRGB(*NAVY)
    c.rect(0, H - 56, W, 56, stroke=0, fill=1)
    c.setFillColorRGB(*PINK)
    c.circle(70, H - 28, 13, stroke=0, fill=1)
    text(c, 92, H - 33, "株式会社さくらテック", 14, (1, 1, 1))
    text(c, W - 56, H - 32, "SAKURA TECH", 11, (1, 1, 1), font=BOLD, align="right")

    m = 56
    text(c, W - m, H - 92, "令和8年10月7日", align="right")
    text(c, m, H - 120, "お取引先各位")
    text(c, W - m, H - 146, "株式会社さくらテック", align="right")
    text(c, W - m, H - 164, "営業部長　佐藤 花子", align="right")

    text(c, W / 2, H - 206, "新製品「SakuraScan Pro」発表会のご案内", 16, align="center")
    c.setStrokeColorRGB(*PINK)
    c.setLineWidth(1.2)
    c.line(W / 2 - 150, H - 214, W / 2 + 150, H - 214)

    y = H - 246
    y = paragraph(c, m, y, "拝啓　秋冷の候、貴社ますますご清栄のこととお慶び申し上げます。平素は格別のご高配を賜り、厚く御礼申し上げます。", 10.5, W - 2 * m)
    y -= 4
    y = paragraph(c, m, y, "　さて、このたび弊社では、AIを活用した文書スキャナー「SakuraScan Pro」を開発いたしました。つきましては、下記のとおり新製品発表会を開催いたしますので、ご多忙中誠に恐縮ではございますが、ぜひご来場賜りますようお願い申し上げます。", 10.5, W - 2 * m)
    text(c, W - m, y - 2, "敬具", align="right")

    text(c, W / 2, y - 34, "記", align="center")
    y = table(c, m, y - 50, [90, W - 2 * m - 90], [
        ["日時", "2026年11月20日（金）14:00〜16:30（受付開始 13:30）"],
        ["会場", "大阪国際会議場 10階 会議室1001（大阪市北区中之島5-3-51）"],
        ["内容", "製品デモンストレーション、開発者による技術解説、質疑応答"],
        ["参加費", "無料（事前登録制・定員80名）"],
    ], header_fill=(0.9, 0.92, 0.95), header_col=True)
    text(c, W - m, y - 22, "以上", align="right")

    box_top = y - 50
    c.setFillColorRGB(0.99, 0.93, 0.95)
    c.setStrokeColorRGB(*PINK)
    c.rect(m, box_top - 46, W - 2 * m, 46, stroke=1, fill=1)
    paragraph(c, m + 12, box_top - 18, "※ご参加の際は、10月31日（金）までに同封の申込書にてお申し込みください。当日は名刺を1枚ご持参ください。", 9.5, W - 2 * m - 24, 1.6)

    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.setLineWidth(0.5)
    c.line(m, 70, W - m, 70)
    text(c, m, 54, "お問い合わせ：営業部　山田 太郎　TEL 06-1234-5678　Email: yamada@sakura-tech.example.jp", 9)


def page2(c):
    m = 56
    text(c, m, H - 80, "SakuraScan Pro 製品概要", 20, NAVY)
    text(c, m, H - 106, "書類のデジタル化を、もっと速く、もっと正確に。", 12, PINK)

    def section(y, title):
        c.setFillColorRGB(*PINK)
        c.rect(m, y - 3, 4, 17, stroke=0, fill=1)
        text(c, m + 12, y, title, 13, NAVY)

    section(H - 150, "主な特長")
    y = H - 176
    for b in ["・毎分60枚の高速両面スキャン",
              "・AI-OCRにより、手書き文字も高精度でテキスト化",
              "・クラウドストレージと自動連携し、社内共有をスムーズに"]:
        text(c, m + 8, y, b)
        y -= 20

    section(y - 20, "仕様")
    table(c, m, y - 34, [150, 155, 155], [
        ["項目", "SakuraScan Pro", "SakuraScan Lite"],
        ["読取速度", "60枚/分", "30枚/分"],
        ["最大用紙サイズ", "A3", "A4"],
        ["標準価格（税別）", "¥128,000", "¥68,000"],
        ["保証期間", "3年", "1年"],
    ], header_fill=(0.9, 0.92, 0.95), header_row=True)

    # bar chart
    cx, cy = m + 40, 200
    text(c, m, cy + 150, "処理速度の比較（枚/分）", 11, NAVY)
    c.setStrokeColorRGB(0.3, 0.3, 0.3)
    c.line(cx, cy, cx + 260, cy)
    for i, (label, val, col) in enumerate([("Pro", 60, PINK), ("Lite", 30, NAVY)]):
        x = cx + 40 + i * 110
        c.setFillColorRGB(*col)
        c.rect(x, cy, 60, val * 2, stroke=0, fill=1)
        text(c, x + 30, cy + val * 2 + 6, str(val), 10, align="center")
        text(c, x + 30, cy - 16, label, 10, align="center")

    # vertical label (tategaki) in a box on the right
    bx, by = W - m - 40, 150
    c.setStrokeColorRGB(*PINK)
    c.setFillColorRGB(1, 1, 1)
    c.rect(bx, by, 34, 150, stroke=1, fill=0)
    yy = by + 150 - 26
    for ch in "期間限定価格":
        text(c, bx + 17, yy, ch, 14, PINK, align="center")
        yy -= 20

    text(c, W / 2, 40, "- 2 -", 9, (0.4, 0.4, 0.4), align="center")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "sample_ja.pdf"
    c = canvas.Canvas(out, pagesize=A4)
    c.setTitle("新製品発表会のご案内")
    page1(c)
    c.showPage()
    page2(c)
    c.showPage()
    c.save()
    print("wrote", out)
