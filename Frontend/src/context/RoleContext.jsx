import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from "../lib/apiClient";
import { initialsFor } from "../lib/utils";

export const ROLES = {
  PM: "pm",
  MEMBER: "member",
};

const RoleContext = createContext(null);

// Backend user { id, email, name, role: "PM" | "TeamMember", jobTitle, projectIds } -> the shape the UI already uses.
function toCurrentUser(u) {
  const role = u.role === "PM" ? ROLES.PM : ROLES.MEMBER;
  return {
    id: u.id,
    name: u.name,
    initials: initialsFor(u.name),
    email: u.email,
    title: u.jobTitle || (role === ROLES.PM ? "Project Manager" : "Team Member"),
    role,
    projectIds: u.projectIds || [],
  };
}

export function RoleProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  // true while a stored token is being checked with GET /auth/me (so the app does not flash the login page)
  const [loading, setLoading] = useState(() => Boolean(getToken()));

  useEffect(() => {
    // A 401 from any call (expired session) signs the user out; RequireAuth then redirects to /login.
    setUnauthorizedHandler(() => setCurrentUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    api("/auth/me")
      .then((u) => {
        if (!cancelled) setCurrentUser(toCurrentUser(u));
      })
      .catch(() => {
        // Invalid or expired token (or the backend is unreachable): start logged out.
        clearToken();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api("/auth/login", { method: "POST", body: { email, password }, auth: false });
    setToken(data.token);
    const user = toCurrentUser(data.user);
    setCurrentUser(user);
    return user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setCurrentUser(null);
  }, []);

  const value = useMemo(
    () => ({
      role: currentUser?.role ?? null,
      currentUser,
      isAuthenticated: currentUser !== null,
      loading,
      login,
      logout,
      ROLES,
    }),
    [currentUser, loading, login, logout]
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within a RoleProvider");
  return ctx;
}
