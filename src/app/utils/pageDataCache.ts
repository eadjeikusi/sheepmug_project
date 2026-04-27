type CacheEntry<T> = {
  value: T;
  savedAt: number;
};

const mem = new Map<string, CacheEntry<unknown>>();

function nowMs() {
  return Date.now();
}

export function readPageCache<T>(key: string, maxAgeMs: number): T | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (nowMs() - hit.savedAt > maxAgeMs) {
    mem.delete(key);
    return null;
  }
  return hit.value as T;
}

export function writePageCache<T>(key: string, value: T) {
  mem.set(key, { value, savedAt: nowMs() });
}

