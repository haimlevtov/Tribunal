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
      <h1>The Tribunal</h1>
      <p className="sub">
        Four advocates argue the charge — two for the accused, two against. Three judges
        then rule independently, without seeing each other&apos;s verdicts. The tribunal
        returns three verdicts and the reasoning behind each. The decision is yours.
      </p>

      <ChargeSheetForm
        choices={choices}
        defaultModel={DEFAULT_UNIFORM_MODEL}
        seats={personas}
        perCharacterLabels={perCharacterLabels}
        requiresAccessCode={Boolean(process.env.TRIBUNAL_ACCESS_CODE)}
      />
    </main>
  );
}
