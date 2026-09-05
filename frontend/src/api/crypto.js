import { api } from "./client";

export async function getAvailableWallets() {
  const { data } = await api.get("/crypto/wallets");
  return data.items || [];
}

export async function initCryptoDeposit(amount_xaf, network = "TRC20", note = "") {
  const { data } = await api.post("/crypto/deposit/init", { amount_xaf, network, note });
  return data;
}

export async function submitTxHash(deposit_id, tx_hash) {
  const { data } = await api.post(`/crypto/deposit/${deposit_id}/hash`, { tx_hash });
  return data;
}

export async function getCryptoDeposit(deposit_id) {
  const { data } = await api.get(`/crypto/deposit/${deposit_id}`);
  return data;
}

export async function listCryptoDeposits() {
  const { data } = await api.get("/crypto/deposits");
  return data.items || [];
}
