/**
 * Logs to the Metro / Expo terminal in development only.
 * Prefix: [sheepmug]
 */
export function devLog(...args: unknown[]) {
  if (__DEV__) console.log("[sheepmug]", ...args);
}

export function devWarn(...args: unknown[]) {
  if (__DEV__) console.warn("[sheepmug]", ...args);
}
