/**
 * ISO 3166-1 alpha-2 for phone defaults (matches web intent).
 * Uses `Intl` only — no `expo-localization` — so Metro always resolves this module in monorepos.
 */
export function getDeviceDefaultCountryIso(): string {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    if (typeof Intl !== "undefined" && "Locale" in Intl) {
      const loc = new Intl.Locale(tag);
      const region = loc.region;
      if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
    }
    const m = /^[a-z]{2}-([a-z]{2})\b/i.exec(tag) || /^[a-z]{2}_([a-z]{2})\b/i.exec(tag);
    if (m?.[1] && /^[a-z]{2}$/i.test(m[1])) return m[1].toUpperCase();
  } catch {
    // ignore
  }
  return "US";
}
