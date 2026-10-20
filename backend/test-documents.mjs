// End-to-end test for the Documents feature: upload -> translate -> download.
//
// Needs the translator running in FREE test mode, with the same TRANSLATOR_SECRET
// as backend/.env:
//     cd pdf-translator && python server.py --test
//     cd backend && node test-documents.mjs
//
// Creates two throwaway accounts and removes them (and their files) at the end.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { app } from "./src/server.js";
import { db } from "./src/db/init.js";
import { UPLOAD_DIR } from "./src/utils/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = process.env.SAMPLE_PDF || path.join(__dirname, "..", "..", "pdf-translator", "samples", "sample_ja.pdf");

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
async function req(method, pathname, { token, body, form } = {}) {
  const res = await fetch(BASE + "/api" + pathname, {
    method,
    headers: {
      ...(form ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
function pdfForm(bytes, name) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  return form;
}
async function makeUser(role, email) {
  const PW = "password123";
  await req("POST", "/auth/signup", {
    body: { email, password: PW, fullName: `Doc Test ${role}`, role, companyName: "Doc Co.", school: "KUAS" },
  });
  const { verification_token } = db.prepare("SELECT verification_token FROM users WHERE email = ?").get(email);
  await req("GET", `/auth/verify?token=${verification_token}`);
  const r = await req("POST", "/auth/login", { body: { email, password: PW } });
  return { token: r.data.token, id: r.data.user.id };
}
function cleanup(userIds) {
  for (const id of userIds) {
    for (const d of db.prepare("SELECT id, file_url FROM documents WHERE owner_id = ?").all(id)) {
      for (const t of db.prepare("SELECT result_url FROM translations WHERE document_id = ?").all(d.id)) {
        if (t.result_url) fs.rmSync(path.join(UPLOAD_DIR, path.basename(t.result_url)), { force: true });
      }
      fs.rmSync(path.join(UPLOAD_DIR, path.basename(d.file_url)), { force: true });
      db.prepare("DELETE FROM translations WHERE document_id = ?").run(d.id);
      db.prepare("DELETE FROM documents WHERE id = ?").run(d.id);
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }
}

const stamp = Date.now();
const owner = await makeUser("company", `docs+${stamp}@acme.test`);
const other = await makeUser("student", `docs2+${stamp}@kuas.test`);

try {
  console.log("\n== 1. Translator ==");
  let r = await req("GET", "/documents/translator", { token: owner.token });
  check("translator available", r.data.available, JSON.stringify(r.data));
  if (!r.data.available) throw new Error("start the translator first: python server.py --test");
  if (!r.data.testMode) throw new Error("the translator is using real Claude; restart it with --test so this test is free");
  check("limits reported", r.data.dailyLimit >= 1 && r.data.maxPages >= 1 && r.data.usedToday === 0, JSON.stringify(r.data));

  console.log("\n== 2. Upload ==");
  r = await req("POST", "/documents", { token: owner.token, form: pdfForm(Buffer.from("hello"), "fake.pdf") });
  check("non-PDF refused (400)", r.status === 400, JSON.stringify(r.data));
  r = await req("POST", "/documents", { form: pdfForm(fs.readFileSync(SAMPLE), "x.pdf") });
  check("upload needs login (401)", r.status === 401);
  r = await req("POST", "/documents", { token: owner.token, form: pdfForm(fs.readFileSync(SAMPLE), "招待状.pdf") });
  check("PDF stored (201)", r.status === 201, JSON.stringify(r.data));
  const doc = r.data.document;
  check("Japanese file name kept", doc?.name === "招待状.pdf", doc?.name);
  check("not translated on upload", doc?.translation === null);
  r = await req("GET", "/documents", { token: owner.token });
  check("listed for owner", r.data.documents?.length === 1);
  r = await req("GET", "/documents", { token: other.token });
  check("not listed for anyone else", r.data.documents?.length === 0);
  r = await req("GET", `/documents/${doc.id}`, { token: other.token });
  check("other user gets 404", r.status === 404);

  console.log("\n== 3. Translate ==");
  r = await req("POST", `/documents/${doc.id}/translate`, { token: other.token, body: {} });
  check("other user can't translate (404)", r.status === 404);
  r = await req("POST", `/documents/${doc.id}/translate`, { token: owner.token, body: { target: "Klingon" } });
  check("unknown language refused (400)", r.status === 400);
  r = await req("POST", `/documents/${doc.id}/translate`, { token: owner.token, body: { source: "auto", target: "auto" } });
  check("translation started (202)", r.status === 202, JSON.stringify(r.data));
  const started = r.data.document?.translation;
  check("languages detected Japanese -> English", started?.source === "Japanese" && started?.target === "English",
    JSON.stringify(started));
  check("page count recorded", started?.pages === 2);
  r = await req("POST", `/documents/${doc.id}/translate`, { token: owner.token, body: {} });
  check("second request while running refused (409)", r.status === 409, JSON.stringify(r.data));

  let t;
  const stages = new Set();
  for (let i = 0; i < 240; i++) {
    r = await req("GET", `/documents/${doc.id}`, { token: owner.token });
    t = r.data.document.translation;
    stages.add(t.stage);
    if (t.status === "done" || t.status === "failed") break;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  check("translation finished", t.status === "done", JSON.stringify(t));
  console.log(`     stages seen: ${[...stages].join(" → ")}`);
  check("result named after target language", t.file?.name === "招待状_English.pdf", t.file?.name);
  const pdf = await fetch(BASE + t.file.url);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  check("translated PDF downloads", pdf.status === 200 && bytes.subarray(0, 5).toString() === "%PDF-");
  check("cost estimate recorded", typeof t.costUsd === "number" && t.costUsd > 0, String(t.costUsd));

  console.log("\n== 4. Daily limit ==");
  r = await req("GET", "/documents/translator", { token: owner.token });
  check("usage counted", r.data.usedToday === 1, JSON.stringify(r.data));
  const saved = process.env.TRANSLATIONS_PER_DAY;
  process.env.TRANSLATIONS_PER_DAY = "1";
  r = await req("POST", `/documents/${doc.id}/translate`, { token: owner.token, body: {} });
  check("limit reached (429)", r.status === 429, JSON.stringify(r.data));
  if (saved === undefined) delete process.env.TRANSLATIONS_PER_DAY;
  else process.env.TRANSLATIONS_PER_DAY = saved;

  console.log("\n== 5. Delete ==");
  r = await req("DELETE", `/documents/${doc.id}`, { token: other.token });
  check("other user can't delete (404)", r.status === 404);
  r = await req("DELETE", `/documents/${doc.id}`, { token: owner.token });
  check("owner deletes (200)", r.status === 200);
  check("original file removed", !fs.existsSync(path.join(UPLOAD_DIR, path.basename(doc.url))));
  await new Promise((ok) => setTimeout(ok, 100));
  check("translated file removed", !fs.existsSync(path.join(UPLOAD_DIR, path.basename(t.file.url))));
  r = await req("GET", `/documents/${doc.id}`, { token: owner.token });
  check("gone afterwards (404)", r.status === 404);
} catch (err) {
  fail++;
  console.log(`\n  ✗ ${err.message}`);
} finally {
  cleanup([owner.id, other.id]);
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
