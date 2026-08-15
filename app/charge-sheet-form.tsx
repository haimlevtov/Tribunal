"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CHARGE_SHEET_MAX, CHARGE_SHEET_MIN, PERSONA_NAME_MAX } from "@/lib/schemas";

interface Seat {
  key: string;
  name: string;
  role: string;
  seatIndex: number;
  blurb: string;
}

interface Props {
  choices: Array<{ id: string; label: string }>;
  defaultModel: string;
  seats: Seat[];
  perCharacterLabels: Record<string, string>;
  requiresAccessCode: boolean;
}

type ModelMode = "uniform" | "per_character";
type CastMode = "default" | "named" | "auto";

const EXAMPLE = `The accused, a night-shift systems engineer, disabled the automated alerting for a production database for six hours on the evening of 14 March, in order to complete a migration without being interrupted. During that window an unrelated disk fault went unreported and 40 minutes of customer records were lost.

The accused states that the alerting had produced 200 false alarms that month, that the migration had already been postponed twice, and that no written policy forbade silencing alerts. The charge is negligence in the discharge of duty.`;

/** Suggestions, not defaults — they only appear as input placeholders. */
const NAME_HINTS: Record<string, string> = {
  defence_1: "e.g. Atticus Finch",
  defence_2: "e.g. a tired public defender",
  prosecution_1: "e.g. Javert",
  prosecution_2: "e.g. a forensic accountant",
  judge_1: "e.g. Judge Judy",
  judge_2: "e.g. Marcus Aurelius",
  judge_3: "e.g. my grandmother",
};

const SIDE_LABEL: Record<string, string> = {
  advocate_for: "for the accused",
  advocate_against: "against the accused",
  judge: "judge",
};

export default function ChargeSheetForm({
  choices,
  defaultModel,
  seats,
  perCharacterLabels,
  requiresAccessCode,
}: Props) {
  const router = useRouter();
  const [chargeSheet, setChargeSheet] = useState("");
  const [modelMode, setModelMode] = useState<ModelMode>("uniform");
  const [castMode, setCastMode] = useState<CastMode>("default");
  const [names, setNames] = useState<Record<string, string>>({});
  const [model, setModel] = useState(defaultModel);
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = chargeSheet.trim().length < CHARGE_SHEET_MIN;
  const namedButEmpty =
    castMode === "named" && Object.values(names).every((v) => !v?.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const character_names = Object.entries(names)
      .filter(([, v]) => v.trim())
      .map(([key, name]) => ({ key, name: name.trim() }));

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          charge_sheet: chargeSheet.trim(),
          model_mode: modelMode,
          character_mode: castMode,
          ...(modelMode === "uniform" ? { uniform_model_id: model } : {}),
          ...(castMode === "named" ? { character_names } : {}),
          ...(requiresAccessCode ? { access_code: accessCode } : {}),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "The tribunal could not be convened.");
        setBusy(false);
        return;
      }
      router.push(`/run/${json.run_id}`);
    } catch {
      setError("Network error. Is the dev server still running?");
      setBusy(false);
    }
  }

  const advocates = seats.filter((s) => s.role !== "judge");
  const judges = seats.filter((s) => s.role === "judge");

  return (
    <>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="cs">The charge sheet</label>
          <textarea
            id="cs"
            value={chargeSheet}
            onChange={(e) => setChargeSheet(e.target.value.slice(0, CHARGE_SHEET_MAX))}
            placeholder="Describe the accused, what they are alleged to have done, and any circumstances the tribunal should weigh…"
            required
          />
          <div className="counter">
            {chargeSheet.length} / {CHARGE_SHEET_MAX}
            {chargeSheet.length === 0 && (
              <>
                {" · "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setChargeSheet(EXAMPLE);
                  }}
                >
                  use an example
                </a>
              </>
            )}
          </div>
        </div>

        <div className="field">
          <label>Who sits on the tribunal</label>
          <div className="modes modes-3">
            <div
              className={`mode${castMode === "default" ? " on" : ""}`}
              onClick={() => setCastMode("default")}
            >
              <div className="t">
                <input
                  type="radio"
                  name="cast"
                  checked={castMode === "default"}
                  onChange={() => setCastMode("default")}
                />
                The standing cast
              </div>
              <div className="d">
                The seven characters below. Known quantities — use these for a
                repeatable run.
              </div>
            </div>

            <div
              className={`mode${castMode === "named" ? " on" : ""}`}
              onClick={() => setCastMode("named")}
            >
              <div className="t">
                <input
                  type="radio"
                  name="cast"
                  checked={castMode === "named"}
                  onChange={() => setCastMode("named")}
                />
                Name them yourself
              </div>
              <div className="d">
                You give each seat a name — real, fictional, or a description. The
                backend writes the personality to match.
              </div>
            </div>

            <div
              className={`mode${castMode === "auto" ? " on" : ""}`}
              onClick={() => setCastMode("auto")}
            >
              <div className="t">
                <input
                  type="radio"
                  name="cast"
                  checked={castMode === "auto"}
                  onChange={() => setCastMode("auto")}
                />
                Let the system decide
              </div>
              <div className="d">
                The backend invents a cast chosen to make <em>this</em> case hard to
                settle.
              </div>
            </div>
          </div>
          {castMode !== "default" && (
            <div className="counter">
              Adds one model call to the run (8 instead of 7). Still free.
            </div>
          )}
        </div>

        {castMode === "named" && (
          <div className="field">
            <label>The seven seats</label>
            <div className="seat-grid">
              {seats.map((s) => (
                <div className="seat" key={s.key}>
                  <div className="seat-role">
                    <span
                      className={`tag ${
                        s.role === "advocate_for"
                          ? "for"
                          : s.role === "advocate_against"
                            ? "against"
                            : "model"
                      }`}
                    >
                      {SIDE_LABEL[s.role]}
                    </span>
                  </div>
                  <input
                    type="text"
                    maxLength={PERSONA_NAME_MAX}
                    placeholder={NAME_HINTS[s.key] ?? "a character"}
                    value={names[s.key] ?? ""}
                    onChange={(e) =>
                      setNames((n) => ({ ...n, [s.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <div className="counter">
              Leave any seat blank and the backend will invent that one. A name that
              contradicts its side keeps the name — the seat always wins.
            </div>
          </div>
        )}

        <div className="field">
          <label>Model configuration</label>
          <div className="modes">
            <div
              className={`mode${modelMode === "uniform" ? " on" : ""}`}
              onClick={() => setModelMode("uniform")}
            >
              <div className="t">
                <input
                  type="radio"
                  name="mode"
                  checked={modelMode === "uniform"}
                  onChange={() => setModelMode("uniform")}
                />
                One model, seven personalities
              </div>
              <div className="d">
                All four advocates and all three judges run on the same model.
                Differences come purely from personality — the clean experiment.
              </div>
            </div>

            <div
              className={`mode${modelMode === "per_character" ? " on" : ""}`}
              onClick={() => setModelMode("per_character")}
            >
              <div className="t">
                <input
                  type="radio"
                  name="mode"
                  checked={modelMode === "per_character"}
                  onChange={() => setModelMode("per_character")}
                />
                A different model per character
              </div>
              <div className="d">
                Seven distinct models, one per seat. More varied, but personality and
                model are now confounded.
              </div>
            </div>
          </div>
        </div>

        {modelMode === "uniform" && (
          <div className="field">
            <label htmlFor="model">Model for all seven</label>
            <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="counter">
              <span className="free">Every option is free</span> — this run costs $0.00.
            </div>
          </div>
        )}

        {requiresAccessCode && (
          <div className="field">
            <label htmlFor="code">Access code</label>
            <input
              id="code"
              type="password"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              required
            />
          </div>
        )}

        {error && <div className="err">{error}</div>}

        <button className="primary" type="submit" disabled={busy || tooShort || namedButEmpty}>
          {busy ? "Convening…" : "Convene the tribunal"}
        </button>
        {namedButEmpty && (
          <div className="counter" style={{ textAlign: "left", marginTop: "0.6rem" }}>
            Name at least one seat, or switch to another cast mode.
          </div>
        )}
      </form>

      {castMode === "default" && (
        <>
          <h2>The advocates</h2>
          {advocates.map((s) => (
            <div className="card" key={s.key}>
              <h3>
                {s.name}{" "}
                <span className={`tag ${s.role === "advocate_for" ? "for" : "against"}`}>
                  {SIDE_LABEL[s.role]}
                </span>
              </h3>
              <div className="meta">
                {s.blurb}
                {modelMode === "per_character" && perCharacterLabels[s.key] && (
                  <>
                    {" · "}
                    <span className="tag model">{perCharacterLabels[s.key]}</span>
                  </>
                )}
              </div>
            </div>
          ))}

          <h2>The bench</h2>
          {judges.map((s) => (
            <div className="card" key={s.key}>
              <h3>{s.name}</h3>
              <div className="meta">
                {s.blurb}
                {modelMode === "per_character" && perCharacterLabels[s.key] && (
                  <>
                    {" · "}
                    <span className="tag model">{perCharacterLabels[s.key]}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
