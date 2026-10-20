# Junction API

Backend สำหรับระบบ sign up ของ Junction: สมัครสมาชิก, ยืนยันอีเมล, และ login
ใช้ Node.js + Express + better-sqlite3 + JWT (สไตล์เดียวกับที่เคยใช้ในโปรเจกต์ Junction เดิม)

## เริ่มต้นใช้งาน

### 1. ติดตั้ง dependencies
```bash
npm install
```

### 2. ตั้งค่า environment variables
คัดลอกไฟล์ตัวอย่างแล้วกรอกค่าจริง:
```bash
cp .env.example .env
```

เปิด `.env` แล้วแก้:
- `JWT_SECRET` — ใส่ string สุ่มยาว ๆ (ใช้ทำ token login ในอนาคต)
- `RESEND_API_KEY` — สมัครฟรีที่ https://resend.com (แผนฟรีส่งได้ 3,000 อีเมล/เดือน) แล้วก็อป API key มาใส่
- `FROM_EMAIL` — ถ้ายังไม่ได้ verify domain ของตัวเอง ให้ใช้ `onboarding@resend.dev` ไปก่อน (Resend เตรียมไว้ให้ทดสอบ)
- `FRONTEND_URL` — URL ของเว็บ frontend (ตอน dev คือ `http://localhost:5173`)

### 3. รันเซิร์ฟเวอร์
```bash
npm run dev
```
เซิร์ฟเวอร์จะรันที่ `http://localhost:3001` และสร้างไฟล์ฐานข้อมูล `junction.db` (SQLite) ให้อัตโนมัติในโฟลเดอร์นี้ตอนรันครั้งแรก

## API Endpoints

| Method | Path | คำอธิบาย |
|---|---|---|
| POST | `/api/auth/signup` | สมัครสมาชิก (company หรือ student) — ส่งอีเมลยืนยันให้อัตโนมัติ |
| GET | `/api/auth/verify?token=xxx` | ยืนยันอีเมลจากลิงก์ที่ส่งไป |
| POST | `/api/auth/resend-verification` | ขอลิงก์ยืนยันใหม่ (กรณีลิงก์เดิมหมดอายุ) |
| POST | `/api/auth/login` | เข้าสู่ระบบ (ต้องยืนยันอีเมลก่อนถึงจะ login ได้) |

### Problems & Proposals
ทุก endpoint ด้านล่างต้องแนบ header `Authorization: Bearer <token>` (token ได้จากตอน login)

| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| POST | `/api/problems` | company | โพสต์ปัญหาใหม่ |
| GET | `/api/problems` | ทุก role | รายการปัญหาที่ยัง `open` (ค้นหาได้ด้วย `?q=`) |
| GET | `/api/problems/mine` | company | ปัญหาทั้งหมดที่บริษัทนี้โพสต์ (พร้อมจำนวนข้อเสนอ) |
| GET | `/api/problems/:id` | ทุก role | รายละเอียดปัญหา (ถ้าเป็น student จะมี `myProposal` บอกว่าเคยเสนอไปหรือยัง) |
| PATCH | `/api/problems/:id` | company (เจ้าของ) | เปลี่ยนสถานะ `open` / `closed` |
| POST | `/api/problems/:id/proposals` | student | ส่งข้อเสนอ (1 คนต่อ 1 ปัญหา) |
| GET | `/api/problems/:id/proposals` | company (เจ้าของ) | ดูข้อเสนอทั้งหมดของปัญหานั้น |
| GET | `/api/proposals/mine` | student | ข้อเสนอทั้งหมดที่นักเรียนคนนี้ส่ง |
| PATCH | `/api/proposals/:id` | company (เจ้าของ) | ตอบข้อเสนอ: `accepted` / `rejected` / `pending` |

### ตัวอย่าง request โพสต์ปัญหา (company)
```json
POST /api/problems
Authorization: Bearer <token>
{
  "title": "Build a delivery status tracker",
  "description": "อยากได้ dashboard ภายในไว้ติดตามสถานะการส่งของ",
  "tags": "web, dashboard, internal-tools",
  "skills": "React, Node.js",
  "teamSize": "2-4 people",
  "timeline": "6 weeks",
  "compensation": "15,000 THB"
}
```

### ตัวอย่าง request ส่งข้อเสนอ (student)
```json
POST /api/problems/1/proposals
Authorization: Bearer <token>
{
  "approach": "ทีมเราจะทำด้วย React + Node...",
  "timeline": "5 weeks",
  "teamMembers": "Pond (lead), Mind, Beam"
}
```

### ทดสอบ flow ทั้งหมด
มีสคริปต์ทดสอบ end-to-end อยู่ที่ `test-e2e.mjs` (รัน signup → verify → login → post problem → browse → propose → accept ครบทั้งหมด แล้วลบข้อมูลทดสอบทิ้งให้เอง):
```bash
node test-e2e.mjs
```

### ตัวอย่าง request สมัครสมาชิก (company)
```json
POST /api/auth/signup
{
  "email": "hr@company.com",
  "password": "at-least-8-chars",
  "fullName": "Jane Doe",
  "role": "company",
  "companyName": "Acme Co.",
  "jobTitle": "HR Manager"
}
```

### ตัวอย่าง request สมัครสมาชิก (student)
```json
POST /api/auth/signup
{
  "email": "student@kuas.ac.th",
  "password": "at-least-8-chars",
  "fullName": "Pond",
  "role": "student",
  "school": "KUAS",
  "major": "Electrical Engineering"
}
```

## หมายเหตุ
- ตาราง `users` เก็บทั้ง company และ student ไว้ในตารางเดียว โดย field เฉพาะฝั่งที่ไม่ใช้จะเป็น `NULL` — พอสำหรับ scale ตอนนี้ ถ้าโปรเจกต์โตขึ้นค่อยแยกตารางทีหลังได้
- ลิงก์ยืนยันอีเมลหมดอายุใน 24 ชั่วโมง
- password จะถูก hash ด้วย bcrypt ก่อนเก็บลงฐานข้อมูลเสมอ ไม่มีการเก็บ plain text
