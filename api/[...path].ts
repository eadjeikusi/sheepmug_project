import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../server";

export const config = {
  maxDuration: 60,
};

// #region agent log
function logDebug(payload: Record<string, unknown>): void {
  try {
    fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "46abe0",
      },
      body: JSON.stringify({
        sessionId: "46abe0",
        location: "api/[...path].ts",
        timestamp: Date.now(),
        ...payload,
      }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
// #endregion

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  // #region agent log
  try {
    const url = (req as IncomingMessage & { url?: string }).url || "";
    const method = (req as IncomingMessage & { method?: string }).method || "";
    logDebug({
      message: "catchall.invoke",
      data: {
        url,
        method,
        hasApp: typeof app === "function",
      },
      hypothesisId: "A",
    });
  } catch {
    /* ignore */
  }
  // #endregion
  (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
