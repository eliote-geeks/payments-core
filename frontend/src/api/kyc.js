import { api } from "./client";

export async function getKycStatus() {
  const { data } = await api.get("/kyc/status");
  return data;
}

export async function uploadKycDoc(doc_key, file) {
  if (file) {
    const form = new FormData();
    form.append("doc_key", doc_key);
    form.append("file", file);
    const { data } = await api.post("/kyc/documents/upload-file", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  }
  const { data } = await api.post("/kyc/documents/upload", { doc_key });
  return data;
}

export async function resetKyc() {
  const { data } = await api.post("/kyc/reset");
  return data;
}

export async function submitKyc() {
  const { data } = await api.post("/kyc/submit");
  return data;
}
