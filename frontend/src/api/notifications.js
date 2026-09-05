import { api } from "./client";

export const getNotifications = async (limit = 50) => {
  const res = await api.get(`/notifications?limit=${limit}`);
  return res.data;
};

export const markAllRead = async () => {
  const res = await api.post("/notifications/read-all");
  return res.data;
};

export const markOneRead = async (id) => {
  const res = await api.post(`/notifications/${id}/read`);
  return res.data;
};

export const deleteNotification = async (id) => {
  const res = await api.delete(`/notifications/${id}`);
  return res.data;
};

export const deleteAllNotifications = async () => {
  const res = await api.delete("/notifications");
  return res.data;
};
