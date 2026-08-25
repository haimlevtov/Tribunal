import type { z } from "zod";
import { fallbackChain, type ModelSpec } from "./models";
import type { JsonSchemaSpec } from "./schemas";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** One HTTP attempt against one model. Every attempt becomes a row in llm_calls. */
export interface CallAttempt {
  modelId: string;
  attempt: number;
  generationId?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd: number;
  latencyMs: number;
  httpStatus?: number;
  error?: string;
}

export interface CallResult<T> {
  data: T;
  /** The model that actually answered — not necessarily the one assigned. */
  modelId: string;
  attempts: CallAttempt[];
}

export class OpenRouterError extends Error {
  constructor(message: string, readonly attempts: CallAttempt[]) {
    super(message);
    this.name = "OpenRouterError";
  }
}

interface CallOptions<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  jsonSchema: JsonSchemaSpec;
  model: ModelSpec;
  temperature: number;
  maxTokens: number;
  /** Consulted before each *paid* attempt; throws to abort. */
  onPaidAttempt?: (estimatedCostUsd: number) => void | Promise<void>;
}

const HTTP_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pull the first balanced JSON object out of a response. Needed for models that
 * support no JSON mode at all, and as a safety net for models that claim strict
 * mode but still wrap output in prose or code fences.
 */
export function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const haystack = fenced ? fenced[1] : text;

  const start = haystack.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < haystack.length; i++) {
    const ch = haystack[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

function responseFormatFor(model: ModelSpec, jsonSchema: JsonSchemaSpec) {
  switch (model.jsonMode) {
    case "strict":
      return { type: "json_schema", json_schema: jsonSchema };
    case "json_object":
      return { type: "json_object" };
    case "prompt_only":
      return undefined;
  }
}

/**
 * Models without strict mode need the shape restated in the prompt, or they
 * return prose. Cheap to always include for the two weaker tiers.
 */
function schemaInstruction(model: ModelSpec, jsonSchema: JsonSchemaSpec): string {
  if (model.jsonMode === "strict") return "";
  return `\n\nReturn ONLY a JSON object matching this schema, with no commentary, no explanation, and no markdown fences:\n${JSON.stringify(
    jsonSchema.schema,
    null,
    2,
  )}`;
}

interface RawCall {
  content: string;
  attempt: CallAttempt;
}

/** One model, one attempt, with backoff on 429/5xx. Returns raw text. */
async function callOnce(
  model: ModelSpec,
  messages: Array<{ role: string; content: string }>,
  jsonSchema: JsonSchemaSpec,
  temperature: number,
  maxTokens: number,
  attemptNo: number,
): Promise<RawCall> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const body: Record<string, unknown> = {
    model: model.id,
    messages,
    temperature,
    max_tokens: maxTokens,
    // Without this, OpenRouter omits `cost` from the usage object entirely.
    usage: { include: true },
    // Every free model is now a reasoning model, and by default the chain of
    // thought arrives in `content` — so the JSON never appears and the response
    // stops at max_tokens mid-thought. Excluding it puts the answer back in
    // `content`, where the parser expects it.
    reasoning: { exclude: true },
  };

  const rf = responseFormatFor(model, jsonSchema);
  if (rf) body.response_format = rf;

  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional OpenRouter attribution headers.
      "HTTP-Referer": process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000",
      "X-Title": "The Tribunal",
    },
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      content: "",
      attempt: {
        modelId: model.id,
        attempt: attemptNo,
        costUsd: 0,
        latencyMs,
        httpStatus: res.status,
        error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
      },
    };
  }

  const json = (await res.json()) as {
    id?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  };

  if (json.error) {
    return {
      content: "",
      attempt: {
        modelId: model.id,
        attempt: attemptNo,
        costUsd: 0,
        latencyMs,
        httpStatus: 200,
        error: json.error.message ?? "unknown provider error",
      },
    };
  }

  const content = json.choices?.[0]?.message?.content ?? "";

  return {
    content,
    attempt: {
      modelId: model.id,
      attempt: attemptNo,
      generationId: json.id,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
      costUsd: json.usage?.cost ?? 0,
      latencyMs,
      httpStatus: 200,
      error: content ? undefined : "empty completion",
    },
  };
}

function isRetryable(status?: number): boolean {
  return status === 429 || status === 408 || (status !== undefined && status >= 500);
}

/**
 * Call a seat's model and return validated, typed JSON.
 *
 * Order of escalation: HTTP retries with backoff → one repair attempt feeding the
 * validation error back → next model in the fallback chain. Every attempt is
 * recorded so the cost ledger reflects failures too.
 */
export async function callForJson<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  const attempts: CallAttempt[] = [];
  const chain = fallbackChain(opts.model);

  for (const model of chain) {
    if (!model.free && opts.onPaidAttempt) {
      // Rough pre-flight estimate; the guard decides whether to allow it.
      await opts.onPaidAttempt(0.002);
    }

    const messages = [
      { role: "system", content: opts.system + schemaInstruction(model, opts.jsonSchema) },
      { role: "user", content: opts.user },
    ];

    let attemptNo = 0;
    let repairUsed = false;

    while (attemptNo < HTTP_RETRIES) {
      attemptNo++;
      let raw: RawCall;

      try {
        raw = await callOnce(
          model,
          messages,
          opts.jsonSchema,
          opts.temperature,
          opts.maxTokens,
          attemptNo,
        );
      } catch (err) {
        attempts.push({
          modelId: model.id,
          attempt: attemptNo,
          costUsd: 0,
          latencyMs: 0,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(BACKOFF_MS[Math.min(attemptNo - 1, BACKOFF_MS.length - 1)]);
        continue;
      }

      attempts.push(raw.attempt);

      if (raw.attempt.error) {
        // A rate-limited free model will not recover within this run's lifetime —
        // move down the chain instead of burning backoff on it.
        if (raw.attempt.httpStatus === 429) break;
        if (isRetryable(raw.attempt.httpStatus)) {
          await sleep(BACKOFF_MS[Math.min(attemptNo - 1, BACKOFF_MS.length - 1)]);
          continue;
        }
        break; // non-retryable (400, 402, 404…) — try the next model
      }

      const candidate = extractJsonObject(raw.content) ?? raw.content;
      let parsedUnknown: unknown;

      try {
        parsedUnknown = JSON.parse(candidate);
      } catch {
        parsedUnknown = undefined;
      }

      const result = opts.schema.safeParse(parsedUnknown);
      if (result.success) {
        return { data: result.data, modelId: model.id, attempts };
      }

      // Record why the response was rejected. Without this the attempt row keeps
      // `error: undefined` (the HTTP call did succeed) and the run reports the
      // useless "Last error: unknown" when the chain is exhausted.
      raw.attempt.error = `schema validation failed: ${result.error.message.slice(0, 300)}`;

      // One repair pass: hand the model its own bad output plus the error.
      if (!repairUsed) {
        repairUsed = true;
        messages.push(
          { role: "assistant", content: raw.content.slice(0, 4000) },
          {
            role: "user",
            content: `That response was not valid against the required schema.\n\nError: ${result.error.message.slice(
              0,
              600,
            )}\n\nReturn ONLY the corrected JSON object. No commentary, no markdown fences.`,
          },
        );
        continue;
      }

      break; // repair failed too — next model
    }
  }

  throw new OpenRouterError(
    `All models exhausted for this seat. Last error: ${
      attempts[attempts.length - 1]?.error ?? "unknown"
    }`,
    attempts,
  );
}
