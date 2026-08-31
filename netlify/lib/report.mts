import { resolveKeys } from "./keys.mts";
import { buildReportPrompt, REPORT_JSON_SCHEMA } from "./prompt.mts";
import { getSession, getTranscript, saveReport, saveSession } from "./store.mts";
import type { Report } from "./types.mts";

/**
 * Erstellt den Abschlussbericht für eine Session und speichert ihn.
 * Idempotent: existierende Berichte werden nicht überschrieben, außer force=true.
 */
export async function generateReport(sessionId: string, force = false): Promise<Report | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  if (session.hasReport && !force) return null;

  const apiKey = resolveKeys(null, session).openaiApiKey;
  if (!apiKey) throw new Error("Kein OpenAI-API-Key vorhanden (Dev-Tab oder OPENAI_API_KEY).");
  const model = Netlify.env.get("OPENAI_REPORT_MODEL") || "gpt-5-mini";

  const data = await getTranscript(sessionId);
  const transcriptText = (data?.transcript || [])
    .map((l) => `${l.role === "bot" ? session.config.botName : "Teilnehmer"}: ${l.text}`)
    .join("\n");
  const insights = (data?.insights || []).map((i) => i.text);

  const prompt = buildReportPrompt(session.config, transcriptText, insights, data?.assessment);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: REPORT_JSON_SCHEMA },
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI-Berichtserstellung fehlgeschlagen (${res.status}): ${await res.text()}`);
  }

  const completion: any = await res.json();
  const content = completion?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI hat keinen Berichtsinhalt geliefert.");

  const report: Report = { ...JSON.parse(content), generatedAt: new Date().toISOString() };
  await saveReport(sessionId, report);

  const fresh = await getSession(sessionId);
  if (fresh) {
    fresh.hasReport = true;
    fresh.status = "report_ready";
    if (!fresh.endedAt) fresh.endedAt = new Date().toISOString();
    await saveSession(fresh);
  }
  return report;
}
