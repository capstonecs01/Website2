import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { db } from "../db/init.js";
import { requireAuth } from "../utils/authMiddleware.js";
import { UPLOAD_DIR } from "../utils/upload.js";
import {
  TranslatorError,
  downloadTranslation,
  getTranslation,
  submitTranslation,
  translatorHealth,
} from "../utils/translator.js";

// Documents: a signed-in user uploads PDFs to keep here, and translates one
// only when they ask (never on upload). Translation is done by the separate
// translator server; this file stores files, checks permissions and limits,
// and tracks progress. Every route is for the document's owner only.
//
//   GET    /api/documents/translator      is the translator available? + limits
//   GET    /api/documents                 my documents, each with its latest translation
//   POST   /api/documents                 upload a PDF (multipart field "file")
//   GET    /api/documents/:id             one document (refreshes translation progress)
//   POST   /api/documents/:id/translate   { source, target, review, instructions }
//   DELETE /api/documents/:id             remove the document and its translations

const router = Router();
router.use(requireAuth);

const MAX_DOCUMENT_MB = 25;
const LANGUAGES = ["auto", "Japanese", "English"];
const ACTIVE = ["queued", "running"];
const RESTARTED = "The translator was restarted before this document finished. Please translate it again.";

function dailyLimit() {
  return Number(process.env.TRANSLATIONS_PER_DAY || 5);
}

function usedToday(userId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM translations WHERE requested_by = ? AND created_at >= datetime('now', '-1 day')")
    .get(userId).n;
}

// ---------------------------------------------------------------------------
// uploads: PDFs only, saved in /uploads like every other file on the site
// ---------------------------------------------------------------------------
function newPdfName() {
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.pdf`;
}

const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, newPdfName()),
  }),
  limits: { fileSize: MAX_DOCUMENT_MB * 1024 * 1024 },
});

// multer hands back a JSON error instead of Express's HTML error page.
function receivePdf(req, res, next) {
  pdfUpload.single("file")(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `That file is too big. The limit is ${MAX_DOCUMENT_MB} MB.`
        : "The upload failed. Please try again.";
    res.status(400).json({ error: message });
  });
}

// Browsers send file names as UTF-8 but multer reads them as Latin-1, which
// garbles Japanese names. Re-decode unless the name is already proper text.
function decodeFileName(name) {
  if ([...name].some((ch) => ch.charCodeAt(0) > 255)) return name;
  const utf8 = Buffer.from(name, "latin1").toString("utf8");
  return utf8.includes("�") ? name : utf8;
}

function startsLikePdf(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    return head.toString("latin1") === "%PDF-";
  } finally {
    fs.closeSync(fd);
  }
}

function diskPath(url) {
  // urls are always "/uploads/<name>" written by this server
  return path.join(UPLOAD_DIR, path.basename(url || ""));
}

function removeFile(url) {
  if (url) fs.promises.unlink(diskPath(url)).catch(() => {});
}

// ---------------------------------------------------------------------------
// shaping rows for the browser
// ---------------------------------------------------------------------------
function serializeTranslation(t) {
  if (!t) return null;
  let warnings = [];
  try {
    warnings = JSON.parse(t.warnings || "[]");
  } catch {
    // keep []
  }
  return {
    id: t.id,
    status: t.status,
    stage: t.stage || t.status,
    done: t.progress_done,
    total: t.progress_total,
    source: t.source_lang,
    target: t.target_lang,
    review: !!t.review,
    pages: t.pages,
    file: t.result_url ? { url: t.result_url, name: t.result_name } : null,
    warnings,
    costUsd: t.cost_usd,
    error: t.error,
    createdAt: t.created_at,
    finishedAt: t.finished_at,
  };
}

function serializeDocument(d, t) {
  return {
    id: d.id,
    name: d.file_name,
    url: d.file_url,
    size: d.file_size,
    createdAt: d.created_at,
    translation: serializeTranslation(t),
  };
}

function latestTranslation(documentId) {
  return db.prepare("SELECT * FROM translations WHERE document_id = ? ORDER BY id DESC LIMIT 1").get(documentId);
}

function getTranslationRow(id) {
  return db.prepare("SELECT * FROM translations WHERE id = ?").get(id);
}

function ownDocument(req, res) {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!doc || doc.owner_id !== req.user.id) {
    res.status(404).json({ error: "document not found" });
    return null;
  }
  return doc;
}

// "invite.pdf" + "English" -> "invite_English.pdf"
function resultName(fileName, target) {
  const base = fileName.replace(/\.pdf$/i, "");
  return `${base}_${target || "translated"}.pdf`;
}

// ---------------------------------------------------------------------------
// progress: ask the translator about a running job and record the answer.
// When it's done, the translated PDF is copied into /uploads so it stays
// available even after the translator clears its own files.
// ---------------------------------------------------------------------------
const finishing = new Set(); // translation ids being downloaded right now

async function refresh(t) {
  if (!t || !ACTIVE.includes(t.status) || !t.translator_job_id) return t;

  let st;
  try {
    st = await getTranslation(t.translator_job_id);
  } catch (err) {
    if (err instanceof TranslatorError && err.status === 404) {
      db.prepare(
        "UPDATE translations SET status = 'failed', stage = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?"
      ).run(RESTARTED, t.id);
      return getTranslationRow(t.id);
    }
    return t; // translator unreachable for a moment: keep waiting
  }

  if (st.status === "done") {
    if (finishing.has(t.id)) return t;
    finishing.add(t.id);
    try {
      const stored = newPdfName();
      await downloadTranslation(t.translator_job_id, path.join(UPLOAD_DIR, stored));
      const doc = db.prepare("SELECT file_name FROM documents WHERE id = ?").get(t.document_id);
      const target = st.languages?.target || t.target_lang;
      db.prepare(
        `UPDATE translations
         SET status = 'done', stage = 'done', progress_done = progress_total,
             result_url = ?, result_name = ?, warnings = ?, cost_usd = ?, finished_at = datetime('now')
         WHERE id = ?`
      ).run(
        `/uploads/${stored}`,
        resultName(doc?.file_name || "document.pdf", target),
        JSON.stringify(st.warnings || []),
        st.usage?.estimated_cost_usd ?? null,
        t.id
      );
    } catch {
      return t; // download failed; the next refresh tries again
    } finally {
      finishing.delete(t.id);
    }
  } else if (st.status === "failed") {
    db.prepare(
      `UPDATE translations SET status = 'failed', stage = 'failed', error = ?, finished_at = datetime('now')
       WHERE id = ?`
    ).run(st.error || "The translation failed.", t.id);
  } else {
    db.prepare("UPDATE translations SET status = ?, stage = ?, progress_done = ?, progress_total = ? WHERE id = ?").run(
      st.status === "running" ? "running" : "queued",
      st.stage || null,
      Number(st.done) || 0,
      Number(st.total) || 0,
      t.id
    );
  }
  return getTranslationRow(t.id);
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
router.get("/translator", async (req, res) => {
  const health = await translatorHealth();
  res.json({
    available: health.ok,
    problem: health.ok ? null : health.problem,
    testMode: !!health.testMode,
    maxPages: health.maxPages ?? null,
    maxUploadMb: MAX_DOCUMENT_MB,
    dailyLimit: dailyLimit(),
    usedToday: usedToday(req.user.id),
  });
});

router.get("/", async (req, res) => {
  const docs = db
    .prepare("SELECT * FROM documents WHERE owner_id = ? ORDER BY created_at DESC, id DESC")
    .all(req.user.id);
  const out = await Promise.all(docs.map(async (d) => serializeDocument(d, await refresh(latestTranslation(d.id)))));
  res.json({ documents: out });
});

router.post("/", receivePdf, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "choose a PDF to upload" });
  }
  if (!startsLikePdf(req.file.path)) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: "That file is not a PDF." });
  }

  const result = db
    .prepare("INSERT INTO documents (owner_id, file_url, file_name, file_size) VALUES (?, ?, ?, ?)")
    .run(req.user.id, `/uploads/${req.file.filename}`, decodeFileName(req.file.originalname), req.file.size);
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ document: serializeDocument(doc, null) });
});

router.get("/:id", async (req, res) => {
  const doc = ownDocument(req, res);
  if (!doc) return;
  res.json({ document: serializeDocument(doc, await refresh(latestTranslation(doc.id))) });
});

router.post("/:id/translate", async (req, res) => {
  const doc = ownDocument(req, res);
  if (!doc) return;

  const { source = "auto", target = "auto", review = false, instructions = "" } = req.body || {};
  if (!LANGUAGES.includes(source) || !LANGUAGES.includes(target)) {
    return res.status(400).json({ error: `languages must be one of: ${LANGUAGES.join(", ")}` });
  }
  if (source !== "auto" && source === target) {
    return res.status(400).json({ error: "pick two different languages" });
  }

  const current = await refresh(latestTranslation(doc.id));
  if (current && ACTIVE.includes(current.status)) {
    return res.status(409).json({ error: "This document is already being translated." });
  }

  const limit = dailyLimit();
  if (usedToday(req.user.id) >= limit) {
    return res.status(429).json({
      error: `You've used all ${limit} translations for today. Please try again tomorrow.`,
    });
  }

  if (!fs.existsSync(diskPath(doc.file_url))) {
    return res.status(410).json({ error: "The original file is missing on the server. Please upload it again." });
  }

  let job;
  try {
    job = await submitTranslation({
      filePath: diskPath(doc.file_url),
      fileName: doc.file_name,
      source,
      target,
      review: !!review,
      instructions: String(instructions || "").slice(0, 1000),
    });
  } catch (err) {
    if (err instanceof TranslatorError) {
      // 400 = the translator refused this file (page limit, no readable text, ...)
      return res.status(err.status === 400 ? 400 : 503).json({ error: err.message });
    }
    throw err;
  }

  const result = db
    .prepare(
      `INSERT INTO translations (document_id, requested_by, translator_job_id, status, stage,
                                 source_lang, target_lang, review, pages)
       VALUES (?, ?, ?, 'queued', 'queued', ?, ?, ?, ?)`
    )
    .run(
      doc.id,
      req.user.id,
      job.id,
      job.languages?.source || source,
      job.languages?.target || target,
      review ? 1 : 0,
      job.pages ?? null
    );

  res.status(202).json({ document: serializeDocument(doc, getTranslationRow(result.lastInsertRowid)) });
});

// ---------------------------------------------------------------------------
// POST /api/documents/from-proposal/:proposalId  { source?, target?, review? }
// Translate a proposal's PDF: copy it into the caller's documents and start a
// translation, reusing the whole Documents pipeline. Visible to the company
// that owns the problem, or to the student who submitted the proposal.
// ---------------------------------------------------------------------------
router.post("/from-proposal/:proposalId", async (req, res) => {
  const proposal = db
    .prepare(
      `SELECT pr.id, pr.student_id, pr.file_url, pr.file_name, p.company_id
       FROM proposals pr JOIN problems p ON p.id = pr.problem_id
       WHERE pr.id = ?`
    )
    .get(req.params.proposalId);

  if (!proposal) return res.status(404).json({ error: "proposal not found" });

  const allowed =
    (req.user.role === "company" && proposal.company_id === req.user.id) ||
    (req.user.role === "student" && proposal.student_id === req.user.id);
  if (!allowed) return res.status(403).json({ error: "you can't translate this proposal" });

  if (!proposal.file_url) return res.status(400).json({ error: "this proposal has no file" });

  const { source = "auto", target = "auto", review = false } = req.body || {};
  if (!LANGUAGES.includes(source) || !LANGUAGES.includes(target)) {
    return res.status(400).json({ error: `languages must be one of: ${LANGUAGES.join(", ")}` });
  }
  if (source !== "auto" && source === target) {
    return res.status(400).json({ error: "pick two different languages" });
  }

  const srcPath = diskPath(proposal.file_url);
  if (!fs.existsSync(srcPath)) {
    return res.status(410).json({ error: "the proposal file is missing on the server" });
  }
  if (!startsLikePdf(srcPath)) {
    return res.status(400).json({ error: "Only PDF proposals can be translated. This one isn't a PDF." });
  }

  const limit = dailyLimit();
  if (usedToday(req.user.id) >= limit) {
    return res.status(429).json({ error: `You've used all ${limit} translations for today. Please try again tomorrow.` });
  }

  // Copy the proposal's PDF into a fresh file the caller owns.
  const stored = newPdfName();
  fs.copyFileSync(srcPath, path.join(UPLOAD_DIR, stored));
  const size = fs.statSync(path.join(UPLOAD_DIR, stored)).size;
  const docRow = db
    .prepare("INSERT INTO documents (owner_id, file_url, file_name, file_size) VALUES (?, ?, ?, ?)")
    .run(req.user.id, `/uploads/${stored}`, proposal.file_name || "proposal.pdf", size);
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(docRow.lastInsertRowid);

  let job;
  try {
    job = await submitTranslation({
      filePath: path.join(UPLOAD_DIR, stored),
      fileName: doc.file_name,
      source,
      target,
      review: !!review,
      instructions: "",
    });
  } catch (err) {
    // Roll back the imported document if the translator rejected it.
    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
    removeFile(doc.file_url);
    if (err instanceof TranslatorError) {
      return res.status(err.status === 400 ? 400 : 503).json({ error: err.message });
    }
    throw err;
  }

  const t = db
    .prepare(
      `INSERT INTO translations (document_id, requested_by, translator_job_id, status, stage,
                                 source_lang, target_lang, review, pages)
       VALUES (?, ?, ?, 'queued', 'queued', ?, ?, ?, ?)`
    )
    .run(doc.id, req.user.id, job.id, job.languages?.source || source, job.languages?.target || target, review ? 1 : 0, job.pages ?? null);

  res.status(202).json({ document: serializeDocument(doc, getTranslationRow(t.lastInsertRowid)) });
});

router.delete("/:id", async (req, res) => {
  const doc = ownDocument(req, res);
  if (!doc) return;

  const current = await refresh(latestTranslation(doc.id));
  if (current && ACTIVE.includes(current.status)) {
    return res.status(409).json({ error: "Wait until the translation finishes before deleting this document." });
  }

  const results = db.prepare("SELECT result_url FROM translations WHERE document_id = ?").all(doc.id);
  // Foreign-key cascades aren't enabled, so remove the translations explicitly.
  db.transaction(() => {
    db.prepare("DELETE FROM translations WHERE document_id = ?").run(doc.id);
    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
  })();
  removeFile(doc.file_url);
  for (const r of results) removeFile(r.result_url);

  res.json({ message: "document deleted" });
});

export default router;
