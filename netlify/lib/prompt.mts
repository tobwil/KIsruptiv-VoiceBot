import type { SessionConfig } from "./types.mts";

/** Baut die System-Instructions für den Realtime-Sprachagenten. */
export function buildInstructions(config: SessionConfig): string {
  const questionBlock =
    config.questions.length > 0
      ? config.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
      : "(keine vordefinierten Fragen – stelle eigene, zielführende Fragen)";

  const languageRule =
    config.language === "auto"
      ? "Sprich in der Sprache, in der die Teilnehmer sprechen."
      : `Sprich ${config.language}. Wechsle nur die Sprache, wenn die Teilnehmer dich offensichtlich nicht verstehen.`;

  const knowledgeBlock = config.knowledge.trim()
    ? config.knowledge.trim()
    : "(keine zusätzlichen Informationen hinterlegt)";

  const criteriaBlock = config.worthinessCriteria.trim()
    ? config.worthinessCriteria.trim()
    : `- Das Angebot ist konkret und relevant für ${config.principalName}.
- Es gibt einen klaren Nutzen oder Mehrwert, kein generisches Kaltakquise-Skript.
- Die Konditionen/nächsten Schritte sind nachvollziehbar.`;

  return `Du bist "${config.botName}", der digitale Assistent von ${config.principalName}, und nimmst an dessen Stelle an diesem Video-Meeting teil. ${config.principalName} konnte nicht persönlich teilnehmen und hat dich beauftragt, das Gespräch zu führen.

# Dein Auftrag
${config.goal.trim()}

# Verhalten im Meeting
- Begrüße die Teilnehmer kurz und freundlich. Stelle dich mit deinem Namen vor und sage, dass du als Assistent von ${config.principalName} teilnimmst, das Gespräch strukturiert festhältst und alles anschließend an ${config.principalName} übergibst.
- Du bist ein höflicher, professioneller Gesprächspartner. Halte deine Redebeiträge kurz (1–3 Sätze), stelle eine Frage nach der anderen und lass dein Gegenüber ausreden.
- Höre aktiv zu und stelle Rückfragen, wenn etwas unklar oder vage ist. Hake bei Buzzwords nach ("Was genau heißt das konkret?").
- Wenn du nach Details gefragt wirst, die du nicht kennst oder nicht herausgeben darfst, sage ehrlich, dass ${config.principalName} das persönlich klären wird.
- Triff KEINE Zusagen, Käufe, Terminvereinbarungen oder rechtlich bindende Aussagen im Namen von ${config.principalName}. Du darfst lediglich in Aussicht stellen, dass sich ${config.principalName} meldet, falls das Thema relevant ist.
- Wenn dich jemand fragt, ob du eine KI bist, bestätige das offen und freundlich.
- ${languageRule}

# Fragen, die du im Laufe des Gesprächs stellen sollst
${questionBlock}

# Informationen, die du über ${config.principalName} weitergeben darfst (nichts darüber hinaus erfinden!)
${knowledgeBlock}

# Bewertung ("Wertigkeit")
Bewerte während des Gesprächs laufend, ob das Thema für einen persönlichen Kontakt mit ${config.principalName} wertvoll genug ist. Kriterien:
${criteriaBlock}

# Werkzeuge
- Rufe "log_insight" auf, sobald du eine wichtige Erkenntnis gewonnen hast (z. B. was das Angebot ist, Preise, Namen, Zeitpläne). Tu das still im Hintergrund, ohne es zu erwähnen.
- Wenn alle wichtigen Fragen beantwortet sind oder das Gespräch zu Ende geht, rufe "submit_assessment" mit deiner finalen Bewertung auf.
- Verabschiede dich danach kurz und höflich (bei hoher Bewertung: kündige an, dass sich ${config.principalName} melden wird; bei niedriger: bedanke dich neutral für die Zeit) und rufe anschließend "leave_meeting" auf, um das Meeting zu verlassen.
- Wenn längere Zeit niemand spricht oder das Meeting offensichtlich vorbei ist, verabschiede dich ebenfalls und rufe "leave_meeting" auf.

# Start
Warte nach deinem Beitritt einen Moment. Wenn dich jemand begrüßt oder anspricht, antworte. Falls nach ein paar Sekunden niemand spricht, ergreife selbst das Wort und stelle dich vor.`;
}

/** Tool-Definitionen für die Realtime-Session (GA-Format). */
export function buildTools(): any[] {
  return [
    {
      type: "function",
      name: "log_insight",
      description:
        "Hält eine wichtige Erkenntnis aus dem Gespräch fest (Angebot, Preise, Namen, Termine, Besonderheiten). Still im Hintergrund aufrufen.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Die Erkenntnis in einem prägnanten Satz." },
        },
        required: ["text"],
      },
    },
    {
      type: "function",
      name: "submit_assessment",
      description:
        "Übermittelt die finale Bewertung, ob das Thema einen persönlichen Kontakt wert ist. Genau einmal gegen Ende des Gesprächs aufrufen.",
      parameters: {
        type: "object",
        properties: {
          score: {
            type: "number",
            description: "Wertigkeit von 1 (irrelevant/Spam) bis 10 (unbedingt nachfassen).",
          },
          recommendation: {
            type: "string",
            enum: ["follow_up", "decline", "unclear"],
            description:
              "follow_up = persönlicher Kontakt lohnt sich, decline = nicht weiterverfolgen, unclear = nicht abschließend bewertbar.",
          },
          reasoning: { type: "string", description: "Kurze Begründung der Bewertung." },
          next_steps: {
            type: "string",
            description: "Empfohlene nächste Schritte, falls vorhanden.",
          },
        },
        required: ["score", "recommendation", "reasoning"],
      },
    },
    {
      type: "function",
      name: "leave_meeting",
      description:
        "Verlässt das Meeting. Erst aufrufen, NACHDEM du dich verabschiedet hast und deine Verabschiedung zu Ende gesprochen wurde.",
      parameters: { type: "object", properties: {} },
    },
  ];
}

/** Prompt für den Abschlussbericht nach dem Meeting. */
export function buildReportPrompt(
  config: SessionConfig,
  transcriptText: string,
  insights: string[],
  assessment: { score: number; recommendation: string; reasoning: string } | null | undefined,
): string {
  return `Du bist ein Assistent, der für ${config.principalName} Meeting-Berichte schreibt. Ein KI-Voice-Bot ("${config.botName}") hat stellvertretend an einem Meeting teilgenommen.

Ziel des Meetings:
${config.goal}

Bewertungskriterien für "Follow-up lohnt sich":
${config.worthinessCriteria || "(Standard: konkretes, relevantes Angebot mit klarem Mehrwert)"}

${insights.length > 0 ? `Vom Bot festgehaltene Erkenntnisse:\n${insights.map((i) => `- ${i}`).join("\n")}` : ""}

${assessment ? `Live-Bewertung des Bots: Score ${assessment.score}/10, Empfehlung: ${assessment.recommendation}, Begründung: ${assessment.reasoning}` : "Der Bot hat keine Live-Bewertung abgegeben."}

Transkript des Gesprächs:
---
${transcriptText || "(kein Transkript vorhanden)"}
---

Erstelle auf Deutsch einen strukturierten Bericht als JSON. Sei ehrlich: Wenn das Gespräch inhaltsleer war, sage das klar.`;
}

export const REPORT_JSON_SCHEMA = {
  name: "meeting_report",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
        description: "Zusammenfassung des Gesprächs in 3-6 Sätzen.",
      },
      offerDescription: {
        type: "string",
        description: "Was ist das Angebot / Anliegen der Gegenseite? Konkret beschreiben.",
      },
      score: { type: "number", description: "Wertigkeit 1-10." },
      recommendation: { type: "string", enum: ["follow_up", "decline", "unclear"] },
      reasoning: { type: "string", description: "Begründung der Empfehlung." },
      nextSteps: {
        type: "array",
        items: { type: "string" },
        description: "Konkrete empfohlene nächste Schritte.",
      },
      openQuestions: {
        type: "array",
        items: { type: "string" },
        description: "Fragen, die im Meeting offen geblieben sind.",
      },
    },
    required: [
      "summary",
      "offerDescription",
      "score",
      "recommendation",
      "reasoning",
      "nextSteps",
      "openQuestions",
    ],
  },
} as const;
