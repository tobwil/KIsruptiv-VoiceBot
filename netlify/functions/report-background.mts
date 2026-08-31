import { generateReport } from "../lib/report.mts";
import { getSession } from "../lib/store.mts";

/**
 * Background Function (Suffix "-background"): erstellt den Abschlussbericht,
 * ohne an das 10-Sekunden-Limit synchroner Functions gebunden zu sein.
 * Aufruf über POST /.netlify/functions/report-background mit
 * { sessionId, token } – token muss dem agentToken der Session entsprechen.
 */
export default async (req: Request) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });

  const body: any = await req.json().catch(() => null);
  const sessionId = body?.sessionId;
  const token = body?.token;
  if (!sessionId || !token) return new Response(null, { status: 400 });

  const session = await getSession(sessionId);
  if (!session || session.agentToken !== token) return new Response(null, { status: 401 });

  try {
    await generateReport(sessionId);
  } catch (err) {
    console.error("Background-Berichtserstellung fehlgeschlagen:", err);
  }
  return new Response(null, { status: 200 });
};
