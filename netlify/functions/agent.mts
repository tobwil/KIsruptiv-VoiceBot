import type { Config, Context } from "@netlify/functions";
import { checkAgentAuth, errorResponse, json } from "../lib/http.mts";
import { resolveKeys } from "../lib/keys.mts";
import { buildInstructions, buildTools } from "../lib/prompt.mts";
import { leaveCall } from "../lib/recall.mts";
import { generateReport } from "../lib/report.mts";
import { getSession, saveSession, saveTranscript } from "../lib/store.mts";
import type { Session, TranscriptData } from "../lib/types.mts";

export const config: Config = {
  path: "/api/agent/:id/:action",
};

/**
 * API für die Agent-Seite (die Webseite, die der Recall-Bot im Meeting rendert).
 * Authentifizierung über den geheimen Agent-Token aus der Seiten-URL.
 */
export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return errorResponse("Methode nicht erlaubt.", 405);

  const { id, action } = context.params as { id: string; action: string };
  const session = await getSession(id);
  if (!session) return errorResponse("Session nicht gefunden.", 404);

  const body: any = await req.json().catch(() => ({}));
  const authError = checkAgentAuth(req, session, body?.token);
  if (authError) return authError;

  try {
    if (action === "token") return mintRealtimeSecret(session);
    if (action === "events") return storeEvents(session.id, body);
    if (action === "leave") return leaveAndFinish(session, req);
    return errorResponse("Unbekannte Aktion.", 404);
  } catch (err: any) {
    console.error("agent api error:", err);
    return errorResponse(err?.message || "Interner Fehler.", 500);
  }
};

/** Erzeugt einen kurzlebigen OpenAI-Realtime-Client-Secret für die Agent-Seite. */
async function mintRealtimeSecret(session: Session) {
  const apiKey = resolveKeys(null, session).openaiApiKey;
  if (!apiKey) return errorResponse("Kein OpenAI-API-Key vorhanden (Dev-Tab oder OPENAI_API_KEY).", 500);
  const model = Netlify.env.get("OPENAI_REALTIME_MODEL") || "gpt-realtime";

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        instructions: buildInstructions(session.config),
        tools: buildTools(),
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: { type: "semantic_vad" },
          },
          output: { voice: session.config.voice || "marin" },
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("client_secrets fehlgeschlagen:", res.status, text);
    return errorResponse(`OpenAI-Session konnte nicht erstellt werden (${res.status}).`, 502);
  }

  const data: any = await res.json();
  const clientSecret = data?.value || data?.client_secret?.value;
  if (!clientSecret) return errorResponse("OpenAI hat keinen Client-Secret geliefert.", 502);

  return json({
    clientSecret,
    model,
    botName: session.config.botName,
    principalName: session.config.principalName,
  });
}

/** Speichert Transkript, Erkenntnisse und Bewertung (vollständige Momentaufnahme). */
async function storeEvents(sessionId: string, body: any) {
  const data: TranscriptData = {
    transcript: Array.isArray(body.transcript) ? body.transcript : [],
    insights: Array.isArray(body.insights) ? body.insights : [],
    assessment: body.assessment || null,
  };
  await saveTranscript(sessionId, data);

  if (data.assessment) {
    const session = await getSession(sessionId);
    if (session && !session.assessment) {
      session.assessment = data.assessment;
      await saveSession(session);
    }
  }
  return json({ ok: true });
}

/** Bot verlässt das Meeting; anschließend Bericht erstellen. */
async function leaveAndFinish(session: Session, req: Request) {
  if (session.recallBotId) {
    const keys = resolveKeys(null, session);
    if (keys.recallApiKey) {
      await leaveCall({ apiKey: keys.recallApiKey, region: keys.recallRegion }, session.recallBotId).catch(
        (err) => console.error("leave_call fehlgeschlagen:", err),
      );
    }
  }
  session.status = "ended";
  session.endedAt = new Date().toISOString();
  await saveSession(session);

  const origin = new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/.netlify/functions/report-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, token: session.agentToken }),
    });
    if (!(res.status === 202 || res.ok)) {
      await generateReport(session.id).catch((err) =>
        console.error("Berichtserstellung fehlgeschlagen:", err),
      );
    }
  } catch {
    await generateReport(session.id).catch((err) =>
      console.error("Berichtserstellung fehlgeschlagen:", err),
    );
  }

  return json({ ok: true });
}
