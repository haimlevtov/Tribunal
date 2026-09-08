"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Advocate {
  id: string;
  persona_name: string;
  blurb: string;
  side: "for" | "against";
  model_label: string;
  argument: string | null;
  key_points: string[];
  /** The advocate's counterpart to a judge's protocol. */
  reasoning: string | null;
}

interface Judge {
  id: string;
  persona_name: string;
  blurb: string;
  model_label: string;
  verdict: "guilty" | "not_guilty" | "hung" | null;
  /** The word this judge actually used. Null on runs predating the column. */
  verdict_as_returned: string | null;
  confidence: number | null;
  reasoning: string | null;
  points_credited: string[];
  points_rejected: string[];
}

interface RunView {
  id: string;
  status:
    | "queued"
    | "forging_cast"
    | "advocates_running"
    | "judges_running"
    | "complete"
    | "failed"
    | "budget_exceeded";
  error: string | null;
  charge_sheet: string;
  model_mode: "uniform" | "per_character";
  character_mode: "default" | "named" | "auto" | "dossier";
  uniform_model_label: string | null;
  advocates: Advocate[];
  judges: Judge[];
  budget: {
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_tokens: number;
    total_cost_usd: number;
    total_latency_ms: number;
    call_count: number;
    failed_calls: number;
    by_model: Array<{
      model_id: string;
      calls: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost_usd: number;
      failures: number;
    }>;
  };
}

const STATUS_TEXT: Record<RunView["status"], string> = {
  queued: "Convening",
  forging_cast: "Casting the tribunal",
  advocates_running: "Advocates preparing",
  judges_running: "The bench is deliberating",
  complete: "Record closed",
  failed: "The tribunal could not complete",
  budget_exceeded: "Stopped — budget ceiling reached",
};

const VERDICT_TEXT = {
  guilty: "Guilty",
  not_guilty: "Not guilty",
  hung: "Hung",
} as const;

/**
 * The stamp quotes the judge rather than the database.
 *
 * A charge sheet framed "justified / not justified" is answered in those words,
 * and the answer is then stored as one of three kinds — so a judge who wrote
 * "the breach was not justified" was stamped GUILTY. Correct kind, wrong word,
 * sitting directly above the protocol that says otherwise.
 *
 * Colour still keys off the stored kind, so justified stays green whichever word
 * is printed on it.
 */
const RETURNED_TEXT: Record<string, string> = {
  guilty: "Guilty",
  not_guilty: "Not guilty",
  justified: "Justified",
  not_justified: "Not justified",
  hung: "Hung",
};

function stampWord(judge: Judge): string {
  const returned = judge.verdict_as_returned;
  if (returned && RETURNED_TEXT[returned]) return RETURNED_TEXT[returned];
  return judge.verdict ? VERDICT_TEXT[judge.verdict] : "";
}

const POLL_MS = 1500;

/** A document is dated, not timestamped. */
function filedOn(): string {
  return new Date()
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}

export default function VerdictBoard({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not load the run.");
        const data: RunView = await res.json();
        if (cancelled) return;

        setRun(data);
        const settled =
          data.status === "complete" ||
          data.status === "failed" ||
          data.status === "budget_exceeded";
        if (!settled) timer.current = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the run.");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runId]);

  if (error) {
    return (
      <>
        <div className="cap">
          <div>
            <div className="cap-court">In the matter of a fictional tribunal</div>
            <h1>The Tribunal</h1>
          </div>
        </div>
        <div className="record">
          <div className="err">{error}</div>
          <Link href="/">← Convene another tribunal</Link>
        </div>
      </>
    );
  }

  if (!run) {
    return (
      <>
        <div className="cap">
          <div>
            <div className="cap-court">In the matter of a fictional tribunal</div>
            <h1>The Tribunal</h1>
          </div>
        </div>
        <div className="status">
          <span className="dot" />
          Retrieving the record
        </div>
      </>
    );
  }

  const settled =
    run.status === "complete" ||
    run.status === "failed" ||
    run.status === "budget_exceeded";

  const spoken = run.advocates.filter((a) => a.argument);
  const delivered = run.judges.filter((j) => j.verdict);

  return (
    <>
      {/* ── Caption ── */}
      <div className="cap">
        <div>
          <div className="cap-court">In the matter of a fictional tribunal</div>
          <h1>The Tribunal</h1>
        </div>
        <div className="docket">
          RUN <b>{run.id.slice(0, 8)}</b>
          <br />
          FILED <b>{filedOn()}</b>
          <br />
          BENCH{" "}
          <b>
            {run.model_mode === "uniform"
              ? (run.uniform_model_label ?? "ONE MODEL")
              : "PER CHARACTER"}
          </b>
        </div>
      </div>

      <div className="status">
        {!settled && <span className="dot" />}
        {STATUS_TEXT[run.status]}
        {run.character_mode !== "default" && (
          <>
            {" · "}
            {run.character_mode === "named"
              ? "cast you named"
              : run.character_mode === "dossier"
                ? "cast read from a dossier"
                : "cast chosen by the system"}
          </>
        )}
      </div>

      {/* ── The record ── */}
      <div className="record">
        {run.error && <div className="err">{run.error}</div>}

        <p className="rubric">Appearances</p>
        <div className="entry">
          <dl className="appearance">
            <dt>For the accused</dt>
            <dd>
              {run.advocates
                .filter((a) => a.side === "for")
                .map((a) => (
                  <div key={a.id}>
                    {a.persona_name} <span className="of">· {a.model_label}</span>
                  </div>
                ))}
            </dd>
            <dt>Against</dt>
            <dd>
              {run.advocates
                .filter((a) => a.side === "against")
                .map((a) => (
                  <div key={a.id}>
                    {a.persona_name} <span className="of">· {a.model_label}</span>
                  </div>
                ))}
            </dd>
            <dt>On the bench</dt>
            <dd>
              {run.judges.map((j) => (
                <div key={j.id}>
                  {j.persona_name} <span className="of">· {j.model_label}</span>
                </div>
              ))}
              <div className="of">ruling blind — no judge sees another&apos;s verdict</div>
            </dd>
          </dl>
        </div>

        <p className="rubric">The charge</p>
        <div className="entry">
          <p className="charge">{run.charge_sheet}</p>
        </div>

        <p className="rubric">Testimony</p>
        {spoken.length === 0 ? (
          <div className="entry">
            <p className="said">
              {settled
                ? "No advocate delivered."
                : "The advocates have not yet been heard."}
            </p>
          </div>
        ) : (
          run.advocates.map((a) => (
            <div className="entry" key={a.id}>
              <span className="who">
                {a.persona_name}
                <span className="seat">
                  {a.side === "for" ? "Defence" : "Prosecution"} · {a.model_label}
                </span>
              </span>
              {a.argument ? (
                <>
                  <p className="said">{a.argument}</p>
                  {a.key_points.length > 0 && (
                    <ul className="points">
                      {a.key_points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  )}
                  {a.reasoning && (
                    <div className="note">
                      <span className="note-label">Counsel&apos;s own note, for the record</span>
                      <p>{a.reasoning}</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="said">
                  {settled ? "This advocate did not deliver." : "Preparing…"}
                </p>
              )}
            </div>
          ))
        )}

        {/* ── The returns. Identical blocks, no columns, no ordering, no
             total. Every judge is rendered whether or not they have ruled,
             so an entry number belongs to a seat and does not shift as the
             bench reports. ── */}
        <p className="rubric">The returns</p>
        <div className="returns">
          {run.judges.map((j) => (
            <div className="return entry" key={j.id}>
              <div>
                <span className="who">
                  {j.persona_name}
                  <span className="seat">{j.model_label}</span>
                </span>
                {j.reasoning && (
                  <div className="note">
                    <span className="note-label">Protocol</span>
                    <p>{j.reasoning}</p>
                  </div>
                )}
                {j.points_credited.length > 0 && (
                  <>
                    <div className="points-label">Credited</div>
                    <ul className="points">
                      {j.points_credited.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
                {j.points_rejected.length > 0 && (
                  <>
                    <div className="points-label">Rejected</div>
                    <ul className="points">
                      {j.points_rejected.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {j.verdict ? (
                <div className={`stamp s-${j.verdict}`}>
                  <b>{stampWord(j)}</b>
                  {j.confidence !== null && <span>conf. {j.confidence.toFixed(2)}</span>}
                </div>
              ) : (
                <div className="pending">
                  {settled ? "No return" : "Deliberating"}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="closing">
          <div className="closing-line">
            {delivered.length === 0
              ? "No return was entered"
              : "The record closes without consolidation"}
          </div>
          <div className="closing-sub">
            {delivered.length === 0
              ? settled
                ? "The bench did not rule."
                : "The bench has not yet ruled."
              : `${delivered.length} ${
                  delivered.length === 1 ? "judge" : "judges"
                } ruled without sight of one another. No majority is computed and none is implied. The decision is yours.`}
          </div>
        </div>

        {/* ── Schedule of costs ── */}
        <p className="rubric">Schedule of costs</p>
        <div className="costs">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Calls</th>
                  <th className="num">Failed</th>
                  <th className="num">Prompt</th>
                  <th className="num">Completion</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {run.budget.by_model.map((m) => (
                  <tr key={m.model_id}>
                    <td className={m.cost_usd > 0 ? "paid" : undefined}>{m.model_id}</td>
                    <td className="num">{m.calls}</td>
                    <td className="num">
                      {m.failures > 0 ? m.failures : <span className="dash">—</span>}
                    </td>
                    <td className="num">{m.prompt_tokens.toLocaleString()}</td>
                    <td className="num">{m.completion_tokens.toLocaleString()}</td>
                    <td className={`num${m.cost_usd > 0 ? " paid" : ""}`}>
                      {m.cost_usd === 0 ? (
                        <span className="dash">—</span>
                      ) : (
                        `$${m.cost_usd.toFixed(6)}`
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Total</td>
                  <td className="num">{run.budget.call_count}</td>
                  <td className="num">{run.budget.failed_calls}</td>
                  <td className="num">{run.budget.total_prompt_tokens.toLocaleString()}</td>
                  <td className="num">
                    {run.budget.total_completion_tokens.toLocaleString()}
                  </td>
                  <td className="num">
                    {run.budget.total_cost_usd === 0
                      ? "$0.00"
                      : `$${run.budget.total_cost_usd.toFixed(6)}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="tally">
            {run.budget.total_tokens.toLocaleString()} tokens over{" "}
            {run.budget.call_count} calls
            {run.budget.failed_calls > 0 &&
              `, ${run.budget.failed_calls} of which failed and fell to another model`}
            {" · "}
            {(run.budget.total_latency_ms / 1000).toFixed(1)}s of model time
          </p>
        </div>

        <div className="foot">
          <Link href="/">← Convene another tribunal</Link>
          {" · "}Run {run.id}
        </div>
      </div>
    </>
  );
}
