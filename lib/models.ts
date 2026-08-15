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

/** Free models that can hold up a whole run on their own, best first. */
export const UNIFORM_CHOICES: ModelSpec[] = [
  M("google/gemma-4-26b-a4b-it:free", "Gemma 4 26B A4B", "strict", 262_144),
  M("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super 120B", "strict", 262_144),
  M("dots-studio/dots-3-note-preview:free", "Dots3-Note", "strict", 512_000),
  M("openai/gpt-oss-20b:free", "gpt-oss-20b", "strict", 131_072),
  M("openrouter/free", "Free Models Router (random)", "strict", 200_000),
];

export const DEFAULT_UNIFORM_MODEL = UNIFORM_CHOICES[0].id;

/**
 * Mode B. Seven distinct free models, one per seat. The judges get the three
 * strongest; the 2.6B model sits on an advocate, where a weak argument is
 * survivable — a weak judge would poison the whole verdict.
 */
export const PER_CHARACTER_MODELS: Record<string, ModelSpec> = {
  defence_1: M("google/gemma-4-26b-a4b-it:free", "Gemma 4 26B A4B", "strict", 262_144),
  defence_2: M("openai/gpt-oss-20b:free", "gpt-oss-20b", "strict", 131_072),
  prosecution_1: M("google/gemma-4-31b-it:free", "Gemma 4 31B", "json_object", 262_144),
  prosecution_2: M("liquid/lfm-2.5-2.6b:free", "LFM2.5 2.6B", "strict", 128_000),
  judge_1: M("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super 120B", "strict", 262_144),
  judge_2: M("dots-studio/dots-3-note-preview:free", "Dots3-Note", "strict", 512_000),
  judge_3: M("nvidia/nemotron-nano-9b-v2:free", "Nemotron Nano 9B", "strict", 128_000),
};

/** Free catch-all: OpenRouter's router picks whatever free capacity exists. */
const FREE_ROUTER = M("openrouter/free", "Free Models Router", "strict", 200_000);

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
  if (assigned.id !== FREE_ROUTER.id) chain.push(FREE_ROUTER);
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
