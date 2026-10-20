// Client-side mirror of the backend keyword normaliser
// (junction-api/src/utils/keywords.js). Kept in sync so the tag picker can
// merge "code"/"Coding"/"programming" into one canonical chip immediately,
// before the value is ever sent. The server normalises again as source of truth.

const SYNONYMS = {
  code: "programming", coding: "programming", coder: "programming", dev: "programming",
  developer: "programming", development: "programming", software: "programming",
  "software-development": "programming", "software-engineering": "programming", program: "programming",

  website: "web", webdev: "web", "web-development": "web",
  "front-end": "frontend", front: "frontend", react: "frontend", "react-js": "frontend", vue: "frontend",
  "back-end": "backend", server: "backend", "server-side": "backend", node: "backend", "node-js": "backend",
  "full-stack": "fullstack",

  ux: "ui-ux", ui: "ui-ux", "user-experience": "ui-ux", "user-interface": "ui-ux", "ui-design": "ui-ux",
  figma: "design", graphic: "design", "graphic-design": "design",

  ml: "machine-learning", "machine-learn": "machine-learning", "ai-ml": "machine-learning",
  "deep-learning": "machine-learning", dl: "machine-learning",
  "artificial-intelligence": "ai", "gen-ai": "ai", genai: "ai",
  llm: "nlp", "natural-language-processing": "nlp", cv: "computer-vision",
  "data-analysis": "data", "data-analytics": "analytics", "big-data": "data", datascience: "data-science",

  "dev-ops": "devops", infra: "devops", infrastructure: "devops",
  aws: "cloud", gcp: "cloud", azure: "cloud",
  cybersecurity: "security", infosec: "security", db: "database", sql: "database",

  "e-commerce": "ecommerce", "e-com": "ecommerce", shop: "ecommerce",
  games: "game", gaming: "game", gamedev: "game", vr: "ar-vr", ar: "ar-vr",
  "internet-of-things": "iot", crypto: "blockchain", web3: "blockchain",
  "financial-technology": "fintech", finance: "fintech",
  "health-tech": "healthtech", healthcare: "healthtech",
  "education-technology": "edtech", education: "edtech",
};

const NO_DEPLURAL = new Set([
  "devops", "ios", "css", "js", "ux", "aws", "analytics", "cors", "https", "saas", "paas",
]);

export function normalizeKeyword(raw) {
  if (raw == null) return "";
  let k = String(raw)
    .toLowerCase()
    .trim()
    .replace(/[\/\\&+._\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!k) return "";
  if (SYNONYMS[k]) return SYNONYMS[k];
  if (k.length > 3 && k.endsWith("s") && !k.endsWith("ss") && !NO_DEPLURAL.has(k)) {
    const singular = k.endsWith("ies") ? k.slice(0, -3) + "y" : k.slice(0, -1);
    if (SYNONYMS[singular]) return SYNONYMS[singular];
    k = singular;
  }
  return SYNONYMS[k] || k;
}

export function normalizeKeywords(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(",");
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = normalizeKeyword(item);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
