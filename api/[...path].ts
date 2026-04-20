import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  maxDuration: 60,
};

let cachedApp: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

async function loadApp(): Promise<(req: IncomingMessage, res: ServerResponse) => void> {
  if (cachedApp) return cachedApp;
  const mod = (await import("./_lib/server.mjs")) as { app: unknown };
  cachedApp = mod.app as (req: IncomingMessage, res: ServerResponse) => void;
  return cachedApp;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = await loadApp();
  app(req, res);
}
