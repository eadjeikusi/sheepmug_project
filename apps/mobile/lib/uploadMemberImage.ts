import { getRefreshToken, getToken, setRefreshToken, setToken } from "./storage";
import { API_BASE_URL } from "./api";
import { compressLocalImageForUpload } from "./compressLocalImageForUpload";

/**
 * POST multipart /api/upload-image (same as web). Returns public URL string.
 * Compresses locally before upload; server also enforces an ~80KB cap.
 */
export async function uploadMemberImageFromUri(localUri: string): Promise<string> {
  const tryRefresh = async (): Promise<string | null> => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;
    const refreshRes = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const refreshPayload = await refreshRes.json().catch(() => ({}));
    if (!refreshRes.ok || typeof (refreshPayload as { token?: unknown }).token !== "string") {
      return null;
    }
    const nextToken = (refreshPayload as { token: string }).token;
    const nextRefreshToken =
      typeof (refreshPayload as { refresh_token?: unknown }).refresh_token === "string"
        ? (refreshPayload as { refresh_token: string }).refresh_token
        : refreshToken;
    await setToken(nextToken);
    await setRefreshToken(nextRefreshToken);
    return nextToken;
  };

  const uri = await compressLocalImageForUpload(localUri);

  let token = await getToken();
  const form = new FormData();
  form.append("image", {
    uri,
    name: "profile.jpg",
    type: "image/jpeg",
  } as unknown as Blob);

  const upload = (accessToken: string | null) =>
    fetch(`${API_BASE_URL}/api/upload-image`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });

  let res = await upload(token);
  if (res.status === 401) {
    token = await tryRefresh();
    if (token) {
      res = await upload(token);
    }
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  const url = (payload as { url?: unknown }).url;
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Invalid upload response");
  }
  return url.trim();
}
