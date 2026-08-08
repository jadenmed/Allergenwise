// Shared client for the AllergenWise backend (Next.js API, backend/).
// Local dev: backend runs on :3000, this app on :5173 — CORS + credentialed
// cookies are handled by backend/middleware.ts (ALLOWED_ORIGINS).

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export class ApiError extends Error {
  constructor(message, { status, code, issues } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function request(path, { method = "GET", body, headers } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Is the backend running?", {
      status: 0,
    });
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, {
      status: res.status,
      code: data?.code,
      issues: data?.issues,
    });
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};

// ─── Auth ──────────────────────────────────────────────────────────────────

export function login(email, password) {
  return api.post("/api/auth/login", { email, password });
}

export function signup({ restaurant, admin, plan }) {
  return api.post("/api/auth/signup", { restaurant, admin, plan });
}

export function logout() {
  return api.post("/api/auth/logout");
}

export function getSession() {
  return api.get("/api/auth/session");
}

export function acceptInvite({ token, password, fullName }) {
  return api.post("/api/auth/invite/accept", { token, password, fullName });
}

// ─── Public cert verification ────────────────────────────────────────────

export function verifyCert(certCode) {
  return api.get(`/api/certs/${encodeURIComponent(certCode)}/verify`);
}

// Maps a profile role to its home route in this app.
export function homeRouteForRole(role) {
  if (role === "manager") return "/dashboard";
  if (role === "reviewer") return "/internal";
  if (role === "learner") return "/portal";
  return "/";
}

// ─── Learner course ────────────────────────────────────────────────────────

export function getLearnerHome() {
  return api.get("/api/learner/home-data");
}

export function getLesson(lessonId) {
  return api.get(`/api/lesson/${encodeURIComponent(lessonId)}`);
}

export function completeLesson(lessonId) {
  return api.post(`/api/lesson/${encodeURIComponent(lessonId)}/complete`);
}

export function getLearnerCertificate() {
  return api.get("/api/learner/certificate");
}

export function getLearnerProfile() {
  return api.get("/api/learner/profile");
}

export function updateLearnerProfile(data) {
  return api.patch("/api/learner/profile", data);
}

// ─── Public directory search ────────────────────────────────────────────

export function searchRestaurants({ q, allergens, cuisine, zip, radiusMi } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (cuisine) params.set("cuisine", cuisine);
  if (zip) params.set("zip", zip);
  if (radiusMi) params.set("radiusMi", String(radiusMi));
  for (const allergen of allergens || []) params.append("allergen[]", allergen);
  const qs = params.toString();
  return api.get(`/api/search${qs ? `?${qs}` : ""}`);
}
