import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../db/init.js";
import { generateToken, VERIFICATION_TOKEN_TTL_MS } from "../utils/token.js";
import { sendVerificationEmail } from "../utils/email.js";
import { ensureDemoUser, ensureDemoData } from "../db/demo.js";

const router = Router();
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";

// Set REQUIRE_EMAIL_VERIFICATION=false for a closed test where testers can't
// receive emails yet (Resend's test sender only delivers to your own address).
// New accounts are then verified straight away. The default is to require it.
function emailVerificationRequired() {
  return String(process.env.REQUIRE_EMAIL_VERIFICATION ?? "true").toLowerCase() !== "false";
}

// Builds the signed-in payload returned by /login and /demo-login.
function issueSession(user) {
  const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    },
  };
}

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  const { email, password, fullName, role, companyName, jobTitle, school, major } = req.body;

  if (!email || !password || !fullName || !role) {
    return res.status(400).json({ error: "email, password, fullName, and role are required" });
  }
  if (!["company", "student"].includes(role)) {
    return res.status(400).json({ error: "role must be 'company' or 'student'" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(409).json({ error: "an account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const needsVerification = emailVerificationRequired();
  const verificationToken = needsVerification ? generateToken() : null;
  const verificationExpires = needsVerification ? Date.now() + VERIFICATION_TOKEN_TTL_MS : null;

  const insert = db.prepare(`
    INSERT INTO users (
      email, password_hash, role, full_name,
      company_name, job_title, school, major,
      email_verified, verification_token, verification_token_expires
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    email,
    passwordHash,
    role,
    fullName,
    companyName || null,
    jobTitle || null,
    school || null,
    major || null,
    needsVerification ? 0 : 1,
    verificationToken,
    verificationExpires
  );

  if (!needsVerification) {
    return res.status(201).json({
      id: result.lastInsertRowid,
      verified: true,
      message: "Account created. You can log in now.",
    });
  }

  try {
    await sendVerificationEmail({ to: email, fullName, token: verificationToken });
  } catch (err) {
    // The account is created either way — don't lose the signup over a flaky email send.
    // The user can request another verification email via /resend-verification.
    console.error("[auth] failed to send verification email:", err.message);
    return res.status(201).json({
      id: result.lastInsertRowid,
      message: "Account created, but the verification email failed to send. Please try resending it.",
    });
  }

  res.status(201).json({
    id: result.lastInsertRowid,
    message: "Account created. Check your email to verify your address.",
  });
});

// GET /api/auth/verify?token=xxxx
router.get("/verify", (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: "token is required" });
  }

  const user = db.prepare("SELECT id, verification_token_expires FROM users WHERE verification_token = ?").get(token);

  if (!user) {
    return res.status(400).json({ error: "invalid or already-used verification link" });
  }
  if (user.verification_token_expires < Date.now()) {
    return res.status(400).json({ error: "this verification link has expired, please request a new one" });
  }

  db.prepare(`
    UPDATE users
    SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL
    WHERE id = ?
  `).run(user.id);

  res.json({ message: "email verified successfully" });
});

// POST /api/auth/resend-verification  { email }
router.post("/resend-verification", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const user = db.prepare("SELECT id, full_name, email_verified FROM users WHERE email = ?").get(email);

  // Same response whether or not the account exists — avoids leaking which emails are registered.
  const genericResponse = { message: "if an account exists for this email, a verification link has been sent" };

  if (!user || user.email_verified) {
    return res.json(genericResponse);
  }

  const verificationToken = generateToken();
  const verificationExpires = Date.now() + VERIFICATION_TOKEN_TTL_MS;

  db.prepare(`
    UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?
  `).run(verificationToken, verificationExpires, user.id);

  try {
    await sendVerificationEmail({ to: email, fullName: user.full_name, token: verificationToken });
  } catch (err) {
    // A flaky/unconfigured email provider shouldn't turn "resend" into a 500.
    // The new token is already saved; the user can try again (or use the link
    // logged to the server console in dev).
    console.error("[auth] failed to resend verification email:", err.message);
  }

  res.json(genericResponse);
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) {
    return res.status(401).json({ error: "invalid email or password" });
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: "invalid email or password" });
  }

  if (!user.email_verified) {
    return res.status(403).json({ error: "please verify your email before logging in" });
  }

  res.json(issueSession(user));
});

// POST /api/auth/demo-login  { role }
// Logs into a pre-verified demo account so anyone can inspect both the company
// and student sides without registering. Seeds sample content on first use.
router.post("/demo-login", (req, res) => {
  const { role } = req.body;
  if (!["company", "student"].includes(role)) {
    return res.status(400).json({ error: "role must be 'company' or 'student'" });
  }

  const user = ensureDemoUser(role);
  ensureDemoData();

  res.json(issueSession(user));
});

export default router;
