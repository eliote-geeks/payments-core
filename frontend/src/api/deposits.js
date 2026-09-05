import { api } from "./client";

export async function initMobileMoney({ amount, currency }) {
  const { data } = await api.post("/deposits/mobile-money/init", { amount, currency });
  return data;
}

export async function initBankTransfer({ amount, currency }) {
  const { data } = await api.post("/deposits/bank/init", { amount, currency });
  return data;
}

export async function getDepositStatus(depositId) {
  const { data } = await api.get(`/deposits/${depositId}/status`);
  return data;
}
