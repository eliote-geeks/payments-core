import { api } from "./client";

const DEVICE_ID_KEY = "kobo:device_id";

function getOrCreateDeviceId() {
  if (typeof window === "undefined") return "server";
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return "unavailable";
  }
}

async function sha256Hex(value) {
  const cryptoApi = window.crypto?.subtle;
  if (!cryptoApi || !window.TextEncoder) return btoa(value).slice(0, 128);
  const bytes = new TextEncoder().encode(value);
  const hash = await cryptoApi.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getDeviceFingerprint() {
  if (typeof window === "undefined") return "server";
  const parts = [
    getOrCreateDeviceId(),
    navigator.userAgent || "",
    navigator.language || "",
    navigator.platform || "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 0}`,
  ];
  return sha256Hex(parts.join("|"));
}

export async function startOtp(email) {
  const { data } = await api.post("/auth/otp/start", { email });
  return data; // {challenge_id, dev_code?}
}

export async function verifyOtp(challenge_id, code) {
  const { data } = await api.post("/auth/otp/verify", { challenge_id, code });
  return data; // {email, verified:true}
}

export async function register(payload) {
  const device_fingerprint = await getDeviceFingerprint();
  const { data } = await api.post("/auth/register", { ...payload, device_fingerprint });
  return data; // {token, user}
}

export async function loginOrRegisterNeeded(email, challenge_id, verification_token) {
  const device_fingerprint = await getDeviceFingerprint();
  const { data } = await api.post("/auth/login", {
    email,
    challenge_id,
    verification_token,
    device_fingerprint,
  });
  return data; // {needs_register, token?, user?}
}

export async function submitUnblockAppeal(email, message) {
  const { data } = await api.post("/support/appeal", { email, message });
  return data; // {ok, reference}
}
