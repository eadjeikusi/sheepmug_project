/** Same rules as `apps/mobile/lib/memberDisplayFormat` — title-case each word, preserve emails/phones. */

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function isLikelyPhone(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return false;
  return /^[\d\s+().-]+$/.test(s.trim());
}

/**
 * Title-case each word for API-sourced names and labels.
 * Leaves email and phone-like strings unchanged.
 */
export function displayMemberWords(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (t === "—" || t === "-" || t === "N/A") return t;
  if (isLikelyEmail(t)) return t.toLowerCase();
  if (isLikelyPhone(t)) return t;
  return t
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      if (/^\d/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}
