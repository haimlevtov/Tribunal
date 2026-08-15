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
}

interface Judge {
  id: string;
  persona_name: string;
  blurb: string;
  model_label: string;
  verdict: "guilty" | "not_guilty" | "hung" | null;
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
  character_mode: "default" | "named" | "auto";
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
  queued: "Convening the tribunal…",
  forging_cast: "Casting the tribunal…",
  advocates_running: "The advocates are preparing their speeches…",
  judges_running: "The bench is deliberating…",
  complete: "The tribunal has ruled.",
  failed: "The tribunal could not complete.",
  budget_exceeded: "The tribunal stopped: budget ceiling reached.",
};

const VERDICT_TEXT = {
  guilty: "Guilty",
  not_guilty: "Not guilty",
  hung: "Hung",
} as const;

const POLL_MS = 1500;

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
        <h1>The Tribunal</h1>
        <div className="err">{error}</div>
        <Link href="/">← Convene another tribunal</Link>
      </>
    );
  }

  if (!run) {
    return (
      <>
        <h1>The Tribunal</h1>
        <div className="status">
          <span className="dot" />
          Loading…
        </div>
      </>
    );
  }

  const settled =
    run.status === "complete" ||
    run.status === "failed" ||
    run.status === "budget_exceeded";

  const delivered = run.judges.filter((j) => j.verdict);
  const tally = delivered.reduce<Record<string, number>>((acc, j) => {
    if (j.verdict) acc[j.verdict] = (acc[j.verdict] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <h1>The Tribunal</h1>

      <div className="status">
        {!settled && <span className="dot" />}
        {STATUS_TEXT[run.status]}
        {" · "}
        {run.model_mode === "uniform"
          ? `one model for all seven (${run.uniform_model_label})`
          : "a different model per character"}
        {run.character_mode !== "default" && (
          <>
            {" · "}
            {run.character_mode === "named" ? "cast you named" : "cast chosen by the system"}
          </>
        )}
      </div>

      {run.error && <div className="err">{run.error}</div>}

      <h2>The charge</h2>
      <p className="charge-quote">{run.charge_sheet}</p>

      <h2>The verdicts</h2>
      {delivered.length === 0 ? (
        <p className="meta">
          {settled ? "No verdict was returned." : "The bench has not yet ruled."}
        </p>
      ) : (
        <>
          <div className="verdicts">
            {run.judges.map((j) => (
              <div className="card" key={j.id}>
                <h3>{j.persona_name}</h3>
                <div className="meta">
                  <span className="tag model">{j.model_label}</span>
                </div>
                {j.verdict ? (
                  <>
                    <div className={`verdict-word v-${j.verdict}`}>
                      {VERDICT_TEXT[j.verdict]}
                    </div>
                    <div className={`conf v-${j.verdict}`}>
                      confidence {j.confidence?.toFixed(2)}
                      <span className="bar">
                        <i style={{ width: `${(j.confidence ?? 0) * 100}%` }} />
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="meta">
                    {settled ? "No verdict returned." : "Still deliberating…"}
                  </div>
                )}
              </div>
            ))}
          </div>

          {delivered.length > 1 && (
            <p className="meta" style={{ marginTop: "1rem" }}>
              {Object.entries(tally)
                .map(([v, n]) => `${n} × ${VERDICT_TEXT[v as keyof typeof VERDICT_TEXT]}`)
                .join(" · ")}
              {" — "}
              the tribunal does not aggregate these. The decision is yours.
            </p>
          )}
        </>
      )}

      <h2>The protocol</h2>
      {delivered.length === 0 ? (
        <p className="meta">Reasoning appears once the bench has ruled.</p>
      ) : (
        run.judges
          .filter((j) => j.reasoning)
          .map((j) => (
            <div className="card" key={`p-${j.id}`}>
              <h3>
                {j.persona_name}{" "}
                <span className={`tag ${j.verdict === "guilty" ? "against" : "for"}`}>
                  {j.verdict ? VERDICT_TEXT[j.verdict] : ""}
                </span>
              </h3>
              <div className="meta">{j.blurb}</div>
              <p className="speech">{j.reasoning}</p>
              {j.points_credited.length > 0 && (
                <>
                  <div className="meta" style={{ marginBottom: "0.3rem" }}>
                    Found persuasive
                  </div>
                  <ul className="points">
                    {j.points_credited.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </>
              )}
              {j.points_rejected.length > 0 && (
                <>
                  <div className="meta" style={{ margin: "0.75rem 0 0.3rem" }}>
                    Rejected
                  </div>
                  <ul className="points">
                    {j.points_rejected.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))
      )}

      <h2>The speeches</h2>
      {run.advocates.every((a) => !a.argument) ? (
        <p className="meta">The advocates have not yet spoken.</p>
      ) : (
        run.advocates.map((a) => (
          <div className="card" key={a.id}>
            <h3>
              {a.persona_name}{" "}
              <span className={`tag ${a.side}`}>
                {a.side === "for" ? "for the accused" : "against the accused"}
              </span>
            </h3>
            <div className="meta">
              {a.blurb} · <span className="tag model">{a.model_label}</span>
            </div>
            {a.argument ? (
              <>
                <p className="speech">{a.argument}</p>
                {a.key_points.length > 0 && (
                  <ul className="points">
                    {a.key_points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="meta">
                {settled ? "This advocate did not deliver." : "Preparing…"}
              </div>
            )}
          </div>
        ))
      )}

      <h2>Token &amp; cost budget</h2>
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Calls</th>
                <th className="num">Prompt</th>
                <th className="num">Completion</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {run.budget.by_model.map((m) => (
                <tr key={m.model_id}>
                  <td>
                    {m.model_id}
                    {m.failures > 0 && (
                      <span className="meta"> · {m.failures} failed</span>
                    )}
                  </td>
                  <td className="num">{m.calls}</td>
                  <td className="num">{m.prompt_tokens.toLocaleString()}</td>
                  <td className="num">{m.completion_tokens.toLocaleString()}</td>
                  <td className="num">
                    {m.cost_usd === 0 ? (
                      <span className="free">free</span>
                    ) : (
                      `$${m.cost_usd.toFixed(6)}`
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>{run.budget.call_count}</strong>
                </td>
                <td className="num">
                  <strong>{run.budget.total_prompt_tokens.toLocaleString()}</strong>
                </td>
                <td className="num">
                  <strong>{run.budget.total_completion_tokens.toLocaleString()}</strong>
                </td>
                <td className="num">
                  <strong>
                    {run.budget.total_cost_usd === 0 ? (
                      <span className="free">$0.00</span>
                    ) : (
                      `$${run.budget.total_cost_usd.toFixed(6)}`
                    )}
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="meta" style={{ marginTop: "0.9rem", marginBottom: 0 }}>
          {run.budget.total_tokens.toLocaleString()} tokens across{" "}
          {run.budget.call_count} model calls
          {run.budget.failed_calls > 0 && ` (${run.budget.failed_calls} failed and retried)`}
          {" · "}
          {(run.budget.total_latency_ms / 1000).toFixed(1)}s of model time
        </div>
      </div>

      <div className="foot">
        <Link href="/">← Convene another tribunal</Link>
        {" · "}Run {run.id}
      </div>
    </>
  );
}
