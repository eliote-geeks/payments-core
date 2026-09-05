import { api } from "./client";

export async function quoteMobileMoneyTransfer(payload) {
  const { data } = await api.post("/mobile-money-transfers/quote", payload);
  return data;
}

export async function initMobileMoneyTransfer(payload) {
  const { data } = await api.post("/mobile-money-transfers/init", payload);
  return data;
}

export async function getMobileMoneyTransfer(id) {
  const { data } = await api.get(`/mobile-money-transfers/${id}`);
  return data;
}
