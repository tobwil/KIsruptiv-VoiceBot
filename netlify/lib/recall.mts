/** Minimaler Client für die Recall.ai-API (Meeting-Bot-Infrastruktur). */

export interface RecallAuth {
  apiKey: string;
  region: string;
}

function headers(auth: RecallAuth): Record<string, string> {
  if (!auth.apiKey) throw new Error("Kein Recall.ai-API-Key vorhanden");
  return {
    Authorization: `Token ${auth.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function recallFetch(auth: RecallAuth, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://${auth.region}.recall.ai${path}`, {
    ...init,
    headers: headers(auth),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Recall.ai ${init?.method || "GET"} ${path} fehlgeschlagen (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

export interface CreateBotParams {
  meetingUrl: string;
  botName: string;
  /** URL der Agent-Seite, die der Bot als Kamera-Feed rendert (Output Media). */
  agentPageUrl: string;
}

export async function createBot(auth: RecallAuth, params: CreateBotParams): Promise<{ id: string }> {
  const variant = Netlify.env.get("RECALL_BOT_VARIANT") || "web_4_core";
  return recallFetch(auth, "/api/v1/bot/", {
    method: "POST",
    body: JSON.stringify({
      meeting_url: params.meetingUrl,
      bot_name: params.botName,
      output_media: {
        camera: {
          kind: "webpage",
          config: { url: params.agentPageUrl },
        },
      },
      variant: { google_meet: variant },
      recording_config: {
        include_bot_in_recording: { audio: true },
      },
    }),
  });
}

export async function getBot(auth: RecallAuth, botId: string): Promise<any> {
  return recallFetch(auth, `/api/v1/bot/${botId}/`);
}

export async function leaveCall(auth: RecallAuth, botId: string): Promise<void> {
  await recallFetch(auth, `/api/v1/bot/${botId}/leave_call/`, { method: "POST" });
}

/**
 * Leitet den letzten Status aus den status_changes des Bots ab.
 * Typische Codes: joining_call, in_waiting_room, in_call_not_recording,
 * in_call_recording, call_ended, done, fatal.
 */
export function latestBotStatus(bot: any): string | undefined {
  const changes = bot?.status_changes;
  if (Array.isArray(changes) && changes.length > 0) {
    return changes[changes.length - 1]?.code;
  }
  return undefined;
}

export function isBotFinished(statusCode: string | undefined): boolean {
  return statusCode === "done" || statusCode === "fatal" || statusCode === "call_ended";
}
