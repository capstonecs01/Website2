import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "..", "junction.db");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// --- schema ---
// One users table for both roles ("company" / "student").
// Role-specific fields are simply left NULL for the role that doesn't use them —
// fine at this scale; split into separate profile tables later if it grows.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    email                       TEXT NOT NULL UNIQUE,
    password_hash               TEXT NOT NULL,
    role                        TEXT NOT NULL CHECK (role IN ('company', 'student')),
    full_name                   TEXT NOT NULL,

    -- company-only fields
    company_name                TEXT,
    job_title                   TEXT,

    -- student-only fields
    school                      TEXT,
    major                       TEXT,

    email_verified              INTEGER NOT NULL DEFAULT 0,
    verification_token          TEXT,
    verification_token_expires  INTEGER,

    created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Fast lookups for the two things we query by constantly.
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);`);

// --- problems ---
// A "problem" is a real challenge a company posts for student teams to solve.
// company_id references the user (role = 'company') who created it.
db.exec(`
  CREATE TABLE IF NOT EXISTS problems (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    title          TEXT NOT NULL,
    description    TEXT NOT NULL,

    -- comma-separated topic keywords, used to categorise/filter problems
    tags           TEXT,
    -- free-text list of skills a team should ideally have
    skills         TEXT,
    -- suggested team size, e.g. "2-4 people"
    team_size      TEXT,
    -- expected timeframe / deadline, free text e.g. "6 weeks" or "by 2026-10-01"
    timeline       TEXT,
    -- compensation / budget offered, free text e.g. "15,000 THB" or "Unpaid — portfolio"
    compensation   TEXT,

    -- 'open' = accepting proposals, 'closed' = no longer accepting
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),

    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_problems_company ON problems(company_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_problems_status ON problems(status);`);

// --- proposals ---
// A student's response to a problem: how their team would approach it.
// One student may submit at most one proposal per problem (enforced by UNIQUE).
db.exec(`
  CREATE TABLE IF NOT EXISTS proposals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    problem_id     INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    student_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- the team's proposed approach / pitch
    approach       TEXT NOT NULL,
    -- proposed timeline for delivery, free text
    timeline       TEXT,
    -- who's on the team, free text e.g. "Pond (lead), Mind, Beam — CS @ KUAS"
    team_members   TEXT,

    -- 'pending' = awaiting company decision, 'accepted' / 'rejected' set by company
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),

    created_at     TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE (problem_id, student_id)
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_proposals_problem ON proposals(problem_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_proposals_student ON proposals(student_id);`);

console.log(`[db] SQLite ready at ${dbPath}`);

// --- chat ---
// A conversation is one of:
//   'project_all'      company owner + the accepted students on a problem
//   'project_students' only the accepted students on a problem (no company)
//   'dm'               a 1-to-1 between two students
// Membership is stored explicitly in conversation_members and kept in sync
// lazily when a user loads their conversation list.
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL CHECK (type IN ('project_all', 'project_students', 'dm')),
    problem_id  INTEGER REFERENCES problems(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- text body (may be empty when the message is an attachment only)
    body            TEXT,
    -- attachment metadata (all NULL for a plain text message)
    attachment_url  TEXT,
    attachment_type TEXT CHECK (attachment_type IN ('image', 'file') OR attachment_type IS NULL),
    attachment_name TEXT,

    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_problem ON conversations(problem_id);`);

// --- chat message translations (Azure AI Translator) ---
// A chat message is translated at most once per language. Everyone who clicks
// "Translate" on it afterwards gets this saved copy, so Azure only bills once.
db.exec(`
  CREATE TABLE IF NOT EXISTS message_translations (
    message_id   INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    target_lang  TEXT NOT NULL,      -- 'en' or 'ja'
    text         TEXT NOT NULL,
    source_lang  TEXT,               -- the language Azure detected
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, target_lang)
  );
`);
// Drop useless rows where a message was "translated" into the language it was
// already in (saved before same-language messages were switched to the other language).
db.exec(`DELETE FROM message_translations WHERE source_lang = target_lang`);

// --- proposal team members ---
// A proposal's leader is proposals.student_id; the additional teammates they
// bring are listed here as real student accounts. This lets us stop a student
// who's already on someone's proposal from submitting a duplicate for the same
// problem.
db.exec(`
  CREATE TABLE IF NOT EXISTS proposal_members (
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (proposal_id, student_id)
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_proposal_members_student ON proposal_members(student_id);`);

// --- lightweight migrations: add columns to existing tables if missing ---
// SQLite has no "ADD COLUMN IF NOT EXISTS", so we check table_info first.
function addColumnIfMissing(table, column, defn) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defn}`);
  }
}

// A company can attach a proposal template file to a problem.
addColumnIfMissing("problems", "template_url", "TEXT");
addColumnIfMissing("problems", "template_name", "TEXT");

// A student submits their proposal as an uploaded file (e.g. a Word doc).
addColumnIfMissing("proposals", "file_url", "TEXT");
addColumnIfMissing("proposals", "file_name", "TEXT");

// --- documents & translations ---
// A document is a PDF a user uploads to keep on the site. Nothing is
// translated on upload; each time the owner asks for a translation, a row is
// added to `translations` and the PDF is sent to the translator server
// (pdf-translator/server.py). The newest row is the document's current
// translation; all rows together are used for the per-day limit.
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_url    TEXT NOT NULL,     -- /uploads/<stored name>
    file_name   TEXT NOT NULL,     -- the name it was uploaded with
    file_size   INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);`);

db.exec(`
  CREATE TABLE IF NOT EXISTS translations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id        INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    requested_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    translator_job_id  TEXT,

    -- queued -> running -> done | failed
    status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    -- translator stage (reading / analyzing / translating / rendering / reviewing) and its progress
    stage              TEXT,
    progress_done      INTEGER NOT NULL DEFAULT 0,
    progress_total     INTEGER NOT NULL DEFAULT 0,

    source_lang        TEXT,
    target_lang        TEXT,
    review             INTEGER NOT NULL DEFAULT 0,
    pages              INTEGER,

    -- the finished PDF, saved next to the other uploads
    result_url         TEXT,
    result_name        TEXT,
    warnings           TEXT,       -- JSON array of strings
    cost_usd           REAL,       -- translator's estimate
    error              TEXT,

    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at        TEXT
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_translations_document ON translations(document_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_translations_requested_by ON translations(requested_by, created_at);`);
