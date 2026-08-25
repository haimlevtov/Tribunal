import { DOSSIER_TEXT_MAX } from "./schemas";

/**
 * PDF text extraction, server-side.
 *
 * Uses pdfjs-dist's *legacy* build: the modern build assumes browser globals and
 * a worker, neither of which exist in a serverless Node function. The legacy
 * build runs in-process, which is what we want for a single short document.
 */

export interface PdfText {
  text: string;
  pageCount: number;
}

export class PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfError";
  }
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  // Imported lazily so the ~10MB library never loads on requests that don't
  // touch a PDF, and never gets pulled into an edge/browser bundle.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Registers the in-process ("fake") worker by side effect. Preferred over
  // pointing GlobalWorkerOptions.workerSrc at a path: the bundled serverless
  // layout is not the node_modules layout, so a resolved path would break on
  // Vercel while working locally.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      // A dossier is text; skip the parts that only matter for rendering.
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new PdfError(
      /password/i.test(why)
        ? "That PDF is password-protected. Remove the password and try again."
        : `That file could not be read as a PDF (${why.slice(0, 120)}).`,
    );
  }

  const parts: string[] = [];
  let total = 0;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    // pdfjs emits positioned fragments, not lines. `hasEOL` marks where the
    // original layout broke a line; without honouring it the whole page arrives
    // as one run-on paragraph and section headings stop being recognisable.
    let pageText = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      pageText += item.str;
      if (item.hasEOL) pageText += "\n";
      else if (item.str && !item.str.endsWith(" ")) pageText += " ";
    }

    const cleaned = pageText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    parts.push(cleaned);
    total += cleaned.length;

    page.cleanup();
    if (total > DOSSIER_TEXT_MAX) break;
  }

  const text = parts.join("\n\n").slice(0, DOSSIER_TEXT_MAX);

  if (text.replace(/\s/g, "").length < 200) {
    throw new PdfError(
      "No text could be read from that PDF. If it is a scan, it needs OCR first — this reads text, not images.",
    );
  }

  return { text, pageCount: doc.numPages };
}
