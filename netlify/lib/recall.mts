/** Minimaler Client für die Recall.ai-API (Meeting-Bot-Infrastruktur). */

function baseUrl(): string {
  const region = Netlify.env.get("RECALL_REGION") || "eu-central-1";
  return `https://${region}.recall.ai`;
}

function headers(): Record<string, string> {
  const key = Netlify.env.get("RECALL_API_KEY");
  if (!key) throw new Error("RECALL_API_KEY ist nicht gesetzt");
  return {
    Authorization: `Token ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function recallFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${baseUrl()}${path}`, { ...init, headers: headers() });
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

export async function createBot(params: CreateBotParams): Promise<{ id: string }> {
  const variant = Netlify.env.get("RECALL_BOT_VARIANT") || "web_4_core";
  return recallFetch("/api/v1/bot/", {
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

export async function getBot(botId: string): Promise<any> {
  return recallFetch(`/api/v1/bot/${botId}/`);
}

export async function leaveCall(botId: string): Promise<void> {
  await recallFetch(`/api/v1/bot/${botId}/leave_call/`, { method: "POST" });
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
