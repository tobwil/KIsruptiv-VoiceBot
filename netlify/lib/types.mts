export type SessionStatus =
  | "created" // Bot wurde bei Recall angelegt
  | "joining" // Bot betritt das Meeting / wartet auf Einlass
  | "in_call" // Bot ist im Meeting
  | "ended" // Meeting/Bot beendet, Bericht noch nicht fertig
  | "report_ready" // Abschlussbericht liegt vor
  | "error";

export interface SessionConfig {
  meetingUrl: string;
  botName: string;
  /** Name der Person, die der Bot vertritt (z. B. "Tobias"). */
  principalName: string;
  /** Ziel des Meetings aus Sicht des Nutzers. */
  goal: string;
  /** Vordefinierte Fragen, die der Bot stellen soll. */
  questions: string[];
  /** Wissen/Fakten, die der Bot als Antworten verwenden darf. */
  knowledge: string;
  /** Kriterien, wann ein Thema "wertig" genug für echten Kontakt ist. */
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
  offerDescription: string;
  score: number;
  recommendation: "follow_up" | "decline" | "unclear";
  reasoning: string;
  nextSteps: string[];
  openQuestions: string[];
  generatedAt: string;
}

/** Öffentliche Sicht auf eine Session (ohne agentToken und devKeys). */
export function publicSession(s: Session): Omit<Session, "agentToken" | "devKeys"> {
  const { agentToken, devKeys, ...rest } = s;
  return rest;
}
