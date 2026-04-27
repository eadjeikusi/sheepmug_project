import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  formatReportDocumentTitle,
  formatReportExportCellValue,
  getReportTableColumnLabel,
  orderKeysForReportExport,
  parseReportType,
} from "@sheepmug/shared-api";

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function collectAllKeys(rawRows: Array<Record<string, unknown>>): string[] {
  const keySet = new Set<string>();
  for (const row of rawRows) {
    for (const k of Object.keys(row)) {
      if (k) keySet.add(k);
    }
  }
  return [...keySet];
}

/** Tabular report export from `raw_preview_rows` (or similar row objects). */
export function buildReportExportCsv(
  rawRows: Array<Record<string, unknown>>,
  reportType: "group" | "membership" | "leader" = "group",
): { content: string; mime: string; ext: string } {
  if (!rawRows || rawRows.length === 0) {
    return { content: "No data\r\n", mime: "text/csv; charset=utf-8", ext: "csv" };
  }
  const keys = orderKeysForReportExport(collectAllKeys(rawRows), reportType);
  const header = keys.map((k) => escapeCsvField(getReportTableColumnLabel(k, reportType))).join(",");
  const lines = [header];
  for (const row of rawRows) {
    const line = keys.map((k) => escapeCsvField(formatReportExportCellValue((row as Record<string, unknown>)[k], k))).join(
      ",",
    );
    lines.push(line);
  }
  return { content: lines.join("\r\n") + "\r\n", mime: "text/csv; charset=utf-8", ext: "csv" };
}

/**
 * Returns base64 (no data: prefix) for storage in `report_exports.file_content` when format is PDF.
 */
export function buildReportExportPdfBase64(
  reportName: string | null | undefined,
  rawRows: Array<Record<string, unknown>>,
  reportType: "group" | "membership" | "leader" = "group",
): { contentBase64: string; mime: string; ext: string } {
  if (!rawRows || rawRows.length === 0) {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(12);
    doc.text("No data", 40, 40);
    const dataUri = doc.output("datauristring");
    const base64 = dataUri.split(",")[1] || "";
    return { contentBase64: base64, mime: "application/pdf", ext: "pdf" };
  }
  const keys = orderKeysForReportExport(collectAllKeys(rawRows), reportType);
  const head = keys.map((k) => getReportTableColumnLabel(k, reportType));
  const body = rawRows.map((row) => keys.map((k) => formatReportExportCellValue((row as Record<string, unknown>)[k], k)));
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(10);
  const name = String(reportName || "").trim() || undefined;
  const line = formatReportDocumentTitle(reportType, name);
  doc.text(line, 40, 32);
  autoTable(doc, {
    startY: 44,
    head: [head],
    body,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [80, 60, 120] },
    margin: { left: 40, right: 40 },
  });
  const dataUri = doc.output("datauristring");
  const base64 = dataUri.split(",")[1] || "";
  return { contentBase64: base64, mime: "application/pdf", ext: "pdf" };
}

