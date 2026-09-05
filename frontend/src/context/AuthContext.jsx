import React, { createContext, useContext, useState, useEffect } from "react";
import { api, setAuthToken } from "../api/client";
import { getDeviceFingerprint } from "../api/auth";

const AuthContext = createContext(null);
const USER_KEY = "kobo:user";
const SESSION_ID_KEY = "kobo:session_id";
const SESSION_LOCKED_KEY = "kobo:session_locked";
const LAST_ACTIVE_KEY = "kobo:last_active_at";
const IDLE_LOCK_MS = 20 * 60 * 1000;


function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isJwtExpired(token, skewSeconds = 15) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return Number(payload.exp) * 1000 <= Date.now() + skewSeconds * 1000;
}

function clearStoredAuth() {
  try {
    localStorage.removeItem("kobo:token"); // remove tokens issued by older versions
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    localStorage.removeItem(SESSION_LOCKED_KEY);
    localStorage.removeItem(LAST_ACTIVE_KEY);
  } catch {}
  setAuthToken(null);
}

function authErrorCode(err) {
  const detail = err?.response?.data?.detail;
  if (detail && typeof detail === "object") return detail.code || detail.message || "";
  return String(detail || "");
}

export const AuthProvider = ({ children }) => {
  // Ensure axios has the token header as early as possible to avoid
  // race conditions where protected pages fire API calls before the effect runs.
  const initialToken = (() => {
    if (typeof window === "undefined") return null;
    try {
      localStorage.removeItem("kobo:token");
      return null;
    } catch {
      return null;
    }
  })();
  if (initialToken) setAuthToken(initialToken);

  const [user, setUser] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      // Never trust a cached user without a valid token. This avoids the UI
      // showing prefilled profile data from older sessions.
      const saved = localStorage.getItem(USER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [locked, setLocked] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      if (localStorage.getItem(SESSION_LOCKED_KEY) === "1") return true;
      const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      return last > 0 && Date.now() - last > IDLE_LOCK_MS;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }, [user]);

  const setToken = (token) => {
    // Authentication is now maintained by the HttpOnly kobo_access cookie.
    setAuthToken(null);
  };

  const markActive = () => {
    if (typeof window === "undefined") return;
    try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch {}
  };

  const lock = () => {
    if (typeof window === "undefined") return;
    try { localStorage.setItem(SESSION_LOCKED_KEY, "1"); } catch {}
    setLocked(true);
  };

  const resumeWithPin = async (pin) => {
    const sessionId = localStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      const err = new Error("session_not_recognized");
      err.code = "session_not_recognized";
      throw err;
    }
    const device_fingerprint = await getDeviceFingerprint();
    const res = await api.post("/auth/session/resume", { session_id: sessionId, pin, device_fingerprint });
    if (res.data?.token) setToken(res.data.token);
    if (res.data?.session_id) localStorage.setItem(SESSION_ID_KEY, res.data.session_id);
    if (res.data?.user) setUser(res.data.user);
    return res.data;
  };

  const unlock = async (pin) => {
    try {
      await api.post("/me/pin/verify", { pin });
    } catch (err) {
      const status = err?.response?.status;
      const code = authErrorCode(err) || err?.code;
      if (status === 401 || code === "Invalid token" || code === "Missing token" || code === "session_expired") {
        clearStoredAuth();
        setUser(null);
        setLocked(false);
      }
      throw err;
    }
    try {
      localStorage.removeItem(SESSION_LOCKED_KEY);
      localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    } catch {}
    setLocked(false);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    {
      api
        .get("/me")
        .then((res) => setUser(res.data))
        .catch((err) => {
          const status = err?.response?.status;
          const code = authErrorCode(err);
          if (status === 401 || status === 403 || code === "account_blocked" || code === "Session révoquée" || code === "session_not_recognized") {
            clearStoredAuth();
            setUser(null);
            setLocked(false);
            return;
          }
          const saved = localStorage.getItem(USER_KEY);
          if (!saved) {
            clearStoredAuth();
            setUser(null);
            setLocked(false);
            return;
          }
          try { localStorage.setItem(SESSION_LOCKED_KEY, "1"); } catch {}
          setUser(JSON.parse(saved));
          setLocked(true);
        });
    }
  }, []);

  useEffect(() => {
    const id = api.interceptors.response.use(
      (response) => response,
      (err) => {
        const status = err?.response?.status;
        const code = authErrorCode(err);
        if (status === 401 || code === "Invalid token" || code === "Missing token" || code === "Session révoquée") {
          clearStoredAuth();
          setUser(null);
          setLocked(false);
        }
        return Promise.reject(err);
      },
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !user || locked) return undefined;
    markActive();
    const events = ["click", "keydown", "pointerdown", "touchstart"];
    const onActivity = () => markActive();
    events.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));
    const interval = window.setInterval(() => {
      try {
        const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
        if (last > 0 && Date.now() - last > IDLE_LOCK_MS) lock();
      } catch {}
    }, 30000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, onActivity));
      window.clearInterval(interval);
    };
  }, [user, locked]);

  const login = (payload = {}, token = null, sessionId = null) => {
    const u = { ...payload };
    setUser(u);
    setToken(null);
    if (sessionId) {
      try { localStorage.setItem(SESSION_ID_KEY, sessionId); } catch {}
    }
    try {
      localStorage.removeItem(SESSION_LOCKED_KEY);
      localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    } catch {}
    setLocked(false);
    return u;
  };

  const updateUser = (patch) => setUser((u) => (u ? { ...u, ...patch } : u));

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
    setToken(null);
    setLocked(false);
    try {
      localStorage.removeItem(SESSION_ID_KEY);
      localStorage.removeItem(SESSION_LOCKED_KEY);
      localStorage.removeItem(LAST_ACTIVE_KEY);
    } catch {}
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, isAuthed: !!user, setToken, locked, lock, unlock }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
