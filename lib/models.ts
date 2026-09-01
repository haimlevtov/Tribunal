/**
 * Model rosters, in two tiers.
 *
 * The free tier still drives the default run: pick nothing and the tribunal
 * costs $0.00. The paid tier exists so a seat is never lost to a rate-limited
 * free endpoint, and so a run can be driven by a stronger model on purpose. It
 * is ordered strictly cheapest-first — every model below costs a fraction of a
 * cent per seat — and lib/budget.ts caps cumulative spend at
 * MAX_TOTAL_SPEND_USD, $5.00 by default.
 *
 * `jsonMode` reflects whether the model advertises `structured_outputs` in
 * OpenRouter's catalogue — it decides which of the three JSON strategies in
 * lib/openrouter.ts we use. Verified against the live /api/v1/models catalogue.
 *
 * Prices are USD per million tokens, read from that same catalogue on
 * 2026-09-01. They are used only for the pre-flight estimate the budget guard
 * sees; the authoritative figure is still the `cost` OpenRouter returns with
 * each call, which is what lands in the ledger.
 */

export type JsonMode = "strict" | "json_object" | "prompt_only";

export interface ModelSpec {
  id: string;
  label: string;
  jsonMode: JsonMode;
  contextLength: number;
  free: boolean;
  /** USD per 1M prompt tokens. 0 on a free endpoint. */
  inUsd: number;
  /** USD per 1M completion tokens. 0 on a free endpoint. */
  outUsd: number;
}

/** A free endpoint. */
const M = (
  id: string,
  label: string,
  jsonMode: JsonMode,
  contextLength: number,
): ModelSpec => ({ id, label, jsonMode, contextLength, free: true, inUsd: 0, outUsd: 0 });

/** A paid endpoint, carrying its catalogue price. */
const P = (
  id: string,
  label: string,
  jsonMode: JsonMode,
  contextLength: number,
  inUsd: number,
  outUsd: number,
): ModelSpec => ({ id, label, jsonMode, contextLength, free: false, inUsd, outUsd });

/**
 * Free models that can hold up a whole run on their own, best first.
 *
 * Verified against the live catalogue on 2026-08-25. The free tier churns:
 * `openai/gpt-oss-20b:free` and `nvidia/nemotron-nano-9b-v2:free` both stopped
 * being free and now return 404, and `google/gemma-4-26b-a4b-it` withdrew its
 * advertised structured-output support. Re-check with scripts/smoke.mjs before
 * relying on any of these.
 */
export const FREE_UNIFORM_CHOICES: ModelSpec[] = [
  // Verified end-to-end on 2026-08-25: returned clean schema-conforming JSON.
  M("dots-studio/dots-3-note-preview:free", "Dots3-Note", "strict", 512_000),
  M("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super 120B", "strict", 262_144),
  // Advertise strict/JSON support; rate-limited at the time of testing.
  M("z-ai/glm-5.2:free", "GLM 5.2", "strict", 256_000),
  M("google/gemma-4-26b-a4b-it:free", "Gemma 4 26B A4B", "json_object", 262_144),
  M("google/gemma-4-31b-it:free", "Gemma 4 31B", "json_object", 262_144),
];

// The default is the model most recently verified to return usable JSON, not
// simply the largest — and it is free, so a run that configures nothing spends
// nothing. On the free tier, reliability beats parameter count.
export const DEFAULT_UNIFORM_MODEL = FREE_UNIFORM_CHOICES[0].id;

/**
 * The paid roster: cheap models that can still hold a seat.
 *
 * Chosen from the live catalogue by cost per seat, with two hard filters. Every
 * one advertises `structured_outputs`, because a seat that cannot return JSON is
 * not a cheaper seat, it is a lost one. And nothing below the ~$0.03/Mtok floor
 * is included: what is cheaper still is 8B roleplay and completion models, and
 * this file's own rule is that a weak judge poisons a verdict in a way a weak
 * advocate does not.
 *
 * The order here is presentational. PAID_FALLBACKS re-sorts by real price, so
 * the cheapest is genuinely tried first whatever this list happens to look like.
 */
export const PAID_CHOICES: ModelSpec[] = [
  P("upstage/solar-pro4", "Solar Pro 4", "strict", 524_288, 0.03, 0.12),
  P("openai/gpt-oss-120b", "gpt-oss-120b", "strict", 131_072, 0.037, 0.17),
  P("qwen/qwen3-30b-a3b-instruct-2507", "Qwen3 30B A3B", "strict", 262_144, 0.048, 0.193),
  P("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", "strict", 1_048_576, 0.075, 0.15),
  // The paid twin of a free roster model: when the :free endpoint is saturated,
  // this is the same model without the queue.
  P("nvidia/nemotron-3-super-120b-a12b", "Nemotron 3 Super 120B", "strict", 1_000_000, 0.085, 0.4),
];

/** A seat's typical shape. Used only to rank models by cost. */
const SEAT_PROMPT_TOKENS = 4000;
const SEAT_COMPLETION_TOKENS = 1500;

export function estimateCostUsd(
  model: ModelSpec,
  promptTokens: number,
  completionTokens: number,
): number {
  return (promptTokens * model.inUsd + completionTokens * model.outUsd) / 1_000_000;
}

/** What one seat on this model costs, near enough to rank by. */
export function nominalSeatCostUsd(model: ModelSpec): number {
  return estimateCostUsd(model, SEAT_PROMPT_TOKENS, SEAT_COMPLETION_TOKENS);
}

/**
 * Mode B. Seven distinct free models, one per seat. The judges get the three
 * strongest; the 2.6B model sits on an advocate, where a weak argument is
 * survivable — a weak judge would poison the whole verdict.
 */
export const PER_CHARACTER_MODELS: Record<string, ModelSpec> = {
  // Judges take the three most reliable seats: a judge that fails costs a
  // verdict, while a failed advocate still leaves its side represented.
  judge_1: M("dots-studio/dots-3-note-preview:free", "Dots3-Note", "strict", 512_000),
  judge_2: M("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super 120B", "strict", 262_144),
  judge_3: M("z-ai/glm-5.2:free", "GLM 5.2", "strict", 256_000),
  defence_1: M("google/gemma-4-26b-a4b-it:free", "Gemma 4 26B A4B", "json_object", 262_144),
  defence_2: M("google/gemma-4-31b-it:free", "Gemma 4 31B", "json_object", 262_144),
  prosecution_1: M("minimax/minimax-m2.7:free", "MiniMax M2.7", "json_object", 196_608),
  prosecution_2: M("nvidia/nemotron-3-ultra-550b-a55b:free", "Nemotron 3 Ultra 550B", "prompt_only", 1_000_000),
};

/**
 * `openrouter/free` is deliberately NOT used. It selects at random among all
 * free models, which includes non-chat ones — in testing it routed a verdict
 * request to a content-safety classifier that replied "User Safety: safe".
 * Those junk responses were logged as empty completions and killed whole seats.
 */

/**
 * Free models a failing seat can fall back to, in order.
 *
 * Observed in production: the assigned model returned "temporarily rate-limited
 * upstream" (429) and the single catch-all fallback then returned empty
 * completions, so seats died and a run finished with two speeches instead of
 * four. Free endpoints are rate-limited *per model*, so the fix is breadth —
 * several unrelated models beat one router that may itself be saturated.
 */
const FREE_FALLBACKS: ModelSpec[] = [
  M("dots-studio/dots-3-note-preview:free", "Dots3-Note", "strict", 512_000),
  M("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super 120B", "strict", 262_144),
  M("z-ai/glm-5.2:free", "GLM 5.2", "strict", 256_000),
  M("google/gemma-4-26b-a4b-it:free", "Gemma 4 26B A4B", "json_object", 262_144),
  M("google/gemma-4-31b-it:free", "Gemma 4 31B", "json_object", 262_144),
];

/**
 * The paid last resort, cheapest genuinely first — sorted by price rather than
 * by the order someone happened to type them in.
 */
const PAID_FALLBACKS: ModelSpec[] = [...PAID_CHOICES].sort(
  (a, b) => nominalSeatCostUsd(a) - nominalSeatCostUsd(b),
);

/**
 * Paid models are ON by default, bounded by the spend guard rather than by being
 * switched off: at well under a cent per run, what protects the account is the
 * ceiling, not abstinence. Set ALLOW_PAID_FALLBACK=false for a strictly $0
 * deployment.
 */
export function allowPaidFallback(): boolean {
  return process.env.ALLOW_PAID_FALLBACK !== "false";
}

/** The uniform picker's options. Paid entries disappear when paid is off. */
export function uniformChoices(): ModelSpec[] {
  return allowPaidFallback()
    ? [...FREE_UNIFORM_CHOICES, ...PAID_FALLBACKS]
    : [...FREE_UNIFORM_CHOICES];
}

/**
 * Resolution order for one seat: the assigned model, then every free model, then
 * the paid roster cheapest-first. Free endpoints 429 and 503 far more than paid
 * ones do, so every seat needs somewhere to go — and a seat that has fallen off
 * a paid model should still try the free tier before reaching for a dearer one.
 */
export function fallbackChain(assigned: ModelSpec): ModelSpec[] {
  const chain: ModelSpec[] = [assigned];
  const seen = new Set([assigned.id]);

  const push = (m: ModelSpec) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    chain.push(m);
  };

  for (const m of FREE_FALLBACKS) push(m);
  if (allowPaidFallback()) for (const m of PAID_FALLBACKS) push(m);

  return chain;
}

export function isAllowedUniformModel(id: string): boolean {
  return uniformChoices().some((m) => m.id === id);
}

export function specForId(id: string): ModelSpec {
  const known =
    FREE_UNIFORM_CHOICES.find((m) => m.id === id) ??
    PAID_CHOICES.find((m) => m.id === id) ??
    Object.values(PER_CHARACTER_MODELS).find((m) => m.id === id);
  // Unknown ids degrade to the safest strategy rather than throwing. They are
  // also priced at zero, which only ever *under*-states an estimate — the real
  // cost still arrives from OpenRouter and still lands in the ledger.
  return known ?? M(id, id, "prompt_only", 128_000);
}

/** Shown in the UI so the class can see which model is on which seat. */
export function publicModelLabel(id: string): string {
  return specForId(id).label;
}
