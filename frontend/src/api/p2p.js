import { api } from "./client";

export async function lookupUser(identifier) {
  const { data } = await api.get("/p2p/lookup", { params: { identifier } });
  return data;
}

export async function p2pTransfer(payload, idempotencyKey) {
  const { data } = await api.post("/p2p/transfer", payload, {
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
  return data;
}

export async function getP2pFeePreview(amountFcfa) {
  const { data } = await api.get("/p2p/fee-preview", { params: { amount: amountFcfa } });
  return data;
}

