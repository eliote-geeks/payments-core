import { api } from "./client";

export async function getWallets() {
  const { data } = await api.get("/wallets");
  return data.items || [];
}

export async function getTransactions(limit = 50) {
  const { data } = await api.get("/transactions", { params: { limit } });
  return data.items || [];
}

export async function createTransfer(payload, idempotencyKey) {
  const { data } = await api.post("/transfer", payload, {
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
  return data;
}

export async function createWithdraw(payload, idempotencyKey) {
  const { data } = await api.post("/withdraw", payload, {
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
  return data;
}

