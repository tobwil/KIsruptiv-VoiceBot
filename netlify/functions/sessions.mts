import type { Config, Context } from "@netlify/functions";
import { checkDashboardAuth, errorResponse, json, publicBaseUrl } from "../lib/http.mts";
import { devKeysFromRequest, resolveKeys } from "../lib/keys.mts";
import {
  createBot,
  getBot,
  isBotFinished,
  latestBotStatus,
  leaveCall,
  type RecallAuth,
} from "../lib/recall.mts";
import { generateReport } from "../lib/report.mts";
import { getReport, getSession, getTranscript, listSessions, saveSession } from "../lib/store.mts";
import { publicSession, type Session, type SessionConfig, type SessionStatus } from "../lib/types.mts";

/** Recall-Auth aus Request-Headern, Session-Dev-Keys oder env; null wenn kein Key vorhanden. */
function recallAuth(req: Request | null, session?: Session | null): RecallAuth | null {
  const keys = resolveKeys(req, session);
  if (!keys.recallApiKey) return null;
  return { apiKey: keys.recallApiKey, region: keys.recallRegion };
}

export const config: Config = {
  path: ["/api/sessions", "/api/sessions/:id", "/api/sessions/:id/:action"],
};

export default async (req: Request, context: Context) => {
  const authError = checkDashboardAuth(req);
  if (authError) return authError;

  const { id, action } = context.params as { id?: string; action?: string };

  try {
    if (!id) {
      if (req.method === "GET") return listAll();
      if (req.method === "POST") return create(req);
      return errorResponse("Methode nicht erlaubt.", 405);
    }

    const session = await getSession(id);
    if (!session) return errorResponse("Session nicht gefunden.", 404);

    if (!action) {
      if (req.method === "GET") return detail(session, req);
      return errorResponse("Methode nicht erlaubt.", 405);
    }

    if (req.method !== "POST") return errorResponse("Methode nicht erlaubt.", 405);
    if (action === "leave") return leave(session, req);
    if (action === "report") return regenerateReport(session);
    return errorResponse("Unbekannte Aktion.", 404);
  } catch (err: any) {
    console.error("sessions api error:", err);
    return errorResponse(err?.message || "Interner Fehler.", 500);
  }
};

async function listAll(): Promise<Response> {
  const sessions = await listSessions();
  return json({ sessions: sessions.map(publicSession) });
}

async function create(req: Request): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  if (!body) return errorResponse("Ungültiger Request-Body.");

  const meetingUrl = String(body.meetingUrl || "").trim();
  const botName = String(body.botName || "").trim();
  const goal = String(body.goal || "").trim();

  if (!/^https:\/\/meet\.google\.com\//.test(meetingUrl)) {
    return errorResponse("Bitte eine gültige Google-Meet-URL angeben (https://meet.google.com/...).");
  }
  if (!botName) return errorResponse("Bitte einen Bot-Namen angeben.");
  if (!goal) return errorResponse("Bitte ein Ziel für das Meeting angeben.");

  const sessionConfig: SessionConfig = {
    meetingUrl,
    botName,
    principalName: String(body.principalName || "").trim() || "meinem Auftraggeber",
    goal,
    questions: Array.isArray(body.questions)
      ? body.questions.map((q: unknown) => String(q).trim()).filter(Boolean)
      : String(body.questions || "")
          .split("\n")
          .map((q) => q.trim())
          .filter(Boolean),
    knowledge: String(body.knowledge || ""),
    worthinessCriteria: String(body.worthinessCriteria || ""),
    language: String(body.language || "Deutsch"),
    voice: String(body.voice || "marin"),
    documents: sanitizeDocuments(body.documents),
  };

  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "created",
    config: sessionConfig,
    agentToken: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
    // Dev-Keys aus dem Dev-Tab werden pro Session hinterlegt, damit auch die
    // Agent-Seite (läuft im Recall-Browser) und der Bericht sie nutzen können.
    devKeys: devKeysFromRequest(req),
  };

  const keys = resolveKeys(req, session);
  if (!keys.recallApiKey) {
    return errorResponse(
      "Kein Recall.ai-API-Key vorhanden. Trage ihn im Dev-Tab ein oder setze RECALL_API_KEY.",
    );
  }
  if (!keys.openaiApiKey) {
    return errorResponse(
      "Kein OpenAI-API-Key vorhanden. Trage ihn im Dev-Tab ein oder setze OPENAI_API_KEY.",
    );
  }

  const base = publicBaseUrl(req);
  const agentPageUrl = `${base}/agent.html?session=${session.id}&token=${session.agentToken}`;

  const bot = await createBot(
    { apiKey: keys.recallApiKey, region: keys.recallRegion },
    { meetingUrl, botName, agentPageUrl },
  );
  session.recallBotId = bot.id;
  session.status = "joining";
  await saveSession(session);

  return json({ session: publicSession(session) }, 201);
}

async function detail(session: Session, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  const auth = recallAuth(req, session);
  if (
    refresh &&
    auth &&
    session.recallBotId &&
    session.status !== "report_ready" &&
    session.status !== "error"
  ) {
    try {
      const bot = await getBot(auth, session.recallBotId);
      const code = latestBotStatus(bot);
      session.recallStatus = code;
      session.status = mapStatus(code, session.status);
      if (isBotFinished(code) && !session.endedAt) {
        session.endedAt = new Date().toISOString();
      }
      await saveSession(session);

      // Meeting vorbei, aber noch kein Bericht? Dann jetzt erstellen.
      if (isBotFinished(code) && !session.hasReport) {
        await triggerReport(req, session);
      }
    } catch (err) {
      console.error("Recall-Statusabfrage fehlgeschlagen:", err);
    }
  }

  const [transcript, report, fresh] = await Promise.all([
    getTranscript(session.id),
    getReport(session.id),
    getSession(session.id),
  ]);

  return json({
    session: publicSession(fresh || session),
    transcript: transcript?.transcript || [],
    insights: transcript?.insights || [],
    assessment: transcript?.assessment || null,
    report,
  });
}

async function leave(session: Session, req: Request): Promise<Response> {
  if (!session.recallBotId) return errorResponse("Kein Bot für diese Session aktiv.");
  const auth = recallAuth(req, session);
  if (!auth) return errorResponse("Kein Recall.ai-API-Key vorhanden (Dev-Tab oder RECALL_API_KEY).");
  await leaveCall(auth, session.recallBotId);
  session.status = "ended";
  session.endedAt = new Date().toISOString();
  await saveSession(session);
  return json({ ok: true });
}

async function regenerateReport(session: Session): Promise<Response> {
  const report = await generateReport(session.id, true);
  return json({ report });
}

const MAX_DOCS = 5;
const MAX_DOC_CHARS = 12000;
const MAX_TOTAL_DOC_CHARS = 30000;

/** Begrenzt hochgeladene Dokumente (Anzahl, Länge pro Dokument, Gesamtlänge). */
function sanitizeDocuments(raw: unknown): { name: string; text: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const docs: { name: string; text: string }[] = [];
  let total = 0;
  for (const entry of raw.slice(0, MAX_DOCS)) {
    const name = String(entry?.name || "Dokument").slice(0, 120);
    let text = String(entry?.text || "").trim().slice(0, MAX_DOC_CHARS);
    if (!text) continue;
    if (total + text.length > MAX_TOTAL_DOC_CHARS) {
      text = text.slice(0, Math.max(0, MAX_TOTAL_DOC_CHARS - total));
      if (!text) break;
    }
    total += text.length;
    docs.push({ name, text });
  }
  return docs.length > 0 ? docs : undefined;
}

function mapStatus(code: string | undefined, fallback: SessionStatus): SessionStatus {
  switch (code) {
    case "joining_call":
    case "in_waiting_room":
      return "joining";
    case "in_call_not_recording":
    case "in_call_recording":
      return "in_call";
    case "call_ended":
    case "done":
      return "ended";
    case "fatal":
      return "error";
    default:
      return fallback;
  }
}

/** Startet die Berichtserstellung als Background Function; Fallback: synchron. */
async function triggerReport(req: Request, session: Session): Promise<void> {
  const origin = new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/.netlify/functions/report-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, token: session.agentToken }),
    });
    if (res.status === 202 || res.ok) return;
    console.warn(`Background-Function nicht verfügbar (${res.status}), erstelle Bericht synchron.`);
  } catch (err) {
    console.warn("Background-Function-Aufruf fehlgeschlagen, erstelle Bericht synchron.", err);
  }
  await generateReport(session.id).catch((err) => console.error("Berichtserstellung fehlgeschlagen:", err));
}
