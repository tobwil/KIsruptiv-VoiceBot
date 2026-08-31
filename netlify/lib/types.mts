export type SessionStatus =
  | "created" // Bot wurde bei Recall angelegt
  | "joining" // Bot betritt das Meeting / wartet auf Einlass
  | "in_call" // Bot ist im Meeting
  | "ended" // Meeting/Bot beendet, Bericht noch nicht fertig
  | "report_ready" // Abschlussbericht liegt vor
  | "error";

/** Rolle/Modus des Bots im Meeting. */
export type BotRole =
  | "representative" // Stellvertreter & Filter (Original-Use-Case: nimmt statt dir teil, bewertet Wertigkeit)
  | "expert" // Wissensmedium: beantwortet Fragen aus Wissen/Dokumenten
  | "moderator" // führt durch Agenda, achtet auf Struktur und Redezeit
  | "mediator" // Schlichter: deeskaliert, arbeitet Gemeinsamkeiten heraus
  | "provocateur" // Sparringspartner/Advocatus Diaboli: hinterfragt pointiert
  | "custom"; // frei beschriebene Rolle

export interface SessionConfig {
  meetingUrl: string;
  botName: string;
  /** Name der Person, die der Bot vertritt bzw. begleitet (z. B. "Tobias"). */
  principalName: string;
  /** Rolle/Modus des Bots. */
  role: BotRole;
  /** Freie Rollenbeschreibung (bei role = custom) bzw. zusätzliche Anweisungen. */
  roleDescription: string;
  /** Ziel/Auftrag des Meetings aus Sicht des Nutzers. */
  goal: string;
  /** Vordefinierte Fragen/Agenda-Punkte, die der Bot einbringen soll. */
  questions: string[];
  /** Wissen/Fakten, die der Bot als Antworten verwenden darf. */
  knowledge: string;
  /**
   * Bewertungs-/Fokus-Kriterien. Im Stellvertreter-Modus: wann ist ein Thema
   * "wertig" genug für echten Kontakt; in anderen Rollen: worauf besonders achten.
   */
  worthinessCriteria: string;
  /** Gesprächssprache, z. B. "Deutsch", "Englisch" oder "auto". */
  language: string;
  /** OpenAI-Realtime-Stimme, z. B. "marin". */
  voice: string;
  /** Hochgeladene Kontext-Dokumente (bereits als Text extrahiert). */
  documents?: { name: string; text: string }[];
}

export interface Assessment {
  score: number; // 1-10
  recommendation: "follow_up" | "decline" | "unclear";
  reasoning: string;
  nextSteps?: string;
}

/** Session-basierte API-Keys aus dem Dev-Tab (Alternative zu env-Variablen). */
export interface DevKeys {
  recallApiKey?: string;
  recallRegion?: string;
  openaiApiKey?: string;
}

export interface Session {
  id: string;
  createdAt: string;
  status: SessionStatus;
  config: SessionConfig;
  /** Geheimer Token, mit dem sich die Agent-Seite gegenüber der API ausweist. */
  agentToken: string;
  /**
   * Beim Meeting-Start hinterlegte Dev-Keys. Nötig, damit auch die Agent-Seite
   * (läuft im Recall-Browser, ohne Zugriff auf den localStorage des Nutzers)
   * und die Berichtserstellung die Keys nutzen können. Wird nie an Clients ausgeliefert.
   */
  devKeys?: DevKeys;
  recallBotId?: string;
  recallStatus?: string;
  assessment?: Assessment | null;
  hasReport?: boolean;
  error?: string;
  endedAt?: string;
}

export interface TranscriptLine {
  role: "participant" | "bot";
  text: string;
  ts: number;
}

export interface TranscriptData {
  transcript: TranscriptLine[];
  insights: { text: string; ts: number }[];
  assessment?: Assessment | null;
}

export interface Report {
  summary: string;
  /** Kernpunkte/Erkenntnisse des Gesprächs. */
  keyPoints: string[];
  /** Wertigkeits-Score 1-10; nur im Stellvertreter-Modus, sonst null. */
  score: number | null;
  /** Kontakt-Empfehlung; "none" außerhalb des Stellvertreter-Modus. */
  recommendation: "follow_up" | "decline" | "unclear" | "none";
  reasoning: string;
  nextSteps: string[];
  openQuestions: string[];
  generatedAt: string;
  /** Nur in Alt-Berichten vorhanden (früheres Schema). */
  offerDescription?: string;
}

/** Öffentliche Sicht auf eine Session (ohne agentToken und devKeys). */
export function publicSession(s: Session): Omit<Session, "agentToken" | "devKeys"> {
  const { agentToken, devKeys, ...rest } = s;
  return rest;
}
