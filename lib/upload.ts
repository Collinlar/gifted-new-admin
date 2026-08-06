// File uploads go through fetch rather than the axios client, because axios
// would set a Content-Type that breaks the multipart boundary. That means the
// Authorization header the axios interceptor normally adds has to be attached
// by hand, otherwise the API guard rejects the upload.
export async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const res = await fetch("/api/upload-file", {
    method: "POST",
    body: fd,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  const json = await res.json().catch(() => ({}));

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    throw new Error("Your session has expired. Sign in again.");
  }
  if (!res.ok || json.error) throw new Error(json.error || "Upload failed");

  return json.url as string;
}
