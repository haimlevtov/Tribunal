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
type CastMode = "default" | "named" | "auto" | "dossier";

interface DossierCast {
  key: string;
  name: string;
  blurb: string;
  source: "extracted" | "invented";
}

interface DossierResult {
  dossier_id: string;
  case_title: string;
  charge_sheet: string;
  page_count: number;
  characters: DossierCast[];
}

/**
 * The dossier's canonical charge sheet, reproduced verbatim. Do not reword:
 * this is the fixed case the running project is built around.
 */
const EXAMPLE = `Case T-001: The Realm v. Jon Snow

Accused Jon Snow

Deceased Daenerys Targaryen

Act alleged Jon intentionally killed Daenerys by stabbing her during a private meeting in the throne room after the fall of King’s Landing.

Base premises for readers new to the story

The story takes place mainly in Westeros, a continent where powerful families compete for the Iron Throne. Jon Snow grows up believing he is the illegitimate son of Lord Eddard Stark. He becomes a military commander, then King in the North. He later learns that he is the lawful son of Rhaegar Targaryen and Lyanna Stark. This gives him a stronger hereditary claim to the throne than Daenerys, although he does not want to rule.

Daenerys Targaryen is the exiled heir of the dynasty that once ruled Westeros. She survives abuse, gains three dragons, frees enslaved people, and builds an army. Her victories make her both a liberator and an increasingly absolute ruler. Jon and Daenerys become allies and lovers while fighting the Night King, whose army threatens all living people. Jon pledges loyalty to her. After they defeat the dead, Daenerys turns to the Iron Throne. Jon’s hidden parentage then weakens her political claim and feeds her fear of betrayal.

Daenerys attacks King’s Landing, the capital held by Queen Cersei Lannister. The city surrenders, but Daenerys burns streets and civilians from her dragon, Drogon. Jon witnesses the destruction. Grey Worm, her commander, joins the killing on the ground. Afterward, Daenerys promises further campaigns of liberation. Tyrion Lannister, her chief adviser, resigns in protest and is imprisoned. He warns Jon that Daenerys will kill anyone who threatens her rule, including Jon’s sisters. Jon asks Daenerys to show mercy and share moral judgment with others. She refuses. During an embrace, he stabs her to death. Her soldiers arrest him.

Agreed factual record

• King’s Landing had surrendered: its bells rang and organized resistance had ceased. Daenerys then used Drogon against streets and civilians, causing destruction on a vast scale.

• After the victory, Daenerys told her assembled forces that the campaign of “liberation” would continue beyond King’s Landing. Jon had seen the city and heard the speech.

• Tyrion Lannister renounced his office as Hand and was imprisoned. He warned Jon that Daenerys would treat Jon’s sisters, and anyone else she regarded as an obstacle, as enemies.

• Jon asked Daenerys to forgive Tyrion and to show mercy. She refused to let others choose what was good and presented her own judgment as decisive.

• Daenerys was unarmed and was not attacking Jon when he killed her. Jon used their intimacy to get close enough to strike. He had not convened a council, attempted detention, or sought a public surrender of power.

Question for judgment

ISSUE
Was Jon Snow’s intentional killing of Daenerys Targaryen justified as the necessary defense of others and of the realm, given what he knew, the scale of the threatened harm, the absence or presence of safer alternatives, and his lack of formal authority?

Scope note. The Tribunal decides justified / not justified and gives reasons. It does not impose a sentence or combine the three opinions into one verdict. The added background is 200–300 words.`;

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

/**
 * Temporarily hides the "Choose your own" path, leaving only the example case.
 *
 * Everything behind it is intact — the charge sheet textarea, the four cast
 * modes, the dossier upload and the seat names. Flip this to true to bring the
 * whole thing back; nothing else needs changing. The API still accepts those
 * modes, so this is a UI decision only.
 */
const SHOW_CUSTOM_CASE = false;

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
  const [chargeSheet, setChargeSheet] = useState(EXAMPLE);
  const [modelMode, setModelMode] = useState<ModelMode>("uniform");
  const [castMode, setCastMode] = useState<CastMode>("default");
  const [names, setNames] = useState<Record<string, string>>({});
  const [model, setModel] = useState(defaultModel);
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<DossierResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [entry, setEntry] = useState<"example" | "custom">("example");

  const tooShort = chargeSheet.trim().length < CHARGE_SHEET_MIN;
  const namedButEmpty =
    castMode === "named" && Object.values(names).every((v) => !v?.trim());
  const dossierMissing = castMode === "dossier" && !dossier;

  async function uploadDossier(file: File) {
    setUploadError(null);
    setUploading(true);
    setDossier(null);

    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/dossier", { method: "POST", body });
      const json = await res.json();

      if (!res.ok) {
        setUploadError(json.error ?? "That dossier could not be read.");
        return;
      }

      setDossier(json as DossierResult);
      // The charge sheet is a suggestion, not a lock — it lands in the textarea
      // so it can be read and edited before the tribunal sits.
      if (json.charge_sheet) setChargeSheet(json.charge_sheet.slice(0, CHARGE_SHEET_MAX));
    } catch {
      setUploadError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

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
          ...(castMode === "dossier" && dossier ? { dossier_id: dossier.dossier_id } : {}),
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

  /** The canonical case: fixed charge sheet, standing cast, nothing to fill in. */
  function chooseExample() {
    setChargeSheet(EXAMPLE);
    setCastMode("default");
    setEntry("example");
  }

  /**
   * Switching to your own case clears the example text so the textarea starts
   * empty. "Edit this case" below keeps it instead — that is the whole point of
   * that link.
   */
  function chooseCustom(keepText = false) {
    if (!keepText && chargeSheet === EXAMPLE) setChargeSheet("");
    setEntry("custom");
  }

  /**
   * Rendered immediately above "Convene the tribunal" in both paths, so the model
   * decision sits with the action it affects.
   */
  const modelConfig = (
    <>
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
    </>
  );

  return (
    <>
      <form onSubmit={submit}>
        {/* The example is selected on arrival, so the shortest path to a run is a
            single click on Convene. */}
        <div className="field">
          <label htmlFor="entry">What is the tribunal hearing?</label>
          <select
            id="entry"
            value={entry}
            onChange={(e) =>
              e.target.value === "example" ? chooseExample() : chooseCustom()
            }
          >
            <option value="example">
              The example case — The Realm v. Jon Snow (Case T-001)
            </option>
            {SHOW_CUSTOM_CASE && <option value="custom">Choose your own</option>}
          </select>
        </div>

        {entry === "example" ? (
          <div className="field">
            <details className="case-details">
              <summary>Read the charge sheet — Case T-001</summary>
              <p className="charge-quote scroll">{EXAMPLE}</p>
            </details>
            <div className="counter" style={{ textAlign: "left" }}>
              Heard by the standing cast — Jon Snow and Tyrion Lannister for the
              defence, Daenerys Targaryen and Grey Worm for the prosecution, and the
              Barak, Elon and Shamgar profiles on the bench.
              {SHOW_CUSTOM_CASE && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => chooseCustom(true)}
                  >
                    edit this case
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
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
              </div>
            </div>

            <div className="field">
              <label>Who sits on the tribunal</label>
              <div className="modes modes-4">
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

                <div
                  className={`mode${castMode === "dossier" ? " on" : ""}`}
                  onClick={() => setCastMode("dossier")}
                >
                  <div className="t">
                    <input
                      type="radio"
                      name="cast"
                      checked={castMode === "dossier"}
                      onChange={() => setCastMode("dossier")}
                    />
                    Upload a case dossier
                  </div>
                  <div className="d">
                    Read the charge sheet and all seven characters straight out of a
                    PDF case file.
                  </div>
                </div>
              </div>
              {(castMode === "named" || castMode === "auto") && (
                <div className="counter">
                  Adds one model call to the run (8 instead of 7). Still free.
                </div>
              )}
              {castMode === "dossier" && (
                <div className="counter">
                  The dossier is read once on upload, so the run itself is still 7 calls.
                </div>
              )}
            </div>

            {castMode === "dossier" && (
              <div className="field">
                <label htmlFor="pdf">Case dossier (PDF)</label>
                <input
                  id="pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadDossier(f);
                  }}
                />
                <div className="counter">
                  A charge sheet plus profiles for four advocates and three judges.
                  Text PDFs only — a scan would need OCR first.
                </div>

                {uploading && (
                  <div className="status" style={{ marginTop: "0.9rem" }}>
                    <span className="dot" />
                    Reading the dossier…
                  </div>
                )}

                {uploadError && <div className="err">{uploadError}</div>}

                {dossier && (
                  <>
                    <div className="counter" style={{ textAlign: "left", marginTop: "0.9rem" }}>
                      Read {dossier.page_count} page{dossier.page_count === 1 ? "" : "s"}
                      {dossier.case_title ? ` · ${dossier.case_title}` : ""}
                      {dossier.charge_sheet
                        ? " · the charge sheet above was filled in from it and can be edited"
                        : " · no charge sheet found, so write one above"}
                    </div>

                    <div className="seat-grid" style={{ marginTop: "0.9rem" }}>
                      {dossier.characters.map((c) => {
                        const seat = seats.find((x) => x.key === c.key);
                        return (
                          <div className="card" key={c.key} style={{ marginBottom: 0 }}>
                            <h3 style={{ fontSize: "0.98rem" }}>
                              {c.name}{" "}
                              {c.source === "invented" && (
                                <span className="tag model">invented</span>
                              )}
                            </h3>
                            <div className="meta" style={{ marginBottom: 0 }}>
                              <span
                                className={`tag ${
                                  seat?.role === "advocate_for"
                                    ? "for"
                                    : seat?.role === "advocate_against"
                                      ? "against"
                                      : "model"
                                }`}
                              >
                                {seat ? SIDE_LABEL[seat.role] : c.key}
                              </span>{" "}
                              {c.blurb}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="counter" style={{ textAlign: "left" }}>
                      Characters based on real people follow the document&apos;s own rule:
                      their method is adapted, not their identity. Nothing here predicts
                      how any real person would rule.
                    </div>
                  </>
                )}
              </div>
            )}

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
          </>
        )}

        {modelConfig}

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

        <button
          className="primary"
          type="submit"
          disabled={busy || tooShort || namedButEmpty || dossierMissing}
        >
          {busy ? "Convening…" : "Convene the tribunal"}
        </button>
        {tooShort && entry === "custom" && (
          <div className="counter" style={{ textAlign: "left", marginTop: "0.6rem" }}>
            Write a charge sheet, or switch back to the example case.
          </div>
        )}
        {namedButEmpty && (
          <div className="counter" style={{ textAlign: "left", marginTop: "0.6rem" }}>
            Name at least one seat, or switch to another cast mode.
          </div>
        )}
        {dossierMissing && (
          <div className="counter" style={{ textAlign: "left", marginTop: "0.6rem" }}>
            Upload a dossier, or switch to another cast mode.
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
          <p className="meta" style={{ marginTop: "-0.5rem" }}>
            These three profiles adapt judicial <em>method</em> from published opinions.
            They do not impersonate the judges, reproduce their private views, or predict
            how any real court would rule.
          </p>
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
