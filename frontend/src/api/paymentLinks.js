import { api } from "./client";
import axios from "axios";

const PUBLIC_BASE =
  process.env.REACT_APP_API_BASE_URL ||
  process.env.REACT_APP_API_BASE ||
  "https://pay-api.koboonline.com";

export async function createPaymentLink({ amount, description, max_uses, expires_in_hours }) {
  const { data } = await api.post("/payment-links", { amount, description, max_uses, expires_in_hours });
  return data;
}

export async function listMyLinks() {
  const { data } = await api.get("/payment-links/me");
  return data;
}

export async function editLink(linkId, payload) {
  const { data } = await api.put(`/payment-links/${linkId}`, payload);
  return data;
}

export async function duplicateLink(linkId) {
  const { data } = await api.post(`/payment-links/${linkId}/duplicate`);
  return data;
}

export async function deleteLink(linkId) {
  const { data } = await api.delete(`/payment-links/${linkId}`);
  return data;
}

export async function pauseLink(linkId) {
  const { data } = await api.patch(`/payment-links/${linkId}/pause`);
  return data;
}

export async function getLinkTransactions(linkId) {
  const { data } = await api.get(`/payment-links/${linkId}/transactions`);
  return data;
}

export async function getLinkById(linkId) {
  const { data } = await api.get(`/payment-links/${linkId}`);
  return data;
}

export async function getMyStats() {
  const { data } = await api.get("/payment-links/stats");
  return data;
}

// Appels publics (sans authentification)
export async function getLinkPublic(linkId) {
  const { data } = await axios.get(`${PUBLIC_BASE}/payment-links/${linkId}/public`);
  return data;
}

export async function payLink(linkId, { phone, provider }) {
  const { data } = await axios.post(`${PUBLIC_BASE}/payment-links/${linkId}/pay`, { phone, provider });
  return data;
}

export async function getTxStatus(reference) {
  const { data } = await axios.get(`${PUBLIC_BASE}/payment-links/tx/${reference}/status`);
  return data;
}

export async function getLinkCryptoInfo(linkId) {
  const { data } = await axios.get(`${PUBLIC_BASE}/payment-links/${linkId}/crypto-info`);
  return data;
}

export async function startCryptoPayment(linkId) {
  const { data } = await axios.post(`${PUBLIC_BASE}/payment-links/${linkId}/crypto-start`);
  return data;
}

export async function getCryptoPaymentStatus(linkId, txId) {
  const { data } = await axios.get(`${PUBLIC_BASE}/payment-links/${linkId}/crypto-status/${txId}`);
  return data;
}

export async function startWalletOtp(linkId, identifier) {
  const { data } = await axios.post(`${PUBLIC_BASE}/payment-links/${linkId}/wallet-otp`, { identifier });
  return data;
}

export async function verifyWalletOtp(linkId, { challenge_id, code }) {
  const { data } = await axios.post(`${PUBLIC_BASE}/payment-links/${linkId}/wallet-otp/verify`, { challenge_id, code });
  return data;
}

export async function payWithWallet(linkId, payment_token) {
  const { data } = await axios.post(`${PUBLIC_BASE}/payment-links/${linkId}/pay-wallet`, { payment_token });
  return data;
}

export async function submitCryptoTx(linkId, tx_hash) {
  const { data } = await axios.post(`${PUBLIC_BASE}/payment-links/${linkId}/crypto-submit`, { tx_hash });
  return data;
}
