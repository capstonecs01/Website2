import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { db } from "../db/init.js";
import { requireAuth, requireRole } from "../utils/authMiddleware.js";
import { translateChatText, guessLanguage, ChatTranslateError, MAX_CHARS } from "../utils/azureTranslator.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

// --- file uploads (images / files) -> saved to /uploads, served statically ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB

// -------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------
function findOrCreateProjectConv(type, problemId) {
  const found = db.prepare("SELECT id FROM conversations WHERE type = ? AND problem_id = ?").get(type, problemId);
  if (found) return found.id;
  const info = db.prepare("INSERT INTO conversations (type, problem_id) VALUES (?, ?)").run(type, problemId);
  return info.lastInsertRowid;
}

function addMembers(convId, userIds) {
  const stmt = db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)");
  for (const uid of userIds) stmt.run(convId, uid);
}

// For a problem that has accepted students, make sure both project channels
// exist and everyone who should be in them is a member.
export function ensureProjectConversations(problemId) {
  const problem = db.prepare("SELECT id, company_id FROM problems WHERE id = ?").get(problemId);
  if (!problem) return;

  // Accepted team = the proposal leaders + the members they listed.
  const leaders = db
    .prepare("SELECT student_id FROM proposals WHERE problem_id = ? AND status = 'accepted'")
    .all(problemId)
    .map((r) => r.student_id);
  const memberIds = db
    .prepare(
      `SELECT pm.student_id
       FROM proposal_members pm JOIN proposals p ON p.id = pm.proposal_id
       WHERE p.problem_id = ? AND p.status = 'accepted'`
    )
    .all(problemId)
    .map((r) => r.student_id);
  const students = [...new Set([...leaders, ...memberIds])];
  if (students.length === 0) return; // not a live project yet

  const convAll = findOrCreateProjectConv("project_all", problemId);
  addMembers(convAll, [problem.company_id, ...students]);

  const convStudents = findOrCreateProjectConv("project_students", problemId);
  addMembers(convStudents, students);
}

// Ensure every project conversation the user belongs to exists before listing.
function ensureForUser(user) {
  let problemIds;
  if (user.role === "company") {
    problemIds = db
      .prepare(
        `SELECT DISTINCT p.id FROM problems p
         JOIN proposals pr ON pr.problem_id = p.id
         WHERE p.company_id = ? AND pr.status = 'accepted'`
      )
      .all(user.id);
  } else {
    problemIds = db
      .prepare(
        `SELECT DISTINCT p.id FROM proposals pr
         JOIN problems p ON p.id = pr.problem_id
         WHERE pr.student_id = ? AND pr.status = 'accepted'`
      )
      .all(user.id);
  }
  for (const { id } of problemIds) ensureProjectConversations(id);
}

function isMember(convId, userId) {
  return !!db
    .prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
    .get(convId, userId);
}

function requireMember(req, res, next) {
  if (!isMember(req.params.id, req.user.id)) {
    return res.status(403).json({ error: "you are not a member of this conversation" });
  }
  next();
}

function serializeMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    body: row.body || "",
    attachment: row.attachment_url
      ? { url: row.attachment_url, type: row.attachment_type, name: row.attachment_name }
      : null,
    createdAt: row.created_at,
    sender: { id: row.sender_id, name: row.sender_name, role: row.sender_role },
  };
}

function members(convId) {
  return db
    .prepare(
      `SELECT u.id, u.full_name AS name, u.role
       FROM conversation_members m JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ?`
    )
    .all(convId);
}

function lastMessage(convId) {
  const row = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1")
    .get(convId);
  if (!row) return null;
  const preview = row.body ? row.body : row.attachment_type === "image" ? "[image] Photo" : "[file] File";
  return { preview, at: row.created_at, senderId: row.sender_id };
}

function serializeConversation(conv, currentUserId) {
  const mem = members(conv.id);
  const problem = conv.problem_id
    ? db.prepare("SELECT title FROM problems WHERE id = ?").get(conv.problem_id)
    : null;

  let title, tag, subtitle;
  if (conv.type === "project_all") {
    title = problem?.title || "Project";
    tag = "Project";
    subtitle = "Company + team";
  } else if (conv.type === "project_students") {
    title = problem?.title || "Team";
    tag = "Team";
    subtitle = "Students only";
  } else {
    const other = mem.find((m) => m.id !== currentUserId);
    title = other?.name || "Direct message";
    tag = "DM";
    subtitle = other?.role === "student" ? "Student" : "";
  }

  return {
    id: conv.id,
    type: conv.type,
    problemId: conv.problem_id,
    title,
    tag,
    subtitle,
    members: mem,
    lastMessage: lastMessage(conv.id),
  };
}

// -------------------------------------------------------------------
// GET /api/chat/conversations — the user's conversations (most recent first)
// -------------------------------------------------------------------
router.get("/conversations", requireAuth, (req, res) => {
  ensureForUser(req.user);

  const rows = db
    .prepare(
      `SELECT c.* FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = ?`
    )
    .all(req.user.id);

  const list = rows.map((c) => serializeConversation(c, req.user.id));
  list.sort((a, b) => {
    const at = a.lastMessage?.at || "";
    const bt = b.lastMessage?.at || "";
    return bt.localeCompare(at);
  });

  res.json({ conversations: list });
});

// -------------------------------------------------------------------
// GET /api/chat/contacts — students you share a team channel with (DM targets)
// -------------------------------------------------------------------
router.get("/contacts", requireAuth, requireRole("student"), (req, res) => {
  ensureForUser(req.user);
  const rows = db
    .prepare(
      `SELECT DISTINCT u.id, u.full_name AS name, u.school, u.major
       FROM conversation_members m1
       JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id
       JOIN conversations c ON c.id = m1.conversation_id
       JOIN users u ON u.id = m2.user_id
       WHERE c.type = 'project_students' AND m1.user_id = ? AND m2.user_id != ?`
    )
    .all(req.user.id, req.user.id);
  res.json({ contacts: rows });
});

// -------------------------------------------------------------------
// POST /api/chat/dm { userId } — find or create a 1-1 DM with another student
// -------------------------------------------------------------------
router.post("/dm", requireAuth, requireRole("student"), (req, res) => {
  const targetId = Number(req.body.userId);
  if (!targetId) return res.status(400).json({ error: "userId is required" });

  const target = db.prepare("SELECT id, role FROM users WHERE id = ?").get(targetId);
  if (!target || target.role !== "student") {
    return res.status(400).json({ error: "you can only DM other students" });
  }

  const existing = db
    .prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.type = 'dm' LIMIT 1`
    )
    .get(req.user.id, targetId);

  let convId;
  if (existing) {
    convId = existing.id;
  } else {
    convId = db.prepare("INSERT INTO conversations (type) VALUES ('dm')").run().lastInsertRowid;
    addMembers(convId, [req.user.id, targetId]);
  }

  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId);
  res.json({ conversation: serializeConversation(conv, req.user.id) });
});

// -------------------------------------------------------------------
// GET /api/chat/conversations/:id/messages — full thread (member only)
// -------------------------------------------------------------------
router.get("/conversations/:id/messages", requireAuth, requireMember, (req, res) => {
  const rows = db
    .prepare(
      `SELECT msg.*, u.full_name AS sender_name, u.role AS sender_role
       FROM messages msg JOIN users u ON u.id = msg.sender_id
       WHERE msg.conversation_id = ?
       ORDER BY msg.id ASC`
    )
    .all(req.params.id);
  res.json({ messages: rows.map(serializeMessage) });
});

// -------------------------------------------------------------------
// POST /api/chat/conversations/:id/messages — send text and/or one attachment
// (multipart/form-data: field `body` and optional file `file`)
// -------------------------------------------------------------------
router.post("/conversations/:id/messages", requireAuth, requireMember, upload.single("file"), (req, res) => {
  const body = (req.body.body || "").trim();
  const file = req.file;

  if (!body && !file) {
    return res.status(400).json({ error: "message needs text or a file" });
  }

  let attUrl = null, attType = null, attName = null;
  if (file) {
    attUrl = `/uploads/${file.filename}`;
    attType = (file.mimetype || "").startsWith("image/") ? "image" : "file";
    attName = file.originalname;
  }

  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, sender_id, body, attachment_url, attachment_type, attachment_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, req.user.id, body || null, attUrl, attType, attName);

  const row = db
    .prepare(
      `SELECT msg.*, u.full_name AS sender_name, u.role AS sender_role
       FROM messages msg JOIN users u ON u.id = msg.sender_id WHERE msg.id = ?`
    )
    .get(info.lastInsertRowid);

  res.status(201).json({ message: serializeMessage(row) });
});

// -------------------------------------------------------------------
// POST /api/chat/translate  { messageId, target } — translate one chat message
// with Azure AI Translator. `target` is the reader's site language ("en"/"ja").
// A message already in that language is translated into the other one instead
// (English <-> Japanese), so the button always gives something useful.
// Only members of the message's conversation may translate it, and each
// message is translated once per language (saved in message_translations).
// Responds { text, to, cached }.
// -------------------------------------------------------------------
const OTHER_LANG = { en: "ja", ja: "en" };

router.post("/translate", requireAuth, async (req, res) => {
  const messageId = Number(req.body.messageId);
  const wanted = req.body.target === "ja" || req.body.target === "Japanese" ? "ja" : "en";
  if (!messageId) return res.status(400).json({ error: "messageId is required" });

  const msg = db.prepare("SELECT id, conversation_id, body FROM messages WHERE id = ?").get(messageId);
  if (!msg || !isMember(msg.conversation_id, req.user.id)) {
    return res.status(404).json({ error: "message not found" });
  }
  const text = (msg.body || "").trim();
  if (!text) return res.status(400).json({ error: "this message has no text to translate" });

  const savedText = (lang) =>
    db.prepare("SELECT text FROM message_translations WHERE message_id = ? AND target_lang = ?").get(msg.id, lang)
      ?.text;

  let to = guessLanguage(text) === wanted ? OTHER_LANG[wanted] : wanted;
  let saved = savedText(to);
  if (saved !== undefined) return res.json({ text: saved, to, cached: true });

  if (text.length > MAX_CHARS) {
    return res.status(400).json({ error: `This message is too long to translate (over ${MAX_CHARS} characters).` });
  }

  try {
    let result = await translateChatText(text, to);
    // The guess was wrong: Azure says the message is already in `to`. Use the other language.
    if (!result.test && result.from === to) {
      to = OTHER_LANG[to];
      saved = savedText(to);
      if (saved !== undefined) return res.json({ text: saved, to, cached: true });
      result = await translateChatText(text, to);
    }
    // Test-mode output isn't saved, so real translations appear once a key is added.
    if (!result.test) {
      db.prepare(
        `INSERT OR REPLACE INTO message_translations (message_id, target_lang, text, source_lang)
         VALUES (?, ?, ?, ?)`
      ).run(msg.id, to, result.text, result.from);
    }
    res.json({ text: result.text, to, cached: false });
  } catch (err) {
    if (err instanceof ChatTranslateError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

export default router;
