import axios from "axios";

const baseURL =
  process.env.REACT_APP_API_BASE_URL ||
  process.env.REACT_APP_API_BASE ||
  "https://pay-api.koboonline.com";

export const api = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const csrf = typeof document !== "undefined"
    ? document.cookie.split("; ").find((part) => part.startsWith("kobo_csrf="))?.split("=").slice(1).join("=")
    : null;
  if (csrf && !["get", "head", "options"].includes(String(config.method || "get").toLowerCase())) {
    config.headers["X-CSRF-Token"] = decodeURIComponent(csrf);
  }
  return config;
});

export function setAuthToken(token) {
  // Web authentication is cookie-based. Kept as a no-op for old callers.
}
