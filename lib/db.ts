import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. SERVER-ONLY.
 *
 * Every table has RLS on with no permissive policies, so this key is the only way
 * in — which is deliberate: the browser never touches Postgres directly, it goes
 * through the route handlers.
 */
let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — copy .env.example to .env.local",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

// ---------------------------------------------------------------- row types

export type RunStatus =
  | "queued"
  | "forging_cast"
  | "advocates_running"
  | "judges_running"
  | "complete"
  | "failed"
  | "budget_exceeded";

export type ModelMode = "uniform" | "per_character";
export type CharacterMode = "default" | "named" | "auto" | "dossier";
export type SeatRole = "advocate_for" | "advocate_against" | "judge";
export type VerdictKind = "guilty" | "not_guilty" | "hung";

export interface RunRow {
  id: string;
  charge_sheet: string;
  model_mode: ModelMode;
  uniform_model_id: string | null;
  character_mode: CharacterMode;
  status: RunStatus;
  error: string | null;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost_usd: number;
  total_latency_ms: number;
  created_at: string;
  completed_at: string | null;
}

export interface ParticipantRow {
  id: string;
  run_id: string;
  role: SeatRole;
  seat_index: number;
  persona_key: string;
  persona_name: string;
  /** Character description used for this seat. NULL = the built-in default. */
  persona_body: string | null;
  persona_blurb: string | null;
  model_id: string;
}

export interface SpeechRow {
  id: string;
  run_id: string;
  participant_id: string;
  argument: string;
  key_points: string[];
  /** How this advocate chose their line — their counterpart to a judge's protocol. */
  reasoning: string | null;
  created_at: string;
}

export interface VerdictRow {
  id: string;
  run_id: string;
  participant_id: string;
  verdict: VerdictKind;
  confidence: number;
  reasoning: string;
  points_credited: string[];
  points_rejected: string[];
  created_at: string;
}

export interface LlmCallRow {
  id: string;
  run_id: string;
  participant_id: string | null;
  phase: string;
  model_id: string;
  attempt: number;
  generation_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number;
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  created_at: string;
}
