import type { Session } from "./types.mts";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/**
 * Prüft den Dashboard-Zugriff. Wenn DASHBOARD_PASSWORD gesetzt ist,
 * muss der Header x-dashboard-key übereinstimmen.
 */
export function checkDashboardAuth(req: Request): Response | null {
  const password = Netlify.env.get("DASHBOARD_PASSWORD");
  if (!password) return null;
  const provided = req.headers.get("x-dashboard-key");
  if (provided !== password) {
    return errorResponse("Nicht autorisiert. Dashboard-Passwort fehlt oder ist falsch.", 401);
  }
  return null;
}

/** Prüft den Agent-Token der Output-Media-Seite gegen die Session. */
export function checkAgentAuth(req: Request, session: Session, bodyToken?: string): Response | null {
  const token = req.headers.get("x-agent-token") || bodyToken;
  if (!token || token !== session.agentToken) {
    return errorResponse("Ungültiger Agent-Token.", 401);
  }
  return null;
}

/** Basis-URL der Site (für die Agent-Seiten-URL, die Recall lädt). */
export function publicBaseUrl(req: Request): string {
  const override = Netlify.env.get("PUBLIC_BASE_URL");
  if (override) return override.replace(/\/$/, "");
  const siteUrl = Netlify.env.get("URL");
  if (siteUrl && !siteUrl.includes("localhost")) return siteUrl.replace(/\/$/, "");
  return new URL(req.url).origin;
}
