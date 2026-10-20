import { Router } from "express";
import { db } from "../db/init.js";
import { requireAuth } from "../utils/authMiddleware.js";

const router = Router();

// Shapes a user row into the profile the client shows/edits. Never leaks the
// password hash or verification token.
function serializeProfile(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    companyName: row.company_name || "",
    jobTitle: row.job_title || "",
    school: row.school || "",
    major: row.major || "",
    emailVerified: !!row.email_verified,
    createdAt: row.created_at,
  };
}

// GET /api/me — the signed-in user's full profile.
router.get("/", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "user not found" });
  res.json({ profile: serializeProfile(row) });
});

// PATCH /api/me — update editable profile fields (role-specific ones ignored
// for the other role). Email and role are fixed.
router.patch("/", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "user not found" });

  const { fullName, companyName, jobTitle, school, major } = req.body;

  const nextFullName = typeof fullName === "string" && fullName.trim() ? fullName.trim() : row.full_name;

  // Only accept the fields that belong to this account's role.
  const isCompany = row.role === "company";
  const nextCompanyName = isCompany
    ? (companyName ?? row.company_name) || null
    : row.company_name;
  const nextJobTitle = isCompany ? (jobTitle ?? row.job_title) || null : row.job_title;
  const nextSchool = !isCompany ? (school ?? row.school) || null : row.school;
  const nextMajor = !isCompany ? (major ?? row.major) || null : row.major;

  db.prepare(
    `UPDATE users
     SET full_name = ?, company_name = ?, job_title = ?, school = ?, major = ?
     WHERE id = ?`
  ).run(nextFullName, nextCompanyName, nextJobTitle, nextSchool, nextMajor, row.id);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(row.id);
  res.json({ profile: serializeProfile(updated) });
});

export default router;
