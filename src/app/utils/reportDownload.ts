/**
 * Download report CSV/PDF in the browser. Export POST always returns { content, filename, format };
 * GET /download must be called with the same auth headers the app uses.
 */

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadReportFromExportResponse(data: { content: string; filename: string; format: "csv" | "pdf" }): void {
  const { content, filename, format } = data;
  if (format === "pdf") {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const name = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename || "report"}.pdf`;
    triggerBrowserDownload(new Blob([bytes], { type: "application/pdf" }), name);
  } else {
    const name = filename.toLowerCase().endsWith(".csv") ? filename : `${filename || "report"}.csv`;
    triggerBrowserDownload(new Blob([content], { type: "text/csv;charset=utf-8" }), name);
  }
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1].trim();
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }
  return null;
}

/**
 * Fetches a report export by URL (must include `Authorization` + branch header).
 */
export async function downloadReportWithAuth(
  pathOrUrl: string,
  headers: HeadersInit,
  fallbackName = "report",
): Promise<void> {
  const abs = pathOrUrl.startsWith("http") ? pathOrUrl : `${window.location.origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;

  const res = await fetch(abs, { headers });
  if (!res.ok) {
    const text = await res.text();
    let message = "Download failed";
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      if (text) message = text.slice(0, 200);
    }
    throw new Error(message);
  }
  const fromHeader = parseContentDispositionFilename(res.headers.get("content-disposition"));
  const blob = await res.blob();
  const type = res.headers.get("content-type") || "";
  const ext = type.includes("pdf") || fallbackName.toLowerCase().endsWith(".pdf") ? ".pdf" : ".csv";
  const name = fromHeader || (fallbackName.includes(".") ? fallbackName : `${fallbackName}${ext}`);
  triggerBrowserDownload(blob, name);
}
