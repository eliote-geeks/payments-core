import { api } from "./client";

export async function getMe() {
  const { data } = await api.get("/me");
  return data;
}

export async function patchMe(patch) {
  const { data } = await api.patch("/me", patch);
  return data;
}

export async function uploadAvatar(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/me/avatar", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function setPin({ current_pin, new_pin }) {
  const { data } = await api.post("/me/pin", { current_pin, new_pin });
  return data;
}

export async function verifyPin(pin) {
  const { data } = await api.post("/me/pin/verify", { pin });
  return data;
}

export async function startPinReset() {
  const { data } = await api.post("/me/pin/reset/start");
  return data; // { challenge_id, masked_email, dev_code? }
}

export async function confirmPinReset({ challenge_id, code, new_pin }) {
  const { data } = await api.post("/me/pin/reset/confirm", { challenge_id, code, new_pin });
  return data;
}

export async function getSessions() {
  const { data } = await api.get("/me/sessions");
  return data.items || [];
}

export async function revokeSession(sessionId) {
  const { data } = await api.delete(`/me/sessions/${sessionId}`);
  return data;
}

export async function getContacts() {
  const { data } = await api.get("/me/contacts");
  return data.items || [];
}

export async function addContact(name, phone) {
  const { data } = await api.post("/me/contacts", { name, phone });
  return data;
}

export async function removeContact(contactId) {
  const { data } = await api.delete(`/me/contacts/${contactId}`);
  return data;
}

export async function checkUsername(username) {
  const { data } = await api.get("/me/username-check", { params: { username } });
  return data; // { available: bool, reason?: string }
}

export async function requestSecurityChallenge() {
  const { data } = await api.post("/me/security-challenge");
  return data; // { challenge_id }
}

export async function verifySecurityChallenge(challenge_id, code) {
  const { data } = await api.post("/me/security-challenge/verify", { challenge_id, code });
  return data; // { ok: true }
}

export async function getRecoveryCodesStatus() {
  const { data } = await api.get("/me/recovery-codes/status");
  return data; // { has_codes: bool, count: number }
}

export async function generateRecoveryCodes() {
  const { data } = await api.post("/me/recovery-codes/generate");
  return data; // { codes: string[], warning: string }
}

export async function recoverWithCode(email, recovery_code) {
  const { data } = await api.post("/auth/recover", { email, recovery_code });
  return data; // { token, user }
}
