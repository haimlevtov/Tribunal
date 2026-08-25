#!/usr/bin/env node
/**
 * Pre-flight check. Verifies, without touching Supabase:
 *   1. OPENROUTER_API_KEY works
 *   2. each model in the per-character roster actually answers
 *   3. strict JSON mode returns parseable output
 *   4. `usage: { include: true }` really does return a cost field
 *
 * Run:  node scripts/smoke.mjs
 * The whole check costs $0 — every model below is free.
 */

import { readFileSync } from "node:fs";

// Minimal .env.local loader so this runs without extra dependencies.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // no .env.local — fall back to the ambient environment
}

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("✗ OPENROUTER_API_KEY is not set.");
  console.error("  Copy .env.example to .env.local and add a key from https://openrouter.ai/keys");
  process.exit(1);
}

const MODELS = [
  ["judge_1", "dots-studio/dots-3-note-preview:free", "strict"],
  ["judge_2", "nvidia/nemotron-3-super-120b-a12b:free", "strict"],
  ["judge_3", "z-ai/glm-5.2:free", "strict"],
  ["defence_1", "google/gemma-4-26b-a4b-it:free", "json_object"],
  ["defence_2", "google/gemma-4-31b-it:free", "json_object"],
  ["prosecution_1", "minimax/minimax-m2.7:free", "json_object"],
  ["prosecution_2", "nvidia/nemotron-3-ultra-550b-a55b:free", "prompt_only"],
];

const SCHEMA = {
  name: "smoke",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["guilty", "not_guilty", "hung"] },
      reasoning: { type: "string" },
    },
    required: ["verdict", "reasoning"],
  },
};

async function probe(modelId, jsonMode) {
  const body = {
    model: modelId,
    messages: [
      {
        role: "system",
        content:
          "You are a judge in a fictional courtroom exercise." +
          (jsonMode === "strict"
            ? ""
            : `\n\nReturn ONLY JSON matching: ${JSON.stringify(SCHEMA.schema)}`),
      },
      {
        role: "user",
        content:
          "Charge: the accused took the last coffee and did not start a new pot. Rule on it in one sentence.",
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
    usage: { include: true },
    reasoning: { exclude: true },
  };

  if (jsonMode === "strict") body.response_format = { type: "json_schema", json_schema: SCHEMA };
  else if (jsonMode === "json_object") body.response_format = { type: "json_object" };

  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, ms, detail: `HTTP ${res.status} ${text.slice(0, 160)}` };
  }

  const json = await res.json();
  if (json.error) return { ok: false, ms, detail: json.error.message ?? "provider error" };

  const content = json.choices?.[0]?.message?.content ?? "";
  const match = content.match(/\{[\s\S]*\}/);

  let parsed = null;
  try {
    parsed = JSON.parse(match ? match[0] : content);
  } catch {
    /* leave null */
  }

  return {
    ok: Boolean(parsed?.verdict),
    ms,
    cost: json.usage?.cost,
    promptTokens: json.usage?.prompt_tokens,
    completionTokens: json.usage?.completion_tokens,
    detail: parsed?.verdict ?? `unparseable: ${content.slice(0, 120)}`,
  };
}

console.log("Probing the free model roster (this costs $0)…\n");

let failures = 0;
let totalCost = 0;
let costReported = false;

for (const [seat, modelId, jsonMode] of MODELS) {
  process.stdout.write(`  ${seat.padEnd(15)} ${modelId.padEnd(45)} `);
  try {
    const r = await probe(modelId, jsonMode);
    if (r.cost !== undefined) {
      costReported = true;
      totalCost += r.cost;
    }
    if (r.ok) {
      console.log(`✓ ${String(r.ms).padStart(5)}ms  ${r.promptTokens}→${r.completionTokens} tok  $${(r.cost ?? 0).toFixed(6)}`);
    } else {
      failures++;
      console.log(`✗ ${r.detail}`);
    }
  } catch (err) {
    failures++;
    console.log(`✗ ${err.message}`);
  }
}

console.log("");
console.log(`Cost reporting: ${costReported ? "✓ usage.cost present" : "✗ no cost field — check `usage: {include: true}`"}`);
console.log(`Total for this probe: $${totalCost.toFixed(6)}`);

if (failures > 0) {
  console.log(`\n${failures}/${MODELS.length} model(s) unavailable.`);
  console.log("Free endpoints rotate — the fallback chain in lib/models.ts covers this at runtime.");
  console.log("If ALL failed, the key is likely wrong or you have hit the 50 free requests/day cap.");
  process.exit(failures === MODELS.length ? 1 : 0);
}

console.log("\n✓ All seven seats answered. The roster is good to go.");
