# Junction

แพลตฟอร์มจับคู่ **บริษัท ↔ ทีมนักเรียน** — บริษัทโพสต์โจทย์จริง นักเรียนส่งข้อเสนอ
(เป็นไฟล์) เมื่อถูกรับเข้าทีมก็ทำงานร่วมกันผ่านแชทในตัว รองรับ 2 ภาษา (EN / 日本語),
โหมดสว่าง/มืด, และระบบแปลเอกสาร PDF + แปลข้อความแชทด้วย Claude

## โครงสร้าง

| โฟลเดอร์ | คืออะไร |
|---|---|
| `26C01Web/web26C01/` | เว็บ (React + Vite + Tailwind) |
| `junction-api/junction-api/` | API (Node.js + Express + SQLite + JWT) |
| `pdf-translator/` | ตัวแปล PDF/ข้อความ (Python + Flask + Claude) |

## วิธีรัน (3 terminal)

**1. ตัวแปล** (จำเป็นเฉพาะฟีเจอร์ Documents / แปลแชท)
```bash
cd pdf-translator
pip install -r requirements.txt
copy .env.example .env   # ตั้ง TRANSLATOR_SECRET ให้ตรงกับ backend/.env
python server.py --test  # โหมดทดสอบฟรี (ไม่เรียก Claude); แปลจริงใส่ ANTHROPIC_API_KEY แล้วรัน python server.py
```

**2. Backend**
```bash
cd junction-api/junction-api
npm install
copy .env.example .env    # ตั้ง JWT_SECRET, RESEND_API_KEY, TRANSLATOR_SECRET
npm run dev               # http://localhost:3001
```

**3. Frontend**
```bash
cd 26C01Web/web26C01
npm install
npm run dev               # http://localhost:5173
```

เปิด http://localhost:5173 → **Log in** → **Explore as Company / Student** เพื่อลองด้วยบัญชี demo

## ไม่รวมใน repo นี้ (สร้างเองจาก `.env.example`)
- `*/.env` — คีย์ลับ (JWT, Resend, Claude API key, TRANSLATOR_SECRET)
- `junction.db` — ฐานข้อมูล สร้างอัตโนมัติตอนรันครั้งแรก
- `uploads/` — ไฟล์ที่ผู้ใช้อัปโหลด
- `node_modules/` — รัน `npm install` เพื่อสร้างใหม่
