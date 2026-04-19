/**
 * Resolve relative API image paths and localhost URLs for React Native `Image`.
 */
export function normalizeImageUri(rawUri: string | null): string | null {
  if (!rawUri) return null;
  const trimmed = rawUri.trim();
  if (!trimmed) return null;

  const apiBase = String(process.env.EXPO_PUBLIC_API_BASE_URL || "").trim();
  let apiUrl: URL | null = null;
  try {
    if (apiBase) apiUrl = new URL(apiBase);
  } catch {
    apiUrl = null;
  }

  if (trimmed.startsWith("/")) {
    if (!apiUrl) return trimmed;
    return `${apiUrl.protocol}//${apiUrl.host}${trimmed}`;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if ((parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && apiUrl) {
      parsed.protocol = apiUrl.protocol;
      parsed.host = apiUrl.host;
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}
