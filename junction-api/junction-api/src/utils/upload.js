import multer from "multer";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

// Shared file-upload config. Files land in the project's /uploads folder, which
// server.js serves statically at /uploads. 10 MB cap per file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

export const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
