// The one place the frontend talks to the backend. Base URL comes from VITE_API_URL
// (see Frontend/.env.example). Adds the Bearer token, unwraps the backend's
// { success, data, error } envelope, throws an Error with a readable message, and on 401
// (an expired or invalid session) clears the session and sends the user to /login.
// The token lives in localStorage under "inspid-token"; nothing secret is kept in code.

const BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1").replace(/\/$/, "");

export const TOKEN_KEY = "inspid-token";

export function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage unavailable: the session only lasts until reload.
  }
}

export function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

// RoleContext registers a handler so a 401 clears the signed-in user without a full page reload.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = "ERROR", details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readableMessage(error, status) {
  if (!error) return `Request failed (${status}).`;
  const first = Array.isArray(error.details) && error.details[0];
  const detail = first ? ` (${[first.path, first.message].filter(Boolean).join(": ")})` : "";
  return `${error.message || `Request failed (${status}).`}${detail}`;
}

/**
 * api("/projects/SYS-RET/signals", { method: "POST", body: {...} }) -> the unwrapped `data`.
 * options.auth === false skips the session-expiry handling (used by the login call itself, where a 401
 * just means "wrong password").
 */
export async function api(path, { method = "GET", body, auth = true, signal } = {}) {
  const headers = { Accept: "application/json" };
  // FormData (a file upload) is sent as is: the browser sets the multipart Content-Type with its boundary.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token && auth) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError(`Cannot reach the server at ${BASE_URL}. Is the backend running?`, { code: "NETWORK" });
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    // Not JSON (for example a proxy error page): fall through to the generic message.
  }

  if (res.status === 401 && auth) {
    clearToken();
    if (unauthorizedHandler) unauthorizedHandler();
    else if (window.location.pathname !== "/login") window.location.assign("/login");
  }

  if (!res.ok || json?.success === false) {
    throw new ApiError(readableMessage(json?.error, res.status), {
      status: res.status,
      code: json?.error?.code,
      details: json?.error?.details,
    });
  }
  return json ? json.data : null;
}

// Same call but returns the raw response text (for example a CSV export).
export async function apiText(path, { auth = true } = {}) {
  const headers = {};
  const token = getToken();
  if (token && auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (res.status === 401 && auth) {
    clearToken();
    if (unauthorizedHandler) unauthorizedHandler();
  }
  if (!res.ok) throw new ApiError(`Request failed (${res.status}).`, { status: res.status });
  return res.text();
}
