// Canonical keyword catalogue + normaliser.
//
// Problem tags are free text, so the same idea shows up written many ways
// ("code", "Coding", "programming"). We fold every incoming tag down to a
// single canonical form so filtering/searching stays consistent and the UI
// can offer a stable set of suggestions.

// The stable set companies pick from and students filter by.
export const CANONICAL_KEYWORDS = [
  "web",
  "mobile",
  "frontend",
  "backend",
  "fullstack",
  "ui-ux",
  "design",
  "data",
  "data-science",
  "machine-learning",
  "nlp",
  "ai",
  "computer-vision",
  "devops",
  "cloud",
  "security",
  "api",
  "database",
  "automation",
  "programming",
  "game",
  "ar-vr",
  "iot",
  "blockchain",
  "fintech",
  "healthtech",
  "edtech",
  "ecommerce",
  "marketing",
  "analytics",
];

// Common alternate spellings → canonical keyword. Keys are already in the
// normalised shape produced by the cleaning step below (lowercase, hyphenated),
// so e.g. "UI/UX" arrives here as "ui-ux" and "React.js" as "react-js".
const SYNONYMS = {
  // programming family
  code: "programming",
  coding: "programming",
  coder: "programming",
  dev: "programming",
  developer: "programming",
  development: "programming",
  software: "programming",
  "software-development": "programming",
  "software-engineering": "programming",
  program: "programming",

  // web / frontend / backend
  website: "web",
  webdev: "web",
  "web-development": "web",
  "front-end": "frontend",
  front: "frontend",
  react: "frontend",
  "react-js": "frontend",
  vue: "frontend",
  "back-end": "backend",
  server: "backend",
  "server-side": "backend",
  node: "backend",
  "node-js": "backend",
  "full-stack": "fullstack",

  // design
  ux: "ui-ux",
  ui: "ui-ux",
  "user-experience": "ui-ux",
  "user-interface": "ui-ux",
  "ui-design": "ui-ux",
  figma: "design",
  graphic: "design",
  "graphic-design": "design",

  // data / ai
  ml: "machine-learning",
  "machine-learn": "machine-learning",
  "ai-ml": "machine-learning",
  "deep-learning": "machine-learning",
  dl: "machine-learning",
  "artificial-intelligence": "ai",
  "gen-ai": "ai",
  genai: "ai",
  llm: "nlp",
  "natural-language-processing": "nlp",
  cv: "computer-vision",
  "data-analysis": "data",
  "data-analytics": "analytics",
  "big-data": "data",
  datascience: "data-science",

  // infra
  "dev-ops": "devops",
  infra: "devops",
  infrastructure: "devops",
  aws: "cloud",
  gcp: "cloud",
  azure: "cloud",
  cybersecurity: "security",
  infosec: "security",
  db: "database",
  sql: "database",

  // domains
  "e-commerce": "ecommerce",
  "e-com": "ecommerce",
  shop: "ecommerce",
  games: "game",
  gaming: "game",
  gamedev: "game",
  vr: "ar-vr",
  ar: "ar-vr",
  "internet-of-things": "iot",
  crypto: "blockchain",
  web3: "blockchain",
  "financial-technology": "fintech",
  finance: "fintech",
  "health-tech": "healthtech",
  healthcare: "healthtech",
  "education-technology": "edtech",
  education: "edtech",
};

// Words that end in "s" but are NOT plurals — don't strip the trailing "s".
const NO_DEPLURAL = new Set([
  "devops",
  "ios",
  "css",
  "js",
  "ux",
  "aws",
  "analytics",
  "cors",
  "https",
  "saas",
  "paas",
]);

// Clean one raw tag into the normalised shape used everywhere.
export function normalizeKeyword(raw) {
  if (raw == null) return "";

  let k = String(raw)
    .toLowerCase()
    .trim()
    // separators (slash, backslash, ampersand, plus, dot, underscore, spaces) → hyphen
    .replace(/[\/\\&+._\s]+/g, "-")
    // drop anything that isn't a-z, 0-9 or hyphen
    .replace(/[^a-z0-9-]/g, "")
    // collapse repeated hyphens and trim them off the ends
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!k) return "";

  // Direct synonym hit (e.g. "coding" → "programming").
  if (SYNONYMS[k]) return SYNONYMS[k];

  // Naive singularisation, then re-check synonyms (e.g. "games" → "game").
  if (k.length > 3 && k.endsWith("s") && !k.endsWith("ss") && !NO_DEPLURAL.has(k)) {
    const singular = k.endsWith("ies") ? k.slice(0, -3) + "y" : k.slice(0, -1);
    if (SYNONYMS[singular]) return SYNONYMS[singular];
    k = singular;
  }

  return SYNONYMS[k] || k;
}

// Normalise a whole list (array or comma-separated string) → deduped array,
// original order preserved.
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
