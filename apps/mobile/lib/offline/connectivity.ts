import { API_BASE_URL } from "../api";

export async function probeApiOnline(timeoutMs = 6000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${API_BASE_URL}/api`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(t);
    return typeof res.status === "number";
  } catch {
    return false;
  }
}
