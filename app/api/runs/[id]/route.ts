import { NextResponse } from "next/server";
import {
  db,
  type LlmCallRow,
  type ParticipantRow,
  type RunRow,
  type SpeechRow,
  type VerdictRow,
} from "@/lib/db";
import { publicModelLabel } from "@/lib/models";
import { personaByKey } from "@/lib/personas";
import { describeSetupError } from "@/lib/setup-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assembled view of a run. Deliberately excludes system prompts and the rubric —
 * personas are exposed as name + blurb only.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const client = db();
    const [runRes, partRes, speechRes, verdictRes, callRes] = await Promise.all([
      client.from("runs").select("*").eq("id", id).maybeSingle(),
      client.from("participants").select("*").eq("run_id", id),
      client.from("speeches").select("*").eq("run_id", id),
      client.from("verdicts").select("*").eq("run_id", id),
      client.from("llm_calls").select("*").eq("run_id", id),
    ]);

    // A query error is not a missing row. Reporting a broken schema or a rejected
    // key as 404 hides the real problem behind a plausible-looking answer.
    if (runRes.error) throw new Error(runRes.error.message);

    const run = runRes.data as RunRow | null;
    if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const participants = (partRes.data ?? []) as ParticipantRow[];
    const speeches = (speechRes.data ?? []) as SpeechRow[];
    const verdicts = (verdictRes.data ?? []) as VerdictRow[];
    const calls = (callRes.data ?? []) as LlmCallRow[];

    const byParticipant = <T extends { participant_id: string }>(rows: T[]) =>
      new Map(rows.map((r) => [r.participant_id, r]));

    const speechMap = byParticipant(speeches);
    const verdictMap = byParticipant(verdicts);

    const seat = (p: ParticipantRow) => ({
      id: p.id,
      role: p.role,
      seat_index: p.seat_index,
      persona_name: p.persona_name,
      // Forged casts carry their own blurb; default runs fall back to the code.
      blurb: p.persona_blurb ?? personaByKey(p.persona_key).blurb,
      model_id: p.model_id,
      model_label: publicModelLabel(p.model_id),
    });

    const advocates = participants
      .filter((p) => p.role !== "judge")
      .sort((a, b) => a.role.localeCompare(b.role) || a.seat_index - b.seat_index)
      .map((p) => {
        const s = speechMap.get(p.id);
        return {
          ...seat(p),
          side: p.role === "advocate_for" ? "for" : "against",
          argument: s?.argument ?? null,
          key_points: s?.key_points ?? [],
        };
      });

    const judges = participants
      .filter((p) => p.role === "judge")
      .sort((a, b) => a.seat_index - b.seat_index)
      .map((p) => {
        const v = verdictMap.get(p.id);
        return {
          ...seat(p),
          verdict: v?.verdict ?? null,
          confidence: v?.confidence ?? null,
          reasoning: v?.reasoning ?? null,
          points_credited: v?.points_credited ?? [],
          points_rejected: v?.points_rejected ?? [],
        };
      });

    // Per-model rollup for the cost ledger the class will actually look at.
    const byModel = new Map<
      string,
      { model_id: string; calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number; failures: number }
    >();
    for (const c of calls) {
      const e =
        byModel.get(c.model_id) ??
        {
          model_id: c.model_id,
          calls: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          cost_usd: 0,
          failures: 0,
        };
      e.calls += 1;
      e.prompt_tokens += c.prompt_tokens ?? 0;
      e.completion_tokens += c.completion_tokens ?? 0;
      e.cost_usd += Number(c.cost_usd ?? 0);
      if (c.error) e.failures += 1;
      byModel.set(c.model_id, e);
    }

    return NextResponse.json({
      id: run.id,
      status: run.status,
      error: run.error,
      charge_sheet: run.charge_sheet,
      model_mode: run.model_mode,
      character_mode: run.character_mode,
      uniform_model_id: run.uniform_model_id,
      uniform_model_label: run.uniform_model_id
        ? publicModelLabel(run.uniform_model_id)
        : null,
      created_at: run.created_at,
      completed_at: run.completed_at,
      advocates,
      judges,
      budget: {
        total_prompt_tokens: run.total_prompt_tokens,
        total_completion_tokens: run.total_completion_tokens,
        total_tokens: run.total_prompt_tokens + run.total_completion_tokens,
        total_cost_usd: Number(run.total_cost_usd),
        total_latency_ms: run.total_latency_ms,
        call_count: calls.length,
        failed_calls: calls.filter((c) => c.error).length,
        by_model: [...byModel.values()].sort((a, b) => b.cost_usd - a.cost_usd),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/runs/:id]", message);
    const described = describeSetupError(message);
    return NextResponse.json(
      { error: described === "Could not start the tribunal." ? "Could not load the run." : described },
      { status: 500 },
    );
  }
}
