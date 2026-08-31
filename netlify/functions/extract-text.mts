import type { Config } from "@netlify/functions";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { checkDashboardAuth, errorResponse, json } from "../lib/http.mts";

export const config: Config = {
  path: "/api/extract-text",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
/** Obergrenze pro Dokument – die Instructions der Sprach-KI sind begrenzt. */
export const MAX_DOC_CHARS = 12000;

/**
 * Nimmt eine Datei (multipart/form-data, Feld "file") entgegen und gibt den
 * extrahierten Text zurück. Unterstützt: .txt, .md, .pdf, .docx
 */
export default async (req: Request) => {
  if (req.method !== "POST") return errorResponse("Methode nicht erlaubt.", 405);

  const authError = checkDashboardAuth(req);
  if (authError) return authError;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse("Erwarte multipart/form-data mit einem Feld \"file\".");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse("Keine Datei erhalten.");
  if (file.size > MAX_FILE_BYTES) return errorResponse("Datei zu groß (max. 8 MB).");

  const name = file.name || "dokument";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";

  try {
    let text: string;
    if (ext === "txt" || ext === "md") {
      text = await file.text();
    } else if (ext === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const result = await extractText(pdf, { mergePages: true });
      text = result.text;
    } else if (ext === "docx") {
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(await file.arrayBuffer()),
      });
      text = result.value;
    } else if (ext === "doc") {
      return errorResponse(
        "Das alte .doc-Format wird nicht unterstützt – bitte in Word als .docx oder PDF speichern.",
      );
    } else {
      return errorResponse("Nicht unterstütztes Format. Erlaubt: .txt, .md, .pdf, .docx");
    }

    text = text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!text) {
      return errorResponse(
        `Aus "${name}" konnte kein Text extrahiert werden (evtl. ein gescanntes PDF ohne Textebene?).`,
      );
    }

    const truncated = text.length > MAX_DOC_CHARS;
    if (truncated) text = text.slice(0, MAX_DOC_CHARS);

    return json({ name, text, chars: text.length, truncated });
  } catch (err: any) {
    console.error("extract-text error:", err);
    return errorResponse(`"${name}" konnte nicht verarbeitet werden: ${err?.message || err}`, 500);
  }
};
