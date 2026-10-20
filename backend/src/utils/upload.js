import multer from "multer";
import path from "path";
import crypto from "crypto";
import { UPLOAD_DIR } from "./paths.js";

// Shared file-upload config. Files land in the uploads folder inside DATA_DIR
// (see paths.js), which server.js serves at /uploads. 10 MB cap per file.
export { UPLOAD_DIR };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

export const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
