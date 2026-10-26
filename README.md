# Junction

แพลตฟอร์มจับคู่ **บริษัท ↔ ทีมนักเรียน** — บริษัทโพสต์โจทย์จริง นักเรียนส่งข้อเสนอ
(เป็นไฟล์) เมื่อถูกรับเข้าทีมก็ทำงานร่วมกันผ่านแชทในตัว รองรับ 2 ภาษา (EN / 日本語),
โหมดสว่าง/มืด, ระบบแปลเอกสาร PDF ด้วย Claude และแปลข้อความแชทด้วย Azure AI Translator

**นำขึ้นออนไลน์ (Render):** ดูขั้นตอนใน [DEPLOY.md](DEPLOY.md) (ภาษาอังกฤษ)

**เปิดให้ทดสอบจากเครื่องนี้ (ฟรี, Cloudflare Tunnel):** ดับเบิลคลิก `start-test-site.bat` — ดูขั้นตอนใน [TEST-SITE.md](TEST-SITE.md) (ภาษาอังกฤษ)

## โครงสร้าง

| โฟลเดอร์ | คืออะไร |
|---|---|
| `frontend/` | เว็บ (React + Vite + Tailwind) |
| `backend/` | API (Node.js + Express + SQLite + JWT) |
| `pdf-translator/` | ตัวแปล PDF/ข้อความ (Python + Flask + Claude) |

## วิธีรัน (3 terminal)

**1. ตัวแปล PDF** (จำเป็นเฉพาะฟีเจอร์ Documents — การแปลแชทไม่ต้องใช้)
```bash
cd pdf-translator
pip install -r requirements.txt
copy .env.example .env   # ตั้ง TRANSLATOR_SECRET ให้ตรงกับ backend/.env
python server.py --test  # โหมดทดสอบฟรี (ไม่เรียก Claude); แปลจริงใส่ ANTHROPIC_API_KEY แล้วรัน python server.py
```

**2. Backend**
```bash
cd backend
npm install
copy .env.example .env    # ตั้ง JWT_SECRET, RESEND_API_KEY, TRANSLATOR_SECRET, AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_REGION
npm run dev               # http://localhost:3001
```

**3. Frontend**
```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

การแปลแชทใช้ Azure AI Translator โดยตรงจาก backend (ไม่ผ่านตัวแปล PDF) — ถ้ายังไม่ใส่ `AZURE_TRANSLATOR_KEY` ปุ่มแปลในแชทจะอยู่ในโหมดทดสอบ (ตอบกลับเป็น "(test translation) ...")

เปิด http://localhost:5173 → **Log in** → **Explore as Company / Student** เพื่อลองด้วยบัญชี demo

## ไม่รวมใน repo นี้ (สร้างเองจาก `.env.example`)
- `*/.env` — คีย์ลับ (JWT, Resend, Claude API key, TRANSLATOR_SECRET, Azure Translator key)
- `junction.db` — ฐานข้อมูล สร้างอัตโนมัติตอนรันครั้งแรก
- `uploads/` — ไฟล์ที่ผู้ใช้อัปโหลด
  (บน Render ทั้งสองอย่างอยู่บนดิสก์ของ Render แทน โดยตั้งโฟลเดอร์ด้วย `DATA_DIR`)
- `node_modules/` — รัน `npm install` เพื่อสร้างใหม่
