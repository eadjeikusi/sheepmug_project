import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
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

/** Digits only (for NANP duplicate-1 detection). */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * US/Canada/Caribbean (+1): users often type a leading "1" in the *national* field
 * (e.g. 11234567890). Strip that duplicate country digit before parsing.
 */
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

/**
 * Parse user input to E.164 and resolved country.
 * Empty input → e164 null (optional field).
 */
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

/** Same as normalizePhoneToE164 but empty string is an error */
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

/** Split stored E.164 for editing with country + national input */
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

export function sortedCountryOptions(): { code: CountryCode; label: string }[] {
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  return getCountries()
    .map((code) => ({
      code: code as CountryCode,
      label: dn.of(code) || code,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
