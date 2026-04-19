import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
  getCountries,
} from "libphonenumber-js";

const FALLBACK_COUNTRY: CountryCode = "US";

/** Uppercase ISO 3166-1 alpha-2, default US */
export function sanitizeCountryIso(raw: string | null | undefined, fallback: string): CountryCode {
  const f = (fallback || FALLBACK_COUNTRY).toUpperCase();
  const s = (raw || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s as CountryCode;
  return f as CountryCode;
}

export function isValidCountryIso(s: string): boolean {
  return getCountries().includes(s as CountryCode);
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** +1 NANP: leading 1 duplicated in national field (e.g. 11234567890). */
function maybeStripDuplicateNanpLeadingOne(trimmed: string, countryIso: CountryCode): string {
  const d = digitsOnly(trimmed);
  if (d.length !== 11 || !d.startsWith("1")) return trimmed;
  try {
    if (getCountryCallingCode(countryIso) !== "1") return trimmed;
  } catch {
    return trimmed;
  }
  return d.slice(1);
}

const INVALID_PHONE_MSG =
  "Invalid phone number for the selected country. For US/Canada, use 10 digits (area code + number), or 10 digits without a leading 1.";

export function normalizePhoneToE164(
  raw: string | null | undefined,
  countryIso: string | null | undefined,
  defaultCountry: string,
): { e164: string | null; countryIso: CountryCode } {
  const cc = sanitizeCountryIso(countryIso, defaultCountry);
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { e164: null, countryIso: cc };
  }

  const forCc = maybeStripDuplicateNanpLeadingOne(trimmed, cc);
  let phone = parsePhoneNumberFromString(forCc, cc);
  if (!phone || !phone.isValid()) {
    phone = parsePhoneNumberFromString(trimmed, cc);
  }
  if (!phone || !phone.isValid()) {
    phone = parsePhoneNumberFromString(trimmed);
  }
  if (!phone || !phone.isValid()) {
    throw new Error(INVALID_PHONE_MSG);
  }
  const resolvedCountry = (phone.country || cc) as CountryCode;
  return {
    e164: phone.format("E.164"),
    countryIso: resolvedCountry,
  };
}

export function normalizePhoneToE164Required(
  raw: string | null | undefined,
  countryIso: string | null | undefined,
  defaultCountry: string,
): { e164: string; countryIso: CountryCode } {
  const out = normalizePhoneToE164(raw, countryIso, defaultCountry);
  if (!out.e164) {
    throw new Error("Phone number is required");
  }
  return { e164: out.e164, countryIso: out.countryIso };
}

export function e164ToCountryAndNational(
  e164: string | null | undefined,
  fallbackCountry: string,
): { countryIso: CountryCode; national: string } {
  const fb = sanitizeCountryIso(fallbackCountry, FALLBACK_COUNTRY);
  if (!e164?.trim()) {
    return { countryIso: fb, national: "" };
  }
  const phone = parsePhoneNumberFromString(e164.trim());
  if (phone && phone.isValid()) {
    return {
      countryIso: (phone.country || fb) as CountryCode,
      national: phone.nationalNumber,
    };
  }
  return { countryIso: fb, national: e164.replace(/^\+/, "").replace(/\D/g, "") };
}

/** Regional-indicator flag emoji from ISO 3166-1 alpha-2 (e.g. SG → 🇸🇬). */
export function countryIsoToFlagEmoji(iso: string): string {
  const c = iso.trim().toUpperCase();
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return "📞";
  const base = 0x1f1e6;
  return String.fromCodePoint(base + c.charCodeAt(0) - 65, base + c.charCodeAt(1) - 65);
}

export function callingCodePlusDisplay(country: CountryCode): string {
  return `+${getCountryCallingCode(country)}`;
}

/** Keeps only digits; trims past the longest length libphonenumber considers possible for that country. */
export function clampNationalDigitsForCountry(rawDigits: string, country: CountryCode): string {
  let d = rawDigits.replace(/\D/g, "");
  const cc = getCountryCallingCode(country);
  const prefix = `+${cc}`;
  for (;;) {
    if (d.length === 0) return "";
    const candidate = `${prefix}${d}`;
    let r: ReturnType<typeof validatePhoneNumberLength>;
    try {
      r = validatePhoneNumberLength(candidate, country);
    } catch {
      return d.slice(0, -1);
    }
    if (r !== "TOO_LONG") return d;
    d = d.slice(0, -1);
  }
}

export function sortedCountryOptions(): { code: CountryCode; label: string }[] {
  const codes = getCountries() as CountryCode[];
  let labelFor = (c: string) => c;
  try {
    const IDN = (Intl as unknown as { DisplayNames?: new (locales: string | string[], options: { type: "region" }) => { of: (code: string) => string | undefined } }).DisplayNames;
    if (typeof IDN === "function") {
      const dn = new IDN(["en"], { type: "region" });
      labelFor = (c: string) => dn.of(c) || c;
    }
  } catch {
    /* Hermes / older RN: no DisplayNames — use ISO code as label */
  }
  return codes
    .map((code) => ({
      code,
      label: labelFor(code),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
