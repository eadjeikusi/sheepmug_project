import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  maxDuration: 60,
};

// #region agent log
function sendDiag(res: ServerResponse, phase: string, err: unknown): void {
  const e = err as { message?: string; name?: string; code?: string; stack?: string } | undefined;
  try {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "catchall_crash",
        phase,
        name: e?.name || null,
        code: e?.code || null,
        message: e?.message || String(err),
        stack: (e?.stack || "").split("\n").slice(0, 20),
        node: process.version,
        vercelEnv: process.env.VERCEL_ENV || null,
        hasSupabaseUrl: Boolean(process.env.VITE_SUPABASE_URL),
        hasSupabaseAnon: Boolean(process.env.VITE_SUPABASE_ANON_KEY),
        hasSupabaseService: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        hasJwtSecret: Boolean(process.env.JWT_SECRET),
      }),
    );
  } catch {
    /* ignore */
  }
}
// #endregion

let cachedApp: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
let cachedImportError: unknown = null;

async function loadApp(): Promise<((req: IncomingMessage, res: ServerResponse) => void) | null> {
  if (cachedApp) return cachedApp;
  if (cachedImportError) return null;
  try {
    const mod = (await import("./_lib/server.mjs")) as { app: unknown };
    cachedApp = mod.app as (req: IncomingMessage, res: ServerResponse) => void;
    return cachedApp;
  } catch (err) {
    cachedImportError = err;
    return null;
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = await loadApp();
  if (!app) {
    sendDiag(res, "import", cachedImportError);
    return;
  }
  try {
    app(req, res);
  } catch (err) {
    sendDiag(res, "invoke", err);
  }
}
