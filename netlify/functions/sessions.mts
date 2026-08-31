import type { Config, Context } from "@netlify/functions";
import { checkDashboardAuth, errorResponse, json, publicBaseUrl } from "../lib/http.mts";
import { createBot, getBot, isBotFinished, latestBotStatus, leaveCall } from "../lib/recall.mts";
import { generateReport } from "../lib/report.mts";
import { getReport, getSession, getTranscript, listSessions, saveSession } from "../lib/store.mts";
import { publicSession, type Session, type SessionConfig, type SessionStatus } from "../lib/types.mts";

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
    if (action === "leave") return leave(session);
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
  };

  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "created",
    config: sessionConfig,
    agentToken: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
  };

  const base = publicBaseUrl(req);
  const agentPageUrl = `${base}/agent.html?session=${session.id}&token=${session.agentToken}`;

  const bot = await createBot({ meetingUrl, botName, agentPageUrl });
  session.recallBotId = bot.id;
  session.status = "joining";
  await saveSession(session);

  return json({ session: publicSession(session) }, 201);
}

async function detail(session: Session, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  if (refresh && session.recallBotId && session.status !== "report_ready" && session.status !== "error") {
    try {
      const bot = await getBot(session.recallBotId);
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

async function leave(session: Session): Promise<Response> {
  if (!session.recallBotId) return errorResponse("Kein Bot für diese Session aktiv.");
  await leaveCall(session.recallBotId);
  session.status = "ended";
  session.endedAt = new Date().toISOString();
  await saveSession(session);
  return json({ ok: true });
}

async function regenerateReport(session: Session): Promise<Response> {
  const report = await generateReport(session.id, true);
  return json({ report });
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
