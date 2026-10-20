import fs from "fs";

// Talks to the translator server (pdf-translator/server.py), which runs next
// to this API on the same computer. Settings in backend/.env:
//   TRANSLATOR_URL     where it listens (default http://127.0.0.1:5000)
//   TRANSLATOR_SECRET  shared password; must equal TRANSLATOR_SECRET in pdf-translator/.env

export class TranslatorError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // HTTP status worth passing on to the browser
  }
}

const NOT_RUNNING = "The translator is not running right now. Please try again later.";
const WRONG_SECRET =
  "The website and the translator have different TRANSLATOR_SECRET values (check both .env files).";

function baseUrl() {
  return (process.env.TRANSLATOR_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
}

async function call(path, { method = "GET", body, timeoutMs = 15000, raw = false, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(baseUrl() + path, {
      method,
      body,
      headers: { "X-Translator-Key": process.env.TRANSLATOR_SECRET || "", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new TranslatorError(NOT_RUNNING, 503);
  }
  if (raw && res.ok) return res;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new TranslatorError(WRONG_SECRET, 503);
    throw new TranslatorError(data.error || `translator error (${res.status})`, res.status);
  }
  return data;
}

// { ok, testMode, maxPages, problem } — never throws.
export async function translatorHealth() {
  let health;
  try {
    health = await call("/api/health", { timeoutMs: 3000 });
  } catch (err) {
    return { ok: false, problem: err.message };
  }
  // /api/health is open; ask for a job that doesn't exist to check the secret too.
  try {
    await call("/api/translations/secret-check", { timeoutMs: 3000 });
  } catch (err) {
    if (err.status !== 404) return { ok: false, problem: err.message };
  }
  return { ok: true, testMode: !!health.test_mode, maxPages: health.max_pages };
}

// Sends a stored PDF to be translated. Resolves to { id, pages, languages }.
// Throws TranslatorError with status 400 when the translator refuses the file
// (too many pages, no readable text, ...): its message is meant for the user.
export async function submitTranslation({ filePath, fileName, source, target, review, instructions }) {
  const form = new FormData();
  const bytes = await fs.promises.readFile(filePath);
  form.append("file", new Blob([bytes], { type: "application/pdf" }), fileName);
  form.append("source", source || "auto");
  form.append("target", target || "auto");
  if (review) form.append("review", "1");
  if (instructions) form.append("instructions", instructions);
  return call("/api/translations", { method: "POST", body: form, timeoutMs: 120000 });
}

// { status: queued|running|done|failed, stage, done, total, languages, warnings, usage, error }
export function getTranslation(jobId) {
  return call(`/api/translations/${encodeURIComponent(jobId)}`);
}

// Plain text translation for chat messages. Resolves to the translated string.
export async function translateText({ text, target }) {
  const data = await call("/api/translate-text", {
    method: "POST",
    body: JSON.stringify({ text, target }),
    headers: { "Content-Type": "application/json" },
    timeoutMs: 20000,
  });
  return data.text;
}

// Saves the finished PDF to destPath.
export async function downloadTranslation(jobId, destPath) {
  const res = await call(`/api/translations/${encodeURIComponent(jobId)}/pdf`, { raw: true, timeoutMs: 120000 });
  await fs.promises.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}
