import { api } from "./client";

export async function initFiatWithdrawal(payload) {
  const { data } = await api.post("/fiat-withdrawals/init", payload);
  return data;
}

export async function getFiatWithdrawalFeePreview(params) {
  const { data } = await api.get("/fiat-withdrawals/fee-preview", { params });
  return data;
}

export async function getFiatWithdrawalStatus(withdrawalId) {
  const { data } = await api.get(`/fiat-withdrawals/${withdrawalId}/status`);
  return data;
}
