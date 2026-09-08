import ChargeSheetForm from "./charge-sheet-form";
import {
  DEFAULT_UNIFORM_MODEL,
  nominalSeatCostUsd,
  PER_CHARACTER_MODELS,
  uniformChoices,
} from "@/lib/models";
import { publicPersonaInfo } from "@/lib/personas";

/**
 * Server component: decides what is safe to hand the browser. Persona system
 * prompts and the judging rubric never cross this boundary — only names, blurbs,
 * and model labels do.
 */
export default function Home() {
  // A run is seven seats, so a per-seat price is the wrong unit to show someone
  // deciding: quote them the whole tribunal.
  const choices = uniformChoices().map((m) => ({
    id: m.id,
    label: m.label,
    free: m.free,
    runCostUsd: nominalSeatCostUsd(m) * 7,
  }));
  const personas = publicPersonaInfo();
  const perCharacterLabels = Object.fromEntries(
    Object.entries(PER_CHARACTER_MODELS).map(([k, m]) => [k, m.label]),
  );

  return (
    <main className="wrap">
      {/* The head of the filing, matching the caption on the record itself. */}
      <div className="cap">
        <div>
          <div className="cap-court">Notice of hearing</div>
          <h1>Convene a tribunal</h1>
        </div>
        <div className="docket">
          FORM <b>T-1</b>
          <br />
          SEATS <b>7</b>
          <br />
          BENCH <b>3</b>
        </div>
      </div>

      <div className="record">
        <p className="preamble">
          Four advocates argue the charge — two for the accused, two against. Three judges
          then rule independently, without sight of one another. The record returns three
          verdicts and the reasoning behind each. It does not consolidate them; the
          decision is yours.
        </p>

        <ChargeSheetForm
          choices={choices}
          defaultModel={DEFAULT_UNIFORM_MODEL}
          seats={personas}
          perCharacterLabels={perCharacterLabels}
          requiresAccessCode={Boolean(process.env.TRIBUNAL_ACCESS_CODE)}
        />
      </div>
    </main>
  );
}
