import type { DevKeys, Session } from "./types.mts";

export interface ResolvedKeys {
  recallApiKey?: string;
  recallRegion: string;
  openaiApiKey?: string;
}

/**
 * Löst die API-Keys in dieser Reihenfolge auf:
 *  1. Request-Header (x-recall-key, x-recall-region, x-openai-key) – vom Dev-Tab gesendet
 *  2. In der Session hinterlegte Dev-Keys (beim Meeting-Start gespeichert)
 *  3. Umgebungsvariablen
 */
export function resolveKeys(req?: Request | null, session?: Session | null): ResolvedKeys {
  const header = (name: string) => req?.headers.get(name)?.trim() || undefined;
  const dev = session?.devKeys;
  return {
    recallApiKey:
      header("x-recall-key") || dev?.recallApiKey || Netlify.env.get("RECALL_API_KEY") || undefined,
    recallRegion:
      header("x-recall-region") ||
      dev?.recallRegion ||
      Netlify.env.get("RECALL_REGION") ||
      "eu-central-1",
    openaiApiKey:
      header("x-openai-key") || dev?.openaiApiKey || Netlify.env.get("OPENAI_API_KEY") || undefined,
  };
}

/** Extrahiert Dev-Keys aus den Request-Headern (nur, wenn welche gesetzt sind). */
export function devKeysFromRequest(req: Request): DevKeys | undefined {
  const recallApiKey = req.headers.get("x-recall-key")?.trim() || undefined;
  const recallRegion = req.headers.get("x-recall-region")?.trim() || undefined;
  const openaiApiKey = req.headers.get("x-openai-key")?.trim() || undefined;
  if (!recallApiKey && !recallRegion && !openaiApiKey) return undefined;
  return { recallApiKey, recallRegion, openaiApiKey };
}
