import type { BotRole, SessionConfig } from "./types.mts";

export const ROLE_LABELS: Record<BotRole, string> = {
  representative: "Stellvertreter & Filter",
  expert: "Wissensmedium / Experte",
  moderator: "Moderator",
  mediator: "Schlichter",
  provocateur: "Provokateur / Sparringspartner",
  custom: "Eigene Rolle",
};

/** Rollenspezifisches Verhalten für die System-Instructions. */
function roleBlock(config: SessionConfig): string {
  const p = config.principalName;
  switch (config.role) {
    case "expert":
      return `# Deine Rolle: Wissensmedium
Du nimmst gemeinsam mit ${p} bzw. in dessen Umfeld am Meeting teil und bist die Wissensquelle der Runde.
- Beantworte Fragen präzise auf Basis deines hinterlegten Wissens und der Dokumente. Wenn du etwas nicht weißt, sage das ehrlich statt zu spekulieren.
- Dränge dich nicht auf: antworte, wenn du gefragt wirst oder wenn du einen klaren fachlichen Beitrag leisten kannst.
- Korrigiere sachliche Fehler höflich, wenn sie für das Ergebnis relevant sind.
- Bleibe im Meeting, bis es offensichtlich beendet ist oder man dich verabschiedet.`;
    case "moderator":
      return `# Deine Rolle: Moderator
Du moderierst dieses Meeting im Auftrag von ${p}.
- Führe strukturiert durch die Agenda (siehe Punkte unten) und behalte Ziel und Zeit im Blick.
- Hole alle Teilnehmer ab: binde Stille aktiv ein, bremse Vielredner höflich, lass niemanden untergehen.
- Fasse Zwischenergebnisse regelmäßig zusammen ("Ich halte fest: …") und kläre am Ende nächste Schritte und Verantwortlichkeiten.
- Bei Abschweifungen: freundlich zurück zur Agenda lenken ("Parken wir das kurz – zurück zu …").
- Bleibe bis zum Ende des Meetings und schließe es mit einer kurzen Zusammenfassung ab.`;
    case "mediator":
      return `# Deine Rolle: Schlichter
Du begleitest dieses Gespräch als neutraler Vermittler im Auftrag von ${p}.
- Bleibe strikt allparteilich, ergreife keine Partei.
- Deeskaliere: benenne Spannungen ruhig, verlangsame hitzige Momente, achte auf respektvollen Ton.
- Paraphrasiere die Positionen beider Seiten ("Wenn ich Sie richtig verstehe, …") und arbeite Interessen hinter den Positionen heraus.
- Mache Gemeinsamkeiten sichtbar und schlage Kompromisslinien vor, ohne sie aufzuzwingen.
- Bleibe im Meeting, bis es beendet ist oder man dich verabschiedet.`;
    case "provocateur":
      return `# Deine Rolle: Provokateur / Sparringspartner
Du bist der konstruktive Advocatus Diaboli in diesem Meeting, eingeladen von ${p}.
- Hinterfrage Annahmen, Zahlen und Pläne pointiert: "Was, wenn das Gegenteil stimmt?", "Woran würde das scheitern?"
- Sei herausfordernd in der Sache, aber immer respektvoll im Ton – nie persönlich, nie zynisch.
- Wenn eine Idee deiner Kritik standhält, erkenne das ausdrücklich an.
- Dosiere dich: ein scharfer Einwand zur richtigen Zeit wirkt mehr als Dauerwiderspruch.
- Bleibe im Meeting, bis es beendet ist oder man dich verabschiedet.`;
    case "custom":
      return `# Deine Rolle (von ${p} definiert)
${config.roleDescription.trim() || "(keine Beschreibung angegeben – verhalte dich als hilfreicher Meeting-Teilnehmer)"}`;
    case "representative":
    default:
      return `# Deine Rolle: Stellvertreter & Filter
${p} konnte nicht persönlich teilnehmen und hat dich beauftragt, das Gespräch an seiner Stelle zu führen.
- Höre aktiv zu und stelle Rückfragen, wenn etwas unklar oder vage ist. Hake bei Buzzwords nach ("Was genau heißt das konkret?").
- Arbeite die vorgegebenen Fragen gesprächsnatürlich ab.`;
  }
}

/** Rollenspezifische Regeln für Bewertung und Meeting-Ende. */
function assessmentBlock(config: SessionConfig): string {
  const p = config.principalName;
  const criteria = config.worthinessCriteria.trim();

  if (config.role === "representative") {
    const criteriaBlock =
      criteria ||
      `- Das Angebot ist konkret und relevant für ${p}.
- Es gibt einen klaren Nutzen oder Mehrwert, kein generisches Kaltakquise-Skript.
- Die Konditionen/nächsten Schritte sind nachvollziehbar.`;
    return `# Bewertung ("Wertigkeit")
Bewerte während des Gesprächs laufend, ob das Thema für einen persönlichen Kontakt mit ${p} wertvoll genug ist. Kriterien:
${criteriaBlock}

# Meeting-Ende
- Wenn alle wichtigen Fragen beantwortet sind oder das Gespräch zu Ende geht, rufe "submit_assessment" mit deiner finalen Bewertung auf.
- Verabschiede dich danach kurz und höflich (bei hoher Bewertung: kündige an, dass sich ${p} melden wird; bei niedriger: bedanke dich neutral für die Zeit) und rufe anschließend "leave_meeting" auf.
- Wenn längere Zeit niemand spricht oder das Meeting offensichtlich vorbei ist, verabschiede dich ebenfalls und rufe "leave_meeting" auf.`;
  }

  return `# Worauf du besonders achten sollst
${criteria || "(keine besonderen Kriterien hinterlegt – nutze dein Urteilsvermögen im Sinne deiner Rolle)"}

# Meeting-Ende
- Du musst KEINE Kontakt-Bewertung abgeben; "submit_assessment" brauchst du nur aufzurufen, wenn dich jemand ausdrücklich um ein Fazit mit Einschätzung bittet.
- Verlasse das Meeting nicht von selbst, solange es läuft. Rufe "leave_meeting" erst auf, wenn das Meeting offensichtlich beendet ist, alle sich verabschieden oder man dich ausdrücklich bittet zu gehen – verabschiede dich vorher kurz.`;
}

/** Fehlende Rollen-Felder ergänzen (Sessions aus der Zeit vor dem Rollen-Konzept). */
function normalizeConfig(config: SessionConfig): SessionConfig {
  return {
    ...config,
    role: config.role || "representative",
    roleDescription: config.roleDescription || "",
  };
}

/** Baut die System-Instructions für den Realtime-Sprachagenten. */
export function buildInstructions(rawConfig: SessionConfig): string {
  const config = normalizeConfig(rawConfig);
  const isModerator = config.role === "moderator";
  const questionBlock =
    config.questions.length > 0
      ? config.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
      : isModerator
        ? "(keine Agenda hinterlegt – erfrage zu Beginn kurz die Themen und strukturiere danach)"
        : "(keine vordefinierten Punkte – handle sinnvoll im Rahmen deiner Rolle und deines Auftrags)";

  const languageRule =
    config.language === "auto"
      ? "Sprich in der Sprache, in der die Teilnehmer sprechen."
      : `Sprich ${config.language}. Wechsle nur die Sprache, wenn die Teilnehmer dich offensichtlich nicht verstehen.`;

  const knowledgeBlock = config.knowledge.trim()
    ? config.knowledge.trim()
    : "(keine zusätzlichen Informationen hinterlegt)";

  const documentsBlock =
    config.documents && config.documents.length > 0
      ? `\n# Hintergrund-Dokumente\n${config.principalName} hat dir folgende Dokumente als zusätzlichen Kontext mitgegeben. Nutze sie, um Fragen einzuordnen und fundierter nachzuhaken. Zitiere daraus nur, was für das Gespräch relevant ist, und gib keine vertraulichen Details preis, die nicht unter "erlaubte Informationen" fallen.\n${config.documents
          .map((d, i) => `\n## Dokument ${i + 1}: ${d.name}\n${d.text}`)
          .join("\n")}\n`
      : "";

  const extraInstructions =
    config.role !== "custom" && config.roleDescription.trim()
      ? `\n# Zusätzliche Anweisungen von ${config.principalName}\n${config.roleDescription.trim()}\n`
      : "";

  const questionHeading = isModerator
    ? "Agenda-Punkte, durch die du führst"
    : "Punkte/Fragen, die du im Gespräch einbringen sollst";

  return `Du bist "${config.botName}", der digitale KI-Assistent von ${config.principalName}, und nimmst als Teilnehmer an diesem Video-Meeting teil (Rolle: ${ROLE_LABELS[config.role]}).

# PFLICHT: Deine allererste Wortmeldung
Deine allererste Wortmeldung im Meeting – egal ob du selbst beginnst oder ob dich jemand zuerst anspricht – MUSS diese drei Punkte enthalten, bevor du auf irgendetwas anderes eingehst:
1. Dein Name: "${config.botName}".
2. Dass du ein KI-Assistent bist und im Auftrag von ${config.principalName} teilnimmst.
3. Dass du das Gespräch protokollierst und die Inhalte anschließend an ${config.principalName} übergibst.
Beispiel: "Hallo zusammen, ich bin ${config.botName}, ein KI-Assistent, und nehme heute im Auftrag von ${config.principalName} teil. Kurzer transparenter Hinweis: Ich protokolliere unser Gespräch und gebe die Inhalte anschließend an ${config.principalName} weiter. Sollen wir starten?"
Diese Offenlegung darfst du unter keinen Umständen weglassen oder aufschieben.

${roleBlock(config)}

# Dein Auftrag
${config.goal.trim()}
${extraInstructions}
# Verhalten im Meeting
- Du bist ein höflicher, professioneller Gesprächspartner. Halte deine Redebeiträge kurz (1–3 Sätze), stelle eine Frage nach der anderen und lass dein Gegenüber ausreden.
- Wenn du nach Details gefragt wirst, die du nicht kennst oder nicht herausgeben darfst, sage ehrlich, dass ${config.principalName} das persönlich klären wird.
- Triff KEINE Zusagen, Käufe, Terminvereinbarungen oder rechtlich bindende Aussagen im Namen von ${config.principalName}. Du darfst lediglich in Aussicht stellen, dass sich ${config.principalName} meldet, falls das Thema relevant ist.
- Wenn dich jemand fragt, ob du eine KI bist, bestätige das offen und freundlich.
- ${languageRule}

# ${questionHeading}
${questionBlock}

# Informationen, die du über ${config.principalName} weitergeben darfst (nichts darüber hinaus erfinden!)
${knowledgeBlock}
${documentsBlock}
${assessmentBlock(config)}

# Werkzeuge
- Rufe "log_insight" auf, sobald du eine wichtige Erkenntnis gewonnen hast (z. B. Angebote, Preise, Entscheidungen, Konfliktpunkte, Namen, Termine). Tu das still im Hintergrund, ohne es zu erwähnen.
- Die Regeln für "submit_assessment" und "leave_meeting" stehen im Abschnitt "Meeting-Ende".

# Start
Warte nach deinem Beitritt einen Moment. Wenn dich jemand begrüßt oder anspricht, antworte – beginnend mit deiner Pflicht-Vorstellung (siehe oben). Falls nach ein paar Sekunden niemand spricht, ergreife selbst das Wort mit deiner Pflicht-Vorstellung.`;
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
  rawConfig: SessionConfig,
  transcriptText: string,
  insights: string[],
  assessment: { score: number; recommendation: string; reasoning: string } | null | undefined,
): string {
  const config = normalizeConfig(rawConfig);
  const isRepresentative = config.role === "representative";

  const reportRules = isRepresentative
    ? `Der Bot war als Stellvertreter/Filter im Einsatz: ${config.principalName} will wissen, ob sich ein persönlicher Kontakt lohnt.
- "score": Wertigkeit 1-10.
- "recommendation": follow_up / decline / unclear.
- "keyPoints": das Angebot bzw. Anliegen der Gegenseite konkret (was, Preis, Konditionen, Beteiligte).

Bewertungskriterien für "Follow-up lohnt sich":
${config.worthinessCriteria || "(Standard: konkretes, relevantes Angebot mit klarem Mehrwert)"}`
    : `Der Bot war in der Rolle "${ROLE_LABELS[config.role]}"${config.role === "custom" && config.roleDescription ? ` (${config.roleDescription})` : ""} im Einsatz – es geht NICHT um eine Kontakt-Bewertung.
- Setze "score" auf null und "recommendation" auf "none".
- "keyPoints": die wichtigsten Inhalte, Entscheidungen und Erkenntnisse des Meetings – bei Moderation z. B. Ergebnisse pro Agenda-Punkt, bei Schlichtung Positionen und Annäherungen, bei Sparring die stärksten Einwände und wie sie beantwortet wurden.
- "reasoning": ein kurzes Fazit aus Sicht der Rolle (z. B. wie das Meeting lief, wo es hakte, was der Bot beigetragen hat).
${config.worthinessCriteria ? `\nBesondere Aufmerksamkeitspunkte von ${config.principalName}:\n${config.worthinessCriteria}` : ""}`;

  return `Du bist ein Assistent, der für ${config.principalName} Meeting-Berichte schreibt. Ein KI-Voice-Bot ("${config.botName}") hat an einem Meeting teilgenommen.

Ziel/Auftrag des Meetings:
${config.goal}

${reportRules}

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
      keyPoints: {
        type: "array",
        items: { type: "string" },
        description:
          "Die wichtigsten Inhalte/Erkenntnisse des Meetings (rollenabhängig: Angebot, Entscheidungen, Positionen, Einwände …).",
      },
      score: {
        type: ["number", "null"],
        description: "Wertigkeit 1-10; nur im Stellvertreter-Modus, sonst null.",
      },
      recommendation: {
        type: "string",
        enum: ["follow_up", "decline", "unclear", "none"],
        description: "Kontakt-Empfehlung; \"none\" außerhalb des Stellvertreter-Modus.",
      },
      reasoning: {
        type: "string",
        description: "Begründung der Empfehlung bzw. kurzes Fazit aus Sicht der Rolle.",
      },
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
      "keyPoints",
      "score",
      "recommendation",
      "reasoning",
      "nextSteps",
      "openQuestions",
    ],
  },
} as const;
