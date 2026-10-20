import { getToken, clearSession } from "./auth";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Thin fetch wrapper that attaches the JWT and unwraps JSON / errors.
// `path` is relative to the API's /api root, e.g. apiFetch("/problems").
export async function apiFetch(path, { method = "GET", body } = {}) {
  const token = getToken();

  // FormData (file uploads) must NOT be JSON-encoded — let the browser set the
  // multipart Content-Type (with boundary) itself.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    method,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // A dead/expired session — drop it so the UI can bounce to /login.
    if (res.status === 401) clearSession();
    throw new Error(data.error || "Something went wrong. Please try again.");
  }

  return data;
}

export { API_BASE_URL };
