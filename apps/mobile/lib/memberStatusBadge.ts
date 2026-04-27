import type { MemberStatusOption } from "@sheepmug/shared-api";

/** Tailwind-like palette → React Native chip colors (aligned with web `memberStatusBadge.ts`). */
const PRESET: Record<string, { chipBg: string; chipBorder: string; text: string; dot: string }> = {
  green: { chipBg: "#eff6ff", chipBorder: "#bfdbfe", text: "#1d4ed8", dot: "#2563eb" },
  red: { chipBg: "#fef2f2", chipBorder: "#fecaca", text: "#b91c1c", dot: "#ef4444" },
  amber: { chipBg: "#fffbeb", chipBorder: "#fde68a", text: "#92400e", dot: "#f59e0b" },
  gray: { chipBg: "#f9fafb", chipBorder: "#e5e7eb", text: "#374151", dot: "#6b7280" },
  indigo: { chipBg: "#eff6ff", chipBorder: "#bfdbfe", text: "#1d4ed8", dot: "#2563eb" },
  violet: { chipBg: "#eff6ff", chipBorder: "#bfdbfe", text: "#1e40af", dot: "#3b82f6" },
  blue: { chipBg: "#eff6ff", chipBorder: "#bfdbfe", text: "#1d4ed8", dot: "#3b82f6" },
  rose: { chipBg: "#fff1f2", chipBorder: "#fecdd3", text: "#be123c", dot: "#f43f5e" },
  slate: { chipBg: "#f8fafc", chipBorder: "#e2e8f0", text: "#334155", dot: "#64748b" },
  teal: { chipBg: "#f0fdfa", chipBorder: "#99f6e4", text: "#115e59", dot: "#14b8a6" },
  cyan: { chipBg: "#ecfeff", chipBorder: "#a5f3fc", text: "#155e75", dot: "#06b6d4" },
  orange: { chipBg: "#fff7ed", chipBorder: "#fed7aa", text: "#9a3412", dot: "#f97316" },
  emerald: { chipBg: "#eff6ff", chipBorder: "#bfdbfe", text: "#1d4ed8", dot: "#3b82f6" },
};

function inferPresetFromLabel(label: string): keyof typeof PRESET | null {
  const s = label.toLowerCase().trim();
  if (!s) return null;
  if (/\b(deceas|died|passed away|funeral)\b/.test(s)) return "gray";
  if (/\b(active|engaged|participat)\b/.test(s) || s === "active" || s === "new") return "green";
  if (/\b(new|visitor|guest|first.?time)\b/.test(s)) return "emerald";
  if (/\b(stop|inactive|pause|suspens|not active|withdraw|left)\b/.test(s)) return "amber";
  if (/\b(transfer|travel|relocat|move abroad)\b/.test(s)) return "indigo";
  if (/\b(pend|prospect|inquir|follow)\b/.test(s)) return "violet";
  if (/\b(absent|miss|unreach)\b/.test(s)) return "orange";
  if (/\b(block|remov|ban)\b/.test(s)) return "red";
  if (/\b(lead|shepherd|care)\b/.test(s)) return "blue";
  return null;
}

function hashToPresetKey(label: string): keyof typeof PRESET {
  const pool: (keyof typeof PRESET)[] = [
    "blue",
    "indigo",
    "violet",
    "teal",
    "cyan",
    "rose",
    "green",
    "emerald",
    "orange",
  ];
  let h = 0;
  for (let i = 0; i < label.length; i += 1) {
    h = (h * 33 + label.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(h) % pool.length];
}

function resolvePresetKey(status: string): keyof typeof PRESET {
  const inferred = inferPresetFromLabel(status);
  if (inferred) return inferred;
  return hashToPresetKey(status);
}

export function memberStatusBadgePair(
  status: string | null | undefined,
  _opts: Pick<MemberStatusOption, "label" | "color">[]
): { chipBg: string; chipBorder: string; text: string; dot: string; labelColor: string } {
  const text = (status ?? "").trim() || "—";
  if (text === "—") {
    const c = PRESET.slate;
    return { chipBg: c.chipBg, chipBorder: c.chipBorder, text, dot: c.dot, labelColor: c.text };
  }
  const key = resolvePresetKey(text);
  const c = PRESET[key] ?? PRESET.slate;
  return { chipBg: c.chipBg, chipBorder: c.chipBorder, text, dot: c.dot, labelColor: c.text };
}
