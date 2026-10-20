import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import "./db/init.js";
import authRoutes from "./routes/auth.js";
import problemRoutes from "./routes/problems.js";
import meRoutes from "./routes/me.js";
import chatRoutes from "./routes/chat.js";
import documentRoutes from "./routes/documents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json());

// Uploaded images/files are served statically from here.
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api", problemRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Only start listening when this file is run directly (`node src/server.js`),
// not when it's imported (e.g. by tests that mount the app on an ephemeral port).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(PORT, () => {
    console.log(`[server] Junction API running on http://localhost:${PORT}`);
  });
}
