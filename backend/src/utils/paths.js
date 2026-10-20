import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Where the site keeps its data: the SQLite database (junction.db) and the
// uploads/ folder.
//
// On your computer DATA_DIR is not set, so both stay in the backend/ folder,
// exactly as before. On Render, DATA_DIR points at the persistent disk
// (/var/data) so accounts and files survive restarts and new deploys.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, "..", "..");

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : BACKEND_DIR;
export const DB_PATH = path.join(DATA_DIR, "junction.db");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
