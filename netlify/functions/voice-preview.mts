import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { checkDashboardAuth, errorResponse } from "../lib/http.mts";
import { resolveKeys } from "../lib/keys.mts";

export const config: Config = {
  path: "/api/voice-preview",
};

const ALLOWED_VOICES = new Set(["marin", "cedar", "alloy", "echo", "shimmer", "verse"]);

const PREVIEW_COPY: Record<string, { text: string; instructions: string }> = {
  Deutsch: {
    text: "Hallo, ich bin dein digitaler Meeting-Assistent. Schön, dass wir uns sprechen – ich stelle mich kurz vor und höre dann zu.",
    instructions: "Sprich klar, freundlich und natürlich, wie in einem professionellen Meeting. Deutsches Hochdeutsch, ruhiges Tempo.",
  },
  Englisch: {
    text: "Hello, I'm your digital meeting assistant. Nice to speak with you — I'll introduce myself briefly, then I'll listen.",
    instructions: "Speak clearly, warmly and naturally, like a professional meeting assistant. Calm pace.",
  },
  auto: {
    text: "Hallo, ich bin dein digitaler Meeting-Assistent. Schön, dass wir uns sprechen – ich stelle mich kurz vor und höre dann zu.",
    instructions: "Sprich klar, freundlich und natürlich, wie in einem professionellen Meeting. Deutsches Hochdeutsch, ruhiges Tempo.",
  },
};

export default async (req: Request) => {
  if (req.method !== "POST") return errorResponse("Methode nicht erlaubt.", 405);

  const authError = checkDashboardAuth(req);
  if (authError) return authError;

  const body: any = await req.json().catch(() => ({}));
  const voice = String(body.voice || "").trim();
  const language = String(body.language || "Deutsch").trim();

  if (!ALLOWED_VOICES.has(voice)) {
    return errorResponse("Unbekannte Stimme.");
  }

  const copy = PREVIEW_COPY[language] || PREVIEW_COPY.Deutsch;
  const cacheKey = `previews/${voice}-${language === "Englisch" ? "en" : "de"}.mp3`;

  try {
    const store = getStore("voicebot");
    const cached = await store.get(cacheKey, { type: "arrayBuffer" });
    if (cached) {
      return audioResponse(cached);
    }

    const apiKey = resolveKeys(req).openaiApiKey;
    if (!apiKey) {
      return errorResponse(
        "Kein OpenAI-API-Key. Bitte im Dev-Tab hinterlegen, um Hörbeispiele abzuspielen.",
      );
    }

    const audio = await synthesize(apiKey, voice, copy);
    await store.set(cacheKey, audio, { metadata: { contentType: "audio/mpeg" } }).catch((err) => {
      console.warn("Konnte Hörbeispiel nicht cachen:", err);
    });
    return audioResponse(audio);
  } catch (err: any) {
    console.error("voice-preview error:", err);
    return errorResponse(err?.message || "Hörbeispiel konnte nicht erzeugt werden.", 500);
  }
};

async function synthesize(
  apiKey: string,
  voice: string,
  copy: { text: string; instructions: string },
): Promise<ArrayBuffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: copy.text,
      instructions: copy.instructions,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI TTS fehlgeschlagen (${res.status}): ${text}`);
  }
  return res.arrayBuffer();
}

function audioResponse(data: ArrayBuffer): Response {
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
