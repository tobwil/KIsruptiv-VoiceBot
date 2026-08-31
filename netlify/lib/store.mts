import { getStore } from "@netlify/blobs";
import type { Report, Session, TranscriptData } from "./types.mts";

function store() {
  return getStore("voicebot");
}

export async function saveSession(session: Session): Promise<void> {
  await store().setJSON(`sessions/${session.id}`, session);
}

export async function getSession(id: string): Promise<Session | null> {
  return (await store().get(`sessions/${id}`, { type: "json" })) as Session | null;
}

export async function listSessions(): Promise<Session[]> {
  const { blobs } = await store().list({ prefix: "sessions/" });
  const sessions = await Promise.all(
    blobs.map((b) => store().get(b.key, { type: "json" }) as Promise<Session | null>),
  );
  return sessions
    .filter((s): s is Session => s !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveTranscript(id: string, data: TranscriptData): Promise<void> {
  await store().setJSON(`transcripts/${id}`, data);
}

export async function getTranscript(id: string): Promise<TranscriptData | null> {
  return (await store().get(`transcripts/${id}`, { type: "json" })) as TranscriptData | null;
}

export async function saveReport(id: string, report: Report): Promise<void> {
  await store().setJSON(`reports/${id}`, report);
}

export async function getReport(id: string): Promise<Report | null> {
  return (await store().get(`reports/${id}`, { type: "json" })) as Report | null;
}

/** Löscht alle Daten einer Session: Konfiguration, Transkript und Bericht. */
export async function deleteSessionData(id: string): Promise<void> {
  const s = store();
  await Promise.all([
    s.delete(`sessions/${id}`),
    s.delete(`transcripts/${id}`),
    s.delete(`reports/${id}`),
  ]);
}
