import * as FileSystem from "expo-file-system/legacy";
import { Alert, Platform, Share } from "react-native";
import { API_BASE_URL } from "./api";
import { getToken, getSelectedBranchId } from "./storage";

/** Extract `event-files/...` path from a Supabase public object URL (legacy attachments). */
export function storagePathFromSupabaseMemberImagesUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const marker = "/storage/v1/object/public/member-images/";
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    return u.pathname.slice(idx + marker.length).replace(/^\/+/, "");
  } catch {
    return null;
  }
}

export function eventAttachmentStoragePath(a: {
  storage_path?: string | null;
  url?: string | null;
}): string | null {
  const p = typeof a.storage_path === "string" ? a.storage_path.trim() : "";
  if (p) return p;
  const u = typeof a.url === "string" ? a.url.trim() : "";
  if (u) return storagePathFromSupabaseMemberImagesUrl(u);
  return null;
}

function sanitizeDownloadFilename(name: string): string {
  const base = name.trim() || "download";
  return base.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 200);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return globalThis.btoa(binary);
}

/**
 * Fetches `/api/download-event-file` with auth, writes to cache, opens the system share sheet
 * so the user can save to Files / Drive / etc.
 */
export async function shareEventAttachmentDownload(params: {
  storagePath: string;
  filename: string;
  contentType?: string | null;
}): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error("Sign in required");

  const branchId = await getSelectedBranchId();
  const q = new URLSearchParams();
  q.set("path", params.storagePath);
  q.set("name", sanitizeDownloadFilename(params.filename));
  if (params.contentType?.trim()) q.set("type", params.contentType.trim());

  const base = API_BASE_URL.replace(/\/$/, "");
  const url = `${base}/api/download-event-file?${q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(branchId ? { "X-Branch-Id": branchId } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || "Download failed"));
  }

  const buf = await res.arrayBuffer();
  const safeName = sanitizeDownloadFilename(params.filename) || "download";
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error("App cache is not available");
  const dest = `${dir}event-${Date.now()}-${safeName}`;
  const b64 = arrayBufferToBase64(buf);
  await FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 });

  const fileUri = dest.startsWith("file://") ? dest : `file://${dest}`;
  const title = sanitizeDownloadFilename(params.filename);
  try {
    await Share.share(
      Platform.OS === "android"
        ? { title, message: title, url: fileUri }
        : { title, url: fileUri },
    );
  } catch {
    Alert.alert(
      "Download",
      "The file was saved to the app cache, but the share sheet could not be opened.",
      [{ text: "OK" }],
    );
  }
}
