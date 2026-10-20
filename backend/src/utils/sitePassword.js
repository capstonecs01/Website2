import crypto from "crypto";
import express from "express";

// Keeps the whole site private while it is being tested.
//
// When SITE_PASSWORD is set (on Render), every page, API call and uploaded file
// needs a cookie that is only given out after typing the password on
// /site-login. When SITE_PASSWORD is empty (on your computer) nothing changes.
//
// A cookie is used instead of the browser's built-in password box because the
// site already uses the "Authorization" header for its own logins.

const COOKIE = "junction_site_access";
const COOKIE_DAYS = 30;
const LOGIN_PATH = "/site-login";
const MAX_FAILURES = 10; // per IP address, per 15 minutes
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

function cookieValue(password) {
  // Changing SITE_PASSWORD (or JWT_SECRET) logs everyone out of the test site.
  const secret = process.env.JWT_SECRET || "dev-only-secret-change-me";
  return crypto.createHmac("sha256", secret).update(`site-access:${password}`).digest("hex");
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Only send people back to a page on this site.
function safeNext(value) {
  const next = String(value || "/");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith(LOGIN_PATH) ? next : "/";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Wording in both site languages; the page shows whichever the visitor last
// picked on the site (it is remembered in the browser as "junction_lang").
const TEXT = {
  en: {
    eyebrow: "JUNCTION · PRIVATE TEST",
    title: "Enter the test password",
    lead: "This site is being tested and isn't open to the public yet.",
    label: "Password",
    button: "Continue",
    wrong: "That password isn't right.",
    tooMany: "Too many wrong tries. Wait 15 minutes and try again.",
  },
  ja: {
    eyebrow: "JUNCTION · 非公開テスト",
    title: "テスト用パスワードを入力してください",
    lead: "このサイトはテスト中のため、まだ一般公開していません。",
    label: "パスワード",
    button: "続ける",
    wrong: "パスワードが違います。",
    tooMany: "間違いが多すぎます。15分待ってからもう一度お試しください。",
  },
};

function loginPage({ next, error }) {
  const both = (key) =>
    `<span data-lang="en">${escapeHtml(TEXT.en[key])}</span><span data-lang="ja">${escapeHtml(TEXT.ja[key])}</span>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Junction · test access</title>
<script>
  // Same theme and language the visitor chose on the site (dark / English by default).
  try {
    if (localStorage.getItem("junction_theme") === "light") document.documentElement.setAttribute("data-theme", "light");
    if (localStorage.getItem("junction_lang") === "ja") document.documentElement.setAttribute("lang", "ja");
  } catch (e) {}
</script>
<style>
  :root { --bg: #0E1116; --panel: #151A22; --line: #232A35; --text: #E7E9ED; --muted: #8B94A3;
          --accent: #FFB020; --error: #FF6B6B; color-scheme: dark; }
  :root[data-theme="light"] { --bg: #F6F8FB; --panel: #FFFFFF; --line: #E3E8EF; --text: #1A1F28;
          --muted: #5B6675; --accent: #C77F00; --error: #C62828; color-scheme: light; }
  html:not([lang="ja"]) [data-lang="ja"], html[lang="ja"] [data-lang="en"] { display: none; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
         background: var(--bg); color: var(--text); font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width: 100%; max-width: 360px; }
  .eyebrow { font: 600 12px/1 "IBM Plex Mono", ui-monospace, Menlo, monospace; letter-spacing: .12em; color: var(--accent); margin: 0; }
  h1 { font-size: 24px; margin: 12px 0 8px; }
  p { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
  input { width: 100%; padding: 12px; font-size: 16px; border-radius: 6px; border: 1px solid var(--line);
          background: var(--panel); color: inherit; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { margin-top: 14px; width: 100%; padding: 12px; font-size: 15px; font-weight: 600; border: 0;
           border-radius: 6px; background: var(--accent); color: #0E1116; cursor: pointer; }
  .error { color: var(--error); margin: 12px 0 0; }
</style>
</head>
<body>
<form method="post" action="${LOGIN_PATH}">
  <p class="eyebrow">${both("eyebrow")}</p>
  <h1>${both("title")}</h1>
  <p>${both("lead")}</p>
  <label for="password">${both("label")}</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">${both("button")}</button>
  ${error ? `<p class="error">${both(error)}</p>` : ""}
</form>
</body>
</html>`;
}

export function sitePassword() {
  const password = process.env.SITE_PASSWORD || "";
  if (!password) return (req, res, next) => next();

  const expected = cookieValue(password);
  const failures = new Map(); // ip -> { count, since }
  const router = express.Router();
  const form = express.urlencoded({ extended: false, limit: "10kb" });

  router.get(LOGIN_PATH, (req, res) => {
    res.set("Cache-Control", "no-store").type("html").send(loginPage({ next: safeNext(req.query.next) }));
  });

  router.post(LOGIN_PATH, form, (req, res) => {
    const next = safeNext(req.body?.next);
    const now = Date.now();
    const record = failures.get(req.ip);
    if (record && now - record.since > FAILURE_WINDOW_MS) failures.delete(req.ip);
    const tries = failures.get(req.ip);
    if (tries && tries.count >= MAX_FAILURES) {
      return res.status(429).type("html").send(loginPage({ next, error: "tooMany" }));
    }
    if (!sameText(req.body?.password || "", password)) {
      failures.set(req.ip, { count: (tries?.count || 0) + 1, since: tries?.since || now });
      return res.status(401).type("html").send(loginPage({ next, error: "wrong" }));
    }
    failures.delete(req.ip);
    res.cookie(COOKIE, expected, {
      httpOnly: true,
      secure: req.secure,
      sameSite: "lax",
      maxAge: COOKIE_DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });
    res.redirect(303, next);
  });

  router.use((req, res, next) => {
    // Render checks this to know the server is up; it reveals nothing.
    if (req.path === "/api/health") return next();
    if (sameText(readCookie(req, COOKIE) || "", expected)) return next();

    res.set("X-Robots-Tag", "noindex, nofollow");
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/") || req.method !== "GET") {
      return res.status(401).json({ error: "This test site needs its access password. Reload the page to enter it." });
    }
    res.redirect(302, `${LOGIN_PATH}?next=${encodeURIComponent(req.originalUrl)}`);
  });

  return router;
}
