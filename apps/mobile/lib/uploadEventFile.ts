import { API_BASE_URL } from "./api";
import { getSelectedBranchId, getToken } from "./storage";

type UploadableAsset = {
  uri: string;
  name: string;
  mimeType?: string | null;
};

/**
 * POST multipart `/api/upload-event-file` with upload progress (React Native `XMLHttpRequest`).
 */
export function uploadEventFileWithProgress(
  asset: UploadableAsset,
  onProgress: (pct: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const token = await getToken();
      const branchId = await getSelectedBranchId();
      if (!token) {
        reject(new Error("Sign in required"));
        return;
      }

      const xhr = new XMLHttpRequest();
      const url = `${API_BASE_URL.replace(/\/$/, "")}/api/upload-event-file`;
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      if (branchId) xhr.setRequestHeader("X-Branch-Id", branchId);

      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable || evt.total <= 0) return;
        onProgress(Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100))));
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.onload = () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(xhr.responseText || "{}") as Record<string, unknown>;
        } catch {
          body = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve(body);
          return;
        }
        reject(new Error(String(body.error || "Upload failed")));
      };

      const fd = new FormData();
      fd.append(
        "file",
        // React Native file shape (not a web `Blob`)
        {
          uri: asset.uri,
          name: asset.name || "file",
          type: asset.mimeType || "application/octet-stream",
        } as unknown as Blob,
      );
      xhr.send(fd);
    })();
  });
}
