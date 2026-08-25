import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractDossier } from "@/lib/dossier";
import { extractPdfText, PdfError } from "@/lib/pdf";
import { DOSSIER_BYTES_MAX } from "@/lib/schemas";
import { describeSetupError } from "@/lib/setup-errors";

export const runtime = "nodejs";
// PDF parse plus one model call. Normally ~20s, but a busy free model can send
// the request down the whole fallback chain, so take the full Hobby ceiling.
export const maxDuration = 300;

/**
 * Upload a case dossier. Extracts the text, reads the charge sheet and the seven
 * characters out of it in one model call, and stores the result.
 *
 * The response deliberately withholds each character's `body`: like every other
 * cast mode, system prompts stay server-side. The browser gets names, blurbs,
 * and a dossier id to hand back when the run is created.
 */
export async function POST(request: Request) {
  let file: File | null = null;

  try {
    const form = await request.formData();
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return NextResponse.json(
      { error: "Upload a PDF as multipart form data." },
      { status: 400 },
    );
  }

  if (!file) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  if (file.size > DOSSIER_BYTES_MAX) {
    return NextResponse.json(
      {
        error: `That PDF is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${
          DOSSIER_BYTES_MAX / 1024 / 1024
        }MB.`,
      },
      { status: 413 },
    );
  }

  const name = file.name ?? "";
  if (!/\.pdf$/i.test(name) && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 415 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text, pageCount } = await extractPdfText(bytes);

    const extracted = await extractDossier(text);

    const { data, error } = await db()
      .from("dossiers")
      .insert({
        filename: name.slice(0, 200),
        page_count: pageCount,
        char_count: text.length,
        charge_sheet: extracted.chargeSheet || null,
        characters: extracted.characters,
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(`could not save dossier: ${error?.message}`);

    return NextResponse.json({
      dossier_id: data.id,
      case_title: extracted.caseTitle,
      charge_sheet: extracted.chargeSheet,
      page_count: pageCount,
      // Bodies are withheld on purpose — see the note above.
      characters: extracted.characters.map(({ key, name: n, blurb, source }) => ({
        key,
        name: n,
        blurb,
        source,
      })),
    });
  } catch (err) {
    if (err instanceof PdfError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/dossier]", message);
    const described = describeSetupError(message);
    return NextResponse.json(
      {
        error:
          described === "Could not start the tribunal."
            ? "Could not read that dossier. The free models may be busy — try again in a moment."
            : described,
      },
      { status: 500 },
    );
  }
}
