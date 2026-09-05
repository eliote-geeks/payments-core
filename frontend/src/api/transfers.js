import { api } from "./client";

export async function getCorridors() {
  const { data } = await api.get("/corridors");
  return data.corridors || [];
}

export async function getCryptoWallets() {
  const { data } = await api.get("/crypto-wallets");
  return data.wallets || [];
}

export async function getPaymentInstructions() {
  const { data } = await api.get("/payment-instructions");
  return data;
}

export async function createQuote(payload) {
  const { data } = await api.post("/quotes", payload);
  return data;
}

export async function createTransfer(payload) {
  const { data } = await api.post("/transfers", payload);
  return data;
}

export async function getTransfer(transferId) {
  const { data } = await api.get(`/transfers/${transferId}`);
  return data;
}

export async function cancelTransfer(transferId) {
  const { data } = await api.post(`/transfers/${transferId}/cancel`);
  return data;
}

export async function getMyPendingTransfer() {
  const { data } = await api.get("/transfers/me/pending");
  return data.pending || null;
}
