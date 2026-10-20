import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/init.js";
import { requireAuth, requireRole } from "../utils/authMiddleware.js";
import { CANONICAL_KEYWORDS, normalizeKeywords } from "../utils/keywords.js";
import { ensureProjectConversations } from "./chat.js";
import { upload, UPLOAD_DIR } from "../utils/upload.js";

// Best-effort removal of an uploaded file ("/uploads/<name>") from disk.
function removeUploadedFile(url) {
  if (!url) return;
  fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => {});
}

const router = Router();

// Shapes a raw problem row for the client, optionally with proposal count.
function serializeProblem(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tags: row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    skills: row.skills || "",
    teamSize: row.team_size || "",
    timeline: row.timeline || "",
    compensation: row.compensation || "",
    status: row.status,
    createdAt: row.created_at,
    company: {
      id: row.company_id,
      name: row.company_name || row.full_name,
    },
    // optional proposal template the company attached for students to fill in
    template: row.template_url ? { url: row.template_url, name: row.template_name } : null,
    proposalCount: row.proposal_count ?? undefined,
  };
}

// The real student accounts a proposal's leader added as teammates.
function proposalMembers(proposalId) {
  return db
    .prepare(
      `SELECT u.id, u.full_name AS name, u.school, u.major, u.email
       FROM proposal_members pm JOIN users u ON u.id = pm.student_id
       WHERE pm.proposal_id = ?
       ORDER BY u.full_name`
    )
    .all(proposalId)
    .map((r) => ({ id: r.id, name: r.name, school: r.school || "", major: r.major || "", email: r.email }));
}

// How a student is already tied to a problem, if at all — as a proposal leader
// or as a listed member of someone else's proposal. Used to block duplicates.
function studentEngagement(problemId, studentId) {
  const asLeader = db
    .prepare("SELECT id, status FROM proposals WHERE problem_id = ? AND student_id = ?")
    .get(problemId, studentId);
  if (asLeader) return { as: "leader", proposalId: asLeader.id, status: asLeader.status };

  const asMember = db
    .prepare(
      `SELECT p.id AS proposal_id, lu.full_name AS leader_name
       FROM proposal_members pm
       JOIN proposals p ON p.id = pm.proposal_id
       JOIN users lu ON lu.id = p.student_id
       WHERE p.problem_id = ? AND pm.student_id = ?`
    )
    .get(problemId, studentId);
  if (asMember) return { as: "member", proposalId: asMember.proposal_id, leaderName: asMember.leader_name };

  return null;
}

function serializeProposal(row) {
  return {
    id: row.id,
    problemId: row.problem_id,
    approach: row.approach,
    timeline: row.timeline || "",
    teamMembers: row.team_members || "",
    members: proposalMembers(row.id),
    // the student's uploaded proposal document (e.g. a Word file)
    file: row.file_url ? { url: row.file_url, name: row.file_name } : null,
    status: row.status,
    createdAt: row.created_at,
    student: row.student_id
      ? {
          id: row.student_id,
          name: row.student_name,
          school: row.student_school || "",
          major: row.student_major || "",
          email: row.student_email,
        }
      : undefined,
    // present when a proposal is returned in the context of its problem
    problemTitle: row.problem_title,
  };
}

// -------------------------------------------------------------------
// POST /api/problems  (company only) — create a new problem
// -------------------------------------------------------------------
router.post("/problems", requireAuth, requireRole("company"), upload.single("template"), (req, res) => {
  const { title, description, tags, skills, teamSize, timeline, compensation } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: "title and description are required" });
  }

  // Fold tags down to canonical keywords so "code"/"Coding"/"programming"
  // don't fragment into separate tags. Stored as a comma-separated string.
  const normalizedTags = normalizeKeywords(tags);
  const tagsStr = normalizedTags.length ? normalizedTags.join(", ") : null;

  // Optional proposal template the company attaches for students.
  const templateUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const templateName = req.file ? req.file.originalname : null;

  const insert = db.prepare(`
    INSERT INTO problems (company_id, title, description, tags, skills, team_size, timeline, compensation, template_url, template_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(
    req.user.id,
    title.trim(),
    description.trim(),
    tagsStr,
    skills || null,
    teamSize || null,
    timeline || null,
    compensation || null,
    templateUrl,
    templateName
  );

  const row = db
    .prepare(
      `SELECT p.*, u.company_name, u.full_name
       FROM problems p JOIN users u ON u.id = p.company_id
       WHERE p.id = ?`
    )
    .get(result.lastInsertRowid);

  res.status(201).json({ problem: serializeProblem(row) });
});

// -------------------------------------------------------------------
// GET /api/problems  (any authenticated user) — list open problems
// Optional ?q= search term matches title/description/tags.
// Optional ?tags=a,b keyword filter — normalised, matches ANY of the tags.
// -------------------------------------------------------------------
router.get("/problems", requireAuth, (req, res) => {
  const q = (req.query.q || "").trim();
  const like = `%${q}%`;

  const rows = db
    .prepare(
      `SELECT p.*, u.company_name, u.full_name,
              (SELECT COUNT(*) FROM proposals pr WHERE pr.problem_id = p.id) AS proposal_count
       FROM problems p JOIN users u ON u.id = p.company_id
       WHERE p.status = 'open'
         AND (? = '' OR p.title LIKE ? OR p.description LIKE ? OR IFNULL(p.tags,'') LIKE ?)
       ORDER BY p.created_at DESC`
    )
    .all(q, like, like, like);

  let problems = rows.map(serializeProblem);

  // Keyword filter: normalise the requested tags, keep problems that share at
  // least one canonical tag. Done in JS so it matches the same normalisation.
  const wanted = normalizeKeywords(req.query.tags);
  if (wanted.length) {
    const wantedSet = new Set(wanted);
    problems = problems.filter((p) => p.tags.some((t) => wantedSet.has(t)));
  }

  res.json({ problems });
});

// -------------------------------------------------------------------
// GET /api/keywords  (any authenticated user) — canonical keyword catalogue
// with how many currently-open problems use each. Powers the tag picker
// (company) and the filter chips (student).
// -------------------------------------------------------------------
router.get("/keywords", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT tags FROM problems WHERE status = 'open'").all();

  const counts = new Map();
  for (const row of rows) {
    for (const tag of normalizeKeywords(row.tags)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  // Catalogue first (with counts), then any ad-hoc tags in use that aren't in it.
  const keywords = CANONICAL_KEYWORDS.map((value) => ({ value, count: counts.get(value) || 0 }));
  const known = new Set(CANONICAL_KEYWORDS);
  for (const [value, count] of counts) {
    if (!known.has(value)) keywords.push({ value, count });
  }

  res.json({ keywords });
});

// -------------------------------------------------------------------
// GET /api/problems/mine  (company only) — problems this company posted
// Must be declared before /problems/:id so "mine" isn't read as an id.
// -------------------------------------------------------------------
router.get("/problems/mine", requireAuth, requireRole("company"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, u.company_name, u.full_name,
              (SELECT COUNT(*) FROM proposals pr WHERE pr.problem_id = p.id) AS proposal_count
       FROM problems p JOIN users u ON u.id = p.company_id
       WHERE p.company_id = ?
       ORDER BY p.created_at DESC`
    )
    .all(req.user.id);

  res.json({ problems: rows.map(serializeProblem) });
});

// -------------------------------------------------------------------
// GET /api/proposals/mine  (student only) — proposals this student submitted
// -------------------------------------------------------------------
router.get("/proposals/mine", requireAuth, requireRole("student"), (req, res) => {
  // Proposals this student leads.
  const asLeader = db
    .prepare(
      `SELECT pr.*, p.title AS problem_title
       FROM proposals pr JOIN problems p ON p.id = pr.problem_id
       WHERE pr.student_id = ?
       ORDER BY pr.created_at DESC`
    )
    .all(req.user.id)
    .map((r) => ({ ...serializeProposal(r), role: "lead" }));

  // Proposals this student is a listed teammate on (led by someone else).
  const asMember = db
    .prepare(
      `SELECT pr.*, p.title AS problem_title, lu.full_name AS leader_name
       FROM proposal_members pm
       JOIN proposals pr ON pr.id = pm.proposal_id
       JOIN problems p ON p.id = pr.problem_id
       JOIN users lu ON lu.id = pr.student_id
       WHERE pm.student_id = ?
       ORDER BY pr.created_at DESC`
    )
    .all(req.user.id)
    .map((r) => ({ ...serializeProposal(r), role: "member", leaderName: r.leader_name }));

  res.json({ proposals: [...asLeader, ...asMember] });
});

// -------------------------------------------------------------------
// GET /api/proposals/received  (company only) — every proposal across all of
// this company's problems, for the aggregate Proposals view + dashboard stats.
// -------------------------------------------------------------------
router.get("/proposals/received", requireAuth, requireRole("company"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT pr.*,
              p.title     AS problem_title,
              u.full_name AS student_name,
              u.school    AS student_school,
              u.major     AS student_major,
              u.email     AS student_email
       FROM proposals pr
       JOIN problems p ON p.id = pr.problem_id
       JOIN users u    ON u.id = pr.student_id
       WHERE p.company_id = ?
       ORDER BY pr.created_at DESC`
    )
    .all(req.user.id);

  res.json({ proposals: rows.map(serializeProposal) });
});

// -------------------------------------------------------------------
// GET /api/problems/:id  (any authenticated user) — problem detail
// Includes whether the current student has already proposed.
// -------------------------------------------------------------------
router.get("/problems/:id", requireAuth, (req, res) => {
  const row = db
    .prepare(
      `SELECT p.*, u.company_name, u.full_name,
              (SELECT COUNT(*) FROM proposals pr WHERE pr.problem_id = p.id) AS proposal_count
       FROM problems p JOIN users u ON u.id = p.company_id
       WHERE p.id = ?`
    )
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: "problem not found" });
  }

  const problem = serializeProblem(row);

  // Let a student know how they're tied to this problem:
  //  - myProposal: a proposal they lead
  //  - memberOf:   they're a teammate on someone else's proposal (can't resubmit)
  if (req.user.role === "student") {
    const mine = db
      .prepare("SELECT * FROM proposals WHERE problem_id = ? AND student_id = ?")
      .get(row.id, req.user.id);
    problem.myProposal = mine ? serializeProposal(mine) : null;

    problem.memberOf = null;
    if (!mine) {
      const memberOf = db
        .prepare(
          `SELECT pr.status, lu.full_name AS leader_name
           FROM proposal_members pm
           JOIN proposals pr ON pr.id = pm.proposal_id
           JOIN users lu ON lu.id = pr.student_id
           WHERE pr.problem_id = ? AND pm.student_id = ?`
        )
        .get(row.id, req.user.id);
      if (memberOf) problem.memberOf = { leaderName: memberOf.leader_name, status: memberOf.status };
    }
  }

  res.json({ problem });
});

// -------------------------------------------------------------------
// GET /api/problems/:id/eligible-students  (student only) — students who can
// still be added as teammates on this problem (not already on any proposal).
// -------------------------------------------------------------------
router.get("/problems/:id/eligible-students", requireAuth, requireRole("student"), (req, res) => {
  const problem = db.prepare("SELECT id FROM problems WHERE id = ?").get(req.params.id);
  if (!problem) return res.status(404).json({ error: "problem not found" });

  const students = db
    .prepare(
      `SELECT id, full_name AS name, school, major FROM users
       WHERE role = 'student' AND id != ?
         AND id NOT IN (SELECT student_id FROM proposals WHERE problem_id = ?)
         AND id NOT IN (
           SELECT pm.student_id FROM proposal_members pm
           JOIN proposals p ON p.id = pm.proposal_id WHERE p.problem_id = ?
         )
       ORDER BY full_name`
    )
    .all(req.user.id, problem.id, problem.id);

  res.json({ students });
});

// -------------------------------------------------------------------
// POST /api/problems/:id/proposals  (student only) — submit a proposal
// One proposal per student per problem. The leader may list teammates
// (real student accounts); those teammates are then blocked from submitting
// their own proposal for the same problem, so nothing is submitted twice.
// -------------------------------------------------------------------
router.post("/problems/:id/proposals", requireAuth, requireRole("student"), upload.single("file"), (req, res) => {
  const { approach, timeline } = req.body; // `approach` is now an optional note
  let parsedMembers = [];
  try {
    parsedMembers = JSON.parse(req.body.memberIds || "[]");
  } catch {
    parsedMembers = [];
  }
  const memberIds = Array.isArray(parsedMembers)
    ? [...new Set(parsedMembers.map(Number).filter((n) => Number.isInteger(n)))]
    : [];

  if (!req.file) {
    return res.status(400).json({ error: "please upload your proposal file" });
  }

  const problem = db.prepare("SELECT id, status FROM problems WHERE id = ?").get(req.params.id);
  if (!problem) {
    return res.status(404).json({ error: "problem not found" });
  }
  if (problem.status !== "open") {
    return res.status(409).json({ error: "this problem is no longer accepting proposals" });
  }

  // The leader must not already be tied to this problem.
  const mine = studentEngagement(problem.id, req.user.id);
  if (mine) {
    return res.status(409).json({
      error:
        mine.as === "leader"
          ? "you already have a proposal for this problem — withdraw it first to resubmit"
          : "you're already a teammate on another proposal for this problem",
    });
  }

  // Validate each listed teammate: must be a student who isn't already engaged.
  const cleanMembers = memberIds.filter((id) => id !== req.user.id);
  const memberNames = [];
  for (const mid of cleanMembers) {
    const u = db.prepare("SELECT id, role, full_name FROM users WHERE id = ?").get(mid);
    if (!u || u.role !== "student") {
      return res.status(400).json({ error: "team members must be registered students" });
    }
    if (studentEngagement(problem.id, mid)) {
      return res.status(409).json({ error: `${u.full_name} is already on a proposal for this problem` });
    }
    memberNames.push(u.full_name);
  }

  const leader = db.prepare("SELECT full_name FROM users WHERE id = ?").get(req.user.id);
  const teamText = [`${leader.full_name} (lead)`, ...memberNames].join(", ");

  const create = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO proposals (problem_id, student_id, approach, timeline, team_members, file_url, file_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        problem.id,
        req.user.id,
        (approach || "").trim(),
        timeline || null,
        teamText,
        `/uploads/${req.file.filename}`,
        req.file.originalname
      );
    const pid = result.lastInsertRowid;
    const insMember = db.prepare("INSERT INTO proposal_members (proposal_id, student_id) VALUES (?, ?)");
    for (const mid of cleanMembers) insMember.run(pid, mid);
    return pid;
  });

  const pid = create();
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(pid);
  res.status(201).json({ proposal: serializeProposal(row) });
});

// -------------------------------------------------------------------
// DELETE /api/proposals/:id  (student leader only) — withdraw a proposal,
// freeing the leader and their teammates to submit again. Accepted proposals
// (already a live project) can't be withdrawn.
// -------------------------------------------------------------------
router.delete("/proposals/:id", requireAuth, requireRole("student"), (req, res) => {
  const row = db.prepare("SELECT id, student_id, status FROM proposals WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "proposal not found" });
  if (row.student_id !== req.user.id) {
    return res.status(403).json({ error: "you can only withdraw your own proposal" });
  }
  if (row.status === "accepted") {
    return res.status(409).json({ error: "this proposal was accepted — it can no longer be withdrawn" });
  }

  // Foreign-key cascades aren't enabled, so clear members explicitly.
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM proposal_members WHERE proposal_id = ?").run(row.id);
    db.prepare("DELETE FROM proposals WHERE id = ?").run(row.id);
  });
  remove();

  res.json({ message: "proposal withdrawn" });
});

// -------------------------------------------------------------------
// GET /api/problems/:id/proposals  (company owner only) — view proposals
// -------------------------------------------------------------------
router.get("/problems/:id/proposals", requireAuth, requireRole("company"), (req, res) => {
  const problem = db.prepare("SELECT id, company_id FROM problems WHERE id = ?").get(req.params.id);
  if (!problem) {
    return res.status(404).json({ error: "problem not found" });
  }
  if (problem.company_id !== req.user.id) {
    return res.status(403).json({ error: "you can only view proposals for your own problems" });
  }

  const rows = db
    .prepare(
      `SELECT pr.*,
              u.full_name AS student_name,
              u.school    AS student_school,
              u.major     AS student_major,
              u.email     AS student_email
       FROM proposals pr JOIN users u ON u.id = pr.student_id
       WHERE pr.problem_id = ?
       ORDER BY pr.created_at DESC`
    )
    .all(problem.id);

  res.json({ proposals: rows.map(serializeProposal) });
});

// -------------------------------------------------------------------
// PATCH /api/proposals/:id  (company owner only) — accept/reject a proposal
// -------------------------------------------------------------------
router.patch("/proposals/:id", requireAuth, requireRole("company"), (req, res) => {
  const { status } = req.body;
  if (!["accepted", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ error: "status must be 'accepted', 'rejected', or 'pending'" });
  }

  const row = db
    .prepare(
      `SELECT pr.id, p.company_id
       FROM proposals pr JOIN problems p ON p.id = pr.problem_id
       WHERE pr.id = ?`
    )
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: "proposal not found" });
  }
  if (row.company_id !== req.user.id) {
    return res.status(403).json({ error: "you can only respond to proposals on your own problems" });
  }

  db.prepare("UPDATE proposals SET status = ? WHERE id = ?").run(status, row.id);
  res.json({ message: `proposal marked as ${status}` });
});

// -------------------------------------------------------------------
// PATCH /api/problems/:id  (company owner only) — open/close a problem
// -------------------------------------------------------------------
router.patch("/problems/:id", requireAuth, requireRole("company"), (req, res) => {
  const { status } = req.body;
  if (!["open", "closed"].includes(status)) {
    return res.status(400).json({ error: "status must be 'open' or 'closed'" });
  }

  const problem = db.prepare("SELECT id, company_id FROM problems WHERE id = ?").get(req.params.id);
  if (!problem) {
    return res.status(404).json({ error: "problem not found" });
  }
  if (problem.company_id !== req.user.id) {
    return res.status(403).json({ error: "you can only edit your own problems" });
  }

  db.prepare("UPDATE problems SET status = ? WHERE id = ?").run(status, problem.id);
  res.json({ message: `problem marked as ${status}` });
});

// -------------------------------------------------------------------
// DELETE /api/problems/:id  (company owner only) — remove a problem and
// everything tied to it: proposals (+ members + files), the project chat
// channels (messages + members + attachments) and the template file.
// Foreign-key cascades aren't enabled, so clear related rows explicitly.
// -------------------------------------------------------------------
router.delete("/problems/:id", requireAuth, requireRole("company"), (req, res) => {
  const problem = db.prepare("SELECT * FROM problems WHERE id = ?").get(req.params.id);
  if (!problem) {
    return res.status(404).json({ error: "problem not found" });
  }
  if (problem.company_id !== req.user.id) {
    return res.status(403).json({ error: "you can only delete your own problems" });
  }

  // Collect every uploaded file to delete from disk afterwards.
  const files = [];
  if (problem.template_url) files.push(problem.template_url);
  const proposals = db.prepare("SELECT id, file_url FROM proposals WHERE problem_id = ?").all(problem.id);
  for (const p of proposals) if (p.file_url) files.push(p.file_url);
  const convIds = db
    .prepare("SELECT id FROM conversations WHERE problem_id = ?")
    .all(problem.id)
    .map((c) => c.id);
  for (const cid of convIds) {
    const atts = db
      .prepare("SELECT attachment_url FROM messages WHERE conversation_id = ? AND attachment_url IS NOT NULL")
      .all(cid);
    for (const a of atts) files.push(a.attachment_url);
  }

  db.transaction(() => {
    for (const p of proposals) db.prepare("DELETE FROM proposal_members WHERE proposal_id = ?").run(p.id);
    db.prepare("DELETE FROM proposals WHERE problem_id = ?").run(problem.id);
    for (const cid of convIds) {
      db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(cid);
      db.prepare("DELETE FROM conversation_members WHERE conversation_id = ?").run(cid);
    }
    db.prepare("DELETE FROM conversations WHERE problem_id = ?").run(problem.id);
    db.prepare("DELETE FROM problems WHERE id = ?").run(problem.id);
  })();

  for (const url of files) removeUploadedFile(url);

  res.json({ message: "problem deleted" });
});

// -------------------------------------------------------------------
// GET /api/projects/:id  — full project view: details + the accepted team +
// the chat conversation ids. Visible to the owning company and to any student
// accepted onto the project.
// -------------------------------------------------------------------
router.get("/projects/:id", requireAuth, (req, res) => {
  const row = db
    .prepare(
      `SELECT p.*, u.company_name, u.full_name
       FROM problems p JOIN users u ON u.id = p.company_id
       WHERE p.id = ?`
    )
    .get(req.params.id);

  if (!row) return res.status(404).json({ error: "project not found" });

  const isOwner = req.user.role === "company" && row.company_id === req.user.id;
  const acceptedMe =
    req.user.role === "student" &&
    !!db
      .prepare("SELECT 1 FROM proposals WHERE problem_id = ? AND student_id = ? AND status = 'accepted'")
      .get(row.id, req.user.id);

  if (!isOwner && !acceptedMe) {
    return res.status(403).json({ error: "you don't have access to this project" });
  }

  // Make sure the project channels exist (no-op if there's no team yet).
  ensureProjectConversations(row.id);

  // Team = accepted proposal leaders + the teammates they listed.
  const acceptedProposals = db
    .prepare(
      `SELECT pr.id AS proposal_id, pr.approach, pr.timeline,
              u.id AS student_id, u.full_name AS name, u.school, u.major, u.email
       FROM proposals pr JOIN users u ON u.id = pr.student_id
       WHERE pr.problem_id = ? AND pr.status = 'accepted'
       ORDER BY pr.created_at ASC`
    )
    .all(row.id);

  const team = [];
  const seen = new Set();
  for (const p of acceptedProposals) {
    if (!seen.has(p.student_id)) {
      seen.add(p.student_id);
      team.push({
        id: p.student_id,
        name: p.name,
        school: p.school || "",
        major: p.major || "",
        email: p.email,
        approach: p.approach,
        role: "lead",
      });
    }
    for (const m of proposalMembers(p.proposal_id)) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        team.push({ ...m, approach: "", role: "member" });
      }
    }
  }

  const projectAll = db
    .prepare("SELECT id FROM conversations WHERE type = 'project_all' AND problem_id = ?")
    .get(row.id);
  const projectStudents = db
    .prepare("SELECT id FROM conversations WHERE type = 'project_students' AND problem_id = ?")
    .get(row.id);

  res.json({
    project: serializeProblem(row),
    team,
    isOwner,
    chat: {
      projectConversationId: projectAll ? projectAll.id : null,
      // only students are members of the students-only channel
      teamConversationId: acceptedMe && projectStudents ? projectStudents.id : null,
    },
  });
});

// -------------------------------------------------------------------
// GET /api/students?q=  (student only) — search other students to team up with.
// Matches name / school / major.
// -------------------------------------------------------------------
router.get("/students", requireAuth, requireRole("student"), (req, res) => {
  const q = (req.query.q || "").trim();
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT id, full_name AS name, school, major FROM users
       WHERE role = 'student' AND id != ?
         AND (? = '' OR full_name LIKE ? OR IFNULL(school,'') LIKE ? OR IFNULL(major,'') LIKE ?)
       ORDER BY full_name
       LIMIT 50`
    )
    .all(req.user.id, q, like, like, like);
  res.json({ students: rows });
});

// -------------------------------------------------------------------
// GET /api/users/:id  (any authenticated user) — a public profile.
//   student → the accepted projects they're on (active vs past by problem status)
//   company → the problems they've posted
// -------------------------------------------------------------------
router.get("/users/:id", requireAuth, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "user not found" });

  const profile = {
    id: u.id,
    role: u.role,
    fullName: u.full_name,
    companyName: u.company_name || "",
    jobTitle: u.job_title || "",
    school: u.school || "",
    major: u.major || "",
    joinedAt: u.created_at,
  };

  if (u.role === "student") {
    // Accepted projects, whether they led them or were a listed teammate.
    const asLead = db
      .prepare(
        `SELECT p.id AS problem_id, p.title, p.status, cu.company_name, cu.full_name AS company_full
         FROM proposals pr
         JOIN problems p ON p.id = pr.problem_id
         JOIN users cu ON cu.id = p.company_id
         WHERE pr.student_id = ? AND pr.status = 'accepted'
         ORDER BY pr.created_at DESC`
      )
      .all(u.id)
      .map((r) => ({ problemId: r.problem_id, title: r.title, status: r.status, company: r.company_name || r.company_full, role: "lead" }));

    const asMember = db
      .prepare(
        `SELECT p.id AS problem_id, p.title, p.status, cu.company_name, cu.full_name AS company_full
         FROM proposal_members pm
         JOIN proposals pr ON pr.id = pm.proposal_id
         JOIN problems p ON p.id = pr.problem_id
         JOIN users cu ON cu.id = p.company_id
         WHERE pm.student_id = ? AND pr.status = 'accepted'
         ORDER BY pr.created_at DESC`
      )
      .all(u.id)
      .map((r) => ({ problemId: r.problem_id, title: r.title, status: r.status, company: r.company_name || r.company_full, role: "member" }));

    const seen = new Set();
    const projects = [];
    for (const x of [...asLead, ...asMember]) {
      if (!seen.has(x.problemId)) {
        seen.add(x.problemId);
        projects.push(x);
      }
    }
    return res.json({ profile, projects });
  }

  // company → problems posted
  const problems = db
    .prepare(
      `SELECT p.*, u.company_name, u.full_name,
              (SELECT COUNT(*) FROM proposals pr WHERE pr.problem_id = p.id) AS proposal_count
       FROM problems p JOIN users u ON u.id = p.company_id
       WHERE p.company_id = ?
       ORDER BY p.created_at DESC`
    )
    .all(u.id)
    .map(serializeProblem);

  res.json({ profile, problems });
});

export default router;
