import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";

// Verifies the "Authorization: Bearer <token>" header, decodes the JWT,
// and attaches the payload to req.user ({ id, role, email }).
// Responds 401 if the header is missing or the token is invalid/expired.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "authentication required" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid or expired session, please log in again" });
  }
}

// Guards a route to a single role. Use after requireAuth, e.g. requireRole("company").
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: `this action is only available to ${role} accounts` });
    }
    next();
  };
}
