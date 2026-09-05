import { api } from "./client";

export async function getSupportChat() {
  const { data } = await api.get("/support/chat");
  return data.items || [];
}

export async function sendSupportChat(text) {
  const { data } = await api.post("/support/chat", { text });
  return data;
}

export async function getTickets() {
  const { data } = await api.get("/support/tickets");
  return data.items || [];
}

export async function createTicket(subject, message) {
  const { data } = await api.post("/support/tickets", { subject, message });
  return data.ticket;
}

export async function getFaq() {
  const { data } = await api.get("/support/faq");
  return data.items || [];
}

