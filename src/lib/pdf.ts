import { extractText } from "unpdf";

/** Plain text of a base64 PDF, for models that cannot read PDF files (Ollama). */
export async function pdfToText(base64: string): Promise<string> {
  const { text } = await extractText(new Uint8Array(Buffer.from(base64, "base64")), { mergePages: true });
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
