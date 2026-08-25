/**
 * Model rosters. Every model in the default configuration is $0 on OpenRouter.
 *
 * `strictJson` reflects whether the model advertises `structured_outputs` in
 * OpenRouter's catalogue — it decides which of the three JSON strategies in
 * lib/openrouter.ts we use. Verified against the live /api/v1/models catalogue.
 */

export type JsonMode = "strict" | "json_object" | "prompt_only";

export interface ModelSpec {
  id: string;
  label: string;
  jsonMode: JsonMode;
  contextLength: number;
  free: boolean;
}

const M = (
  id: string,
  label: string,
  jsonMode: JsonMode,
  contextLength: number,
  free = true,
): ModelSpec => ({ id, label, jsonMode, contextLength, free });

/**
 * Free models that can hold up a whole run on their own, best first.
 *
 * Verified against the live catalogue on 2026-08-25. The free tier churns:
 * `openai/gpt-oss-20b:free` and `nvidia/nemotron-nano-9b-v2:free` both stopped
 * being free and now return 404, and `google/gemma-4-26b-a4b-it` withdrew its
 * advertised structured-output support. Re-check with scripts/smoke.mjs before
 * relying on any of these.
 */
export const UNIFORM_CHOICES: ModelSpec[] = [
  // Verified end-to-end on 2026-08-25: returned clean schema-conforming JSON.
  M("dots-studio/dots-3-note-preview:free", "Dots3-Note", "strict", 512_000),
  M("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super 120B", "strict", 262_144),
  // Advertise strict/JSON support; rate-limited at the time of testing.
  M("z-ai/glm-5.2:free", "GLM 5.2", "strict", 256_000),
  M("google/gemma-4-26b-a4b-it:free", "Gemma 4 26B A4B", "json_object", 262_144),
  M("google/gemma-4-31b-it:free", "Gemma 4 31B", "json_object", 262_144),
];

// The default is the model most recently verified to return usable JSON, not
// simply the largest. On the free tier, reliability beats parameter count.
export const DEFAULT_UNIFORM_MODEL = UNIFORM_CHOICES[0].id;

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
 * Paid last resort. Off unless ALLOW_PAID_FALLBACK=true — at ~$0.0015 a run it is
 * effectively free, but the default stays $0 so an unattended demo cannot spend.
 */
const PAID_FALLBACK = M("openai/gpt-oss-120b", "gpt-oss-120b (paid)", "strict", 131_072, false);

export function allowPaidFallback(): boolean {
  return process.env.ALLOW_PAID_FALLBACK === "true";
}

/**
 * Resolution order for one seat: assigned model, then the free router, then paid
 * (only if enabled). Free endpoints 429 and 503 more than paid ones do, so every
 * seat needs somewhere to go.
 */
export function fallbackChain(assigned: ModelSpec): ModelSpec[] {
  const chain: ModelSpec[] = [assigned];

  for (const m of FREE_FALLBACKS) {
    if (m.id !== assigned.id) chain.push(m);
  }

  if (allowPaidFallback()) chain.push(PAID_FALLBACK);

  return chain;
}

export function isAllowedUniformModel(id: string): boolean {
  return UNIFORM_CHOICES.some((m) => m.id === id);
}

export function specForId(id: string): ModelSpec {
  const known =
    UNIFORM_CHOICES.find((m) => m.id === id) ??
    Object.values(PER_CHARACTER_MODELS).find((m) => m.id === id);
  // Unknown ids degrade to the safest strategy rather than throwing.
  return known ?? M(id, id, "prompt_only", 128_000);
}

/** Shown in the UI so the class can see which model is on which seat. */
export function publicModelLabel(id: string): string {
  return specForId(id).label;
}
