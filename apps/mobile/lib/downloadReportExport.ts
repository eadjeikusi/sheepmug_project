import * as FileSystem from "expo-file-system";
import { Platform, Share, Alert } from "react-native";
import { API_BASE_URL } from "./api";
import { getToken, getSelectedBranchId } from "./storage";
import type { ReportExportResponse } from "@sheepmug/shared-api";

function sanitizeFilename(name: string): string {
  const base = (name && name.trim()) || "report";
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
 * After POST /api/reports/exports: write `content` to cache and open share sheet.
 */
function writableExportDir(): string | null {
  return FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? null;
}

export async function shareReportFromExportResponse(data: ReportExportResponse): Promise<void> {
  const dir = writableExportDir();
  if (!dir) throw new Error("App storage is not available");
  const safe = sanitizeFilename(data.filename);
  const dest = `${dir}report-${Date.now()}-${safe}`;

  if (data.format === "pdf") {
    await FileSystem.writeAsStringAsync(dest, data.content, { encoding: FileSystem.EncodingType.Base64 });
  } else {
    await FileSystem.writeAsStringAsync(dest, data.content, { encoding: FileSystem.EncodingType.UTF8 });
  }

  const fileUri = dest.startsWith("file://") ? dest : `file://${dest}`;
  try {
    await Share.share(
      Platform.OS === "android" ? { title: safe, message: safe, url: fileUri } : { title: safe, url: fileUri },
    );
  } catch {
    Alert.alert("Export", "The file was saved to app cache, but the share sheet could not be opened.", [{ text: "OK" }]);
  }
}

/**
 * Download GET /api/reports/exports/:id/download with auth, then share (history links).
 */
export async function shareReportFromDownloadPath(path: string, fallbackName: string): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error("Sign in required");
  const branchId = await getSelectedBranchId();
  const base = API_BASE_URL.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = path.startsWith("http") ? path : `${base}${p}`;

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
  const fromCd = (() => {
    const cd = res.headers.get("Content-Disposition");
    if (!cd) return null;
    const m = /filename="([^"]+)"|filename=([^;]+)/i.exec(cd);
    if (!m) return null;
    return (m[1] || m[2] || "").trim().replace(/^["']|["']$/g, "") || null;
  })();
  const name = sanitizeFilename(fromCd || fallbackName || "report");
  const dir = writableExportDir();
  if (!dir) throw new Error("App storage is not available");
  const dest = `${dir}report-${Date.now()}-${name}`;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/pdf")) {
    const b64 = arrayBufferToBase64(buf);
    await FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 });
  } else {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    await FileSystem.writeAsStringAsync(dest, text, { encoding: FileSystem.EncodingType.UTF8 });
  }
  const fileUri = dest.startsWith("file://") ? dest : `file://${dest}`;

  try {
    await Share.share(
      Platform.OS === "android" ? { title: name, message: name, url: fileUri } : { title: name, url: fileUri },
    );
  } catch {
    Alert.alert("Export", "The file was saved to app cache, but the share sheet could not be opened.", [{ text: "OK" }]);
  }
}
