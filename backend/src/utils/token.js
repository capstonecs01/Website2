import crypto from "crypto";

// Random, URL-safe token used both for email verification links.
export function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Verification links expire after this long — long enough to check email,
// short enough that a leaked/old link isn't a standing risk.
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
