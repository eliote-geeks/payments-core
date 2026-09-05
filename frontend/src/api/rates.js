import { api } from "./client";

export async function getRates() {
  const { data } = await api.get("/rates");
  return data.items || [];
}

