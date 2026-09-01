import { assertWithinBudget, BudgetExceededError } from "./budget";
import { db, type CharacterMode, type ParticipantRow, type RunRow } from "./db";
import { forgeCast } from "./persona-forge";
import {
  DEFAULT_UNIFORM_MODEL,
  PER_CHARACTER_MODELS,
  specForId,
  type ModelSpec,
} from "./models";
import { callForJson, OpenRouterError, type CallAttempt } from "./openrouter";
import {
  ADVOCATE_PERSONAS,
  buildSystemPrompt,
  JUDGE_PERSONAS,
  personaByKey,
} from "./personas";
import { advocateUserPrompt, judgeUserPrompt, type SpeechForJudge } from "./rubric";
import {
  SPEECH_JSON_SCHEMA,
  SpeechOutput,
  VERDICT_JSON_SCHEMA,
  VerdictOutput,
} from "./schemas";

const ADVOCATE_TEMPERATURE = 0.8; // advocates should have some rhetorical range
const JUDGE_TEMPERATURE = 0.3; // judges should not
const ADVOCATE_MAX_TOKENS = 2000;
const JUDGE_MAX_TOKENS = 2500;

/**
 * Resolve which model sits in which seat, before any call is made, so the run is
 * reproducible and the two modes are comparable on the same charge sheet.
 */
export function assignModels(
  mode: "uniform" | "per_character",
  uniformModelId?: string | null,
): Record<string, ModelSpec> {
  if (mode === "uniform") {
    const spec = specForId(uniformModelId ?? DEFAULT_UNIFORM_MODEL);
    return Object.fromEntries(
      [...ADVOCATE_PERSONAS, ...JUDGE_PERSONAS].map((p) => [p.key, spec]),
    );
  }
  return { ...PER_CHARACTER_MODELS };
}

/** Seat names typed by the user, keyed by seat id. Only used in `named` mode. */
export type SeatNames = Record<string, string>;

/** A cast that is already written — currently only produced by a dossier upload. */
export type ReadyCast =
  | Array<{ key: string; name: string; blurb: string; body: string }>
  | null;

/**
 * Persist the seven seats. Called inside the POST, before the run goes async.
 *
 * In `default` mode the characters are known now, so they are written now. In the
 * other modes the seats are created empty and filled in by the forge, which lets
 * the run page render the bench immediately instead of waiting on a model call.
 */
export async function createParticipants(
  runId: string,
  models: Record<string, ModelSpec>,
  characterMode: CharacterMode = "default",
  seatNames: SeatNames = {},
  /** Dossier mode: the cast is already written, so seats are filled immediately. */
  cast: ReadyCast = null,
): Promise<ParticipantRow[]> {
  const useDefaults = characterMode === "default";
  const byKey = new Map((cast ?? []).map((c) => [c.key, c]));

  const rows = [...ADVOCATE_PERSONAS, ...JUDGE_PERSONAS].map((p) => {
    const ready = byKey.get(p.key);
    if (ready) {
      return {
        run_id: runId,
        role: p.role,
        seat_index: p.seatIndex,
        persona_key: p.key,
        persona_name: ready.name,
        persona_body: ready.body,
        persona_blurb: ready.blurb,
        model_id: models[p.key].id,
      };
    }
    return {
      run_id: runId,
      role: p.role,
      seat_index: p.seatIndex,
      persona_key: p.key,
      persona_name: useDefaults ? p.name : (seatNames[p.key]?.trim() || "Casting…"),
      // Stored even for defaults, so a run stays reproducible after the defaults
      // in code are edited.
      persona_body: useDefaults ? p.body : null,
      persona_blurb: useDefaults ? p.blurb : null,
      model_id: models[p.key].id,
    };
  });

  const { data, error } = await db().from("participants").insert(rows).select();
  if (error) throw new Error(`could not create participants: ${error.message}`);
  return data as ParticipantRow[];
}

async function logAttempts(
  runId: string,
  participantId: string | null,
  phase: "advocate" | "judge" | "forge",
  attempts: CallAttempt[],
): Promise<void> {
  if (attempts.length === 0) return;

  const rows = attempts.map((a) => ({
    run_id: runId,
    participant_id: participantId,
    phase,
    model_id: a.modelId,
    attempt: a.attempt,
    generation_id: a.generationId ?? null,
    prompt_tokens: a.promptTokens ?? null,
    completion_tokens: a.completionTokens ?? null,
    cost_usd: a.costUsd,
    latency_ms: a.latencyMs,
    http_status: a.httpStatus ?? null,
    error: a.error ?? null,
  }));

  // A ledger failure must not sink a run that otherwise succeeded.
  const { error } = await db().from("llm_calls").insert(rows);
  if (error) console.error(`[run ${runId}] failed to log llm_calls: ${error.message}`);
}

async function setStatus(
  runId: string,
  status: RunRow["status"],
  error?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (error) patch.error = error.slice(0, 2000);
  if (status === "complete" || status === "failed" || status === "budget_exceeded") {
    patch.completed_at = new Date().toISOString();
  }
  await db().from("runs").update(patch).eq("id", runId);
}

/**
 * Wave 0. Fill the empty seats with forged characters.
 *
 * A forge failure must not sink the run: the tribunal falls back to the seven
 * default characters and carries on, recording why on the run. Losing the custom
 * cast is a disappointment; losing the whole run in front of a class is worse.
 */
async function forgeAndPersistCast(
  run: RunRow,
  participants: ParticipantRow[],
): Promise<void> {
  const seatNames: Record<string, string> = {};
  for (const p of participants) {
    if (p.persona_name && p.persona_name !== "Casting…") {
      seatNames[p.persona_key] = p.persona_name;
    }
  }

  let cast: Awaited<ReturnType<typeof forgeCast>> | null = null;
  try {
    cast = await forgeCast(
      run.character_mode === "named" ? "named" : "auto",
      run.charge_sheet,
      seatNames,
      (est) => assertWithinBudget(run.id, est),
    );
    // The success path has to log too. It did not before, so a forge that landed
    // on a paid model spent money the ledger never saw — and the ceiling reads
    // the ledger.
    await logAttempts(run.id, null, "forge", cast.attempts);
  } catch (err) {
    if (err instanceof OpenRouterError) {
      await logAttempts(run.id, null, "forge", err.attempts);
    }
    const why = err instanceof Error ? err.message : String(err);
    console.error(`[run ${run.id}] cast forge failed, using defaults: ${why}`);
    await db()
      .from("runs")
      .update({ error: `Cast could not be forged, default characters used. (${why.slice(0, 300)})` })
      .eq("id", run.id);
  }

  for (const p of participants) {
    const fallback = personaByKey(p.persona_key);
    const forged = cast?.seats.find((c) => c.key === p.persona_key);

    const patch = {
      persona_name: forged?.name ?? fallback.name,
      persona_body: forged?.body ?? fallback.body,
      persona_blurb: forged?.blurb ?? fallback.blurb,
    };

    const { error } = await db().from("participants").update(patch).eq("id", p.id);
    if (error) throw new Error(`could not save forged character: ${error.message}`);

    // Keep the in-memory rows in step so the waves below use the forged cast.
    p.persona_name = patch.persona_name;
    p.persona_body = patch.persona_body;
    p.persona_blurb = patch.persona_blurb;
  }
}

/**
 * Wave 1. The four advocates run in parallel and blind to each other — each sees
 * only the charge sheet and its own brief.
 */
async function runAdvocates(
  run: RunRow,
  participants: ParticipantRow[],
): Promise<SpeechForJudge[]> {
  const advocates = participants.filter((p) => p.role !== "judge");

  const results = await Promise.allSettled(
    advocates.map(async (p) => {
      const side = p.role === "advocate_for" ? "for" : "against";

      const { data, modelId, attempts } = await callForJson({
        system: buildSystemPrompt(p.role, p.persona_body ?? personaByKey(p.persona_key).body),
        user: advocateUserPrompt(run.charge_sheet, side),
        schema: SpeechOutput,
        jsonSchema: SPEECH_JSON_SCHEMA,
        model: specForId(p.model_id),
        temperature: ADVOCATE_TEMPERATURE,
        maxTokens: ADVOCATE_MAX_TOKENS,
        onPaidAttempt: (est) => assertWithinBudget(run.id, est),
      });

      await logAttempts(run.id, p.id, "advocate", attempts);

      const { error } = await db().from("speeches").insert({
        run_id: run.id,
        participant_id: p.id,
        argument: data.argument,
        key_points: data.key_points,
        reasoning: data.reasoning || null,
      });
      if (error) throw new Error(`could not save speech: ${error.message}`);

      return {
        advocateName: p.persona_name,
        side: side as "for" | "against",
        argument: data.argument,
        keyPoints: data.key_points,
        actualModel: modelId,
      };
    }),
  );

  const speeches: SpeechForJudge[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      speeches.push(r.value);
    } else {
      const reason = r.reason;
      if (reason instanceof BudgetExceededError) throw reason;
      if (reason instanceof OpenRouterError) {
        await logAttempts(run.id, advocates[i].id, "advocate", reason.attempts);
      }
      console.error(`[run ${run.id}] advocate ${advocates[i].persona_key} failed:`, reason);
    }
  }

  // A tribunal needs argument on both sides; one surviving speech is not a debate.
  const forCount = speeches.filter((s) => s.side === "for").length;
  const againstCount = speeches.filter((s) => s.side === "against").length;
  if (forCount === 0 || againstCount === 0) {
    throw new Error(
      `Advocates failed: ${forCount} for / ${againstCount} against. Both sides must be heard.`,
    );
  }

  return speeches;
}

/**
 * Wave 2. The three judges run in parallel, each seeing the charge sheet and all
 * surviving speeches — and never each other's verdicts.
 */
async function runJudges(
  run: RunRow,
  participants: ParticipantRow[],
  speeches: SpeechForJudge[],
): Promise<number> {
  const judges = participants.filter((p) => p.role === "judge");
  const userPrompt = judgeUserPrompt(run.charge_sheet, speeches);

  const results = await Promise.allSettled(
    judges.map(async (p) => {
      const { data, attempts } = await callForJson({
        system: buildSystemPrompt("judge", p.persona_body ?? personaByKey(p.persona_key).body),
        user: userPrompt,
        schema: VerdictOutput,
        jsonSchema: VERDICT_JSON_SCHEMA,
        model: specForId(p.model_id),
        temperature: JUDGE_TEMPERATURE,
        maxTokens: JUDGE_MAX_TOKENS,
        onPaidAttempt: (est) => assertWithinBudget(run.id, est),
      });

      await logAttempts(run.id, p.id, "judge", attempts);

      const { error } = await db().from("verdicts").insert({
        run_id: run.id,
        participant_id: p.id,
        verdict: data.verdict,
        confidence: data.confidence,
        reasoning: data.reasoning,
        points_credited: data.points_credited,
        points_rejected: data.points_rejected,
      });
      if (error) throw new Error(`could not save verdict: ${error.message}`);
    }),
  );

  let delivered = 0;
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      delivered++;
    } else {
      const reason = r.reason;
      if (reason instanceof BudgetExceededError) throw reason;
      if (reason instanceof OpenRouterError) {
        await logAttempts(run.id, judges[i].id, "judge", reason.attempts);
      }
      console.error(`[run ${run.id}] judge ${judges[i].persona_key} failed:`, reason);
    }
  }

  if (delivered === 0) throw new Error("No judge returned a verdict.");
  return delivered;
}

/**
 * The whole run. Invoked in the background via waitUntil — it owns its own error
 * handling and must never reject into the caller, or Vercel logs an unhandled
 * rejection and the run row sits at "queued" forever.
 */
export async function executeRun(runId: string): Promise<void> {
  try {
    const { data: run, error: runErr } = await db()
      .from("runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (runErr || !run) throw new Error(`run ${runId} not found: ${runErr?.message}`);

    const { data: participants, error: pErr } = await db()
      .from("participants")
      .select("*")
      .eq("run_id", runId);
    if (pErr || !participants?.length) {
      throw new Error(`participants missing for run ${runId}: ${pErr?.message}`);
    }

    const mode = (run as RunRow).character_mode;
    if (mode === "named" || mode === "auto") {
      await setStatus(runId, "forging_cast");
      await forgeAndPersistCast(run as RunRow, participants as ParticipantRow[]);
    }

    await setStatus(runId, "advocates_running");
    const speeches = await runAdvocates(run as RunRow, participants as ParticipantRow[]);

    await setStatus(runId, "judges_running");
    await runJudges(run as RunRow, participants as ParticipantRow[], speeches);

    await setStatus(runId, "complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof BudgetExceededError ? "budget_exceeded" : "failed";
    console.error(`[run ${runId}] ${status}: ${message}`);
    try {
      await setStatus(runId, status, message);
    } catch (inner) {
      console.error(`[run ${runId}] could not even record failure:`, inner);
    }
  }
}
