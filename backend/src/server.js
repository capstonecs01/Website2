import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "./db/init.js";
import authRoutes from "./routes/auth.js";
import problemRoutes from "./routes/problems.js";
import meRoutes from "./routes/me.js";
import chatRoutes from "./routes/chat.js";
import documentRoutes from "./routes/documents.js";
import { UPLOAD_DIR } from "./utils/paths.js";
import { sitePassword } from "./utils/sitePassword.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
const PORT = process.env.PORT || 3001;
// HOST=127.0.0.1 makes the server accept connections from this computer only
// (start-test-site.bat sets it, so the tunnel is the only way in). Unset = all.
const HOST = process.env.HOST || "";

// On Render (or behind the Cloudflare tunnel, TRUST_PROXY=1) the app sits behind a
// proxy that handles HTTPS. Trusting it lets Express see the visitor's real IP
// address and that the page is HTTPS.
if (process.env.RENDER || process.env.TRUST_PROXY) app.set("trust proxy", 1);

// Test-site password (only when SITE_PASSWORD is set; see utils/sitePassword.js).
app.use(sitePassword());

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json());

// Uploaded images/files are served from the uploads folder in DATA_DIR.
app.use("/uploads", express.static(UPLOAD_DIR));

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api", problemRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// The built website (frontend/dist, made by `npm run build` in frontend/).
// On Render this server shows the pages too, so the site and its API share one
// address. On your computer the folder is usually missing and Vite's dev server
// (http://localhost:5173) shows the pages instead, as before.
const FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(__dirname, "..", "..", "frontend", "dist");
const INDEX_HTML = path.join(FRONTEND_DIST, "index.html");
if (fs.existsSync(INDEX_HTML)) {
  app.use(express.static(FRONTEND_DIST, { index: false }));
  // Any other page address (e.g. /documents) is handled by React in the browser.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.sendFile(INDEX_HTML);
  });
}

// Only start listening when this file is run directly (`node src/server.js`),
// not when it's imported (e.g. by tests that mount the app on an ephemeral port).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const ready = () => console.log(`[server] Junction API running on http://${HOST || "localhost"}:${PORT}`);
  if (HOST) app.listen(PORT, HOST, ready);
  else app.listen(PORT, ready);
}
