#!/usr/bin/env node
/**
 * Regression guard for the verdict inversion.
 *
 * The bug: a charge sheet framed "justified / not justified" was judged
 * correctly and then recorded backwards. Three judges on three different models
 * each wrote "the breach was not justified" in their protocol and returned
 * `not_guilty` — which the rubric defines as *justified*. Every verdict on that
 * run said the opposite of the reasoning printed beside it.
 *
 * The cause was not model weakness. `VERDICT_ALIASES` already mapped
 * "not_justified" onto "guilty", but VERDICT_JSON_SCHEMA offered the model only
 * guilty/not_guilty/hung, and `strict: true` meant the decoder physically could
 * not emit the words the alias map understood. So each judge had to invert its
 * own conclusion at the moment of writing the token — and "not justified" is
 * lexically pulled straight to "not_guilty".
 *
 * This checks the fix from both ends: the model is offered the vocabulary, and
 * the server maps it onto the stored kind. It makes no network calls and costs
 * nothing.
 *
 * Run:  npm run verdict-check
 */

import {
  normaliseVerdict,
  VerdictOutput,
  VERDICT_JSON_SCHEMA,
} from "../lib/schemas.ts";

let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) {
    console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log("\nThe justification vocabulary normalises to the stored kinds");
check("'not justified' → guilty", normaliseVerdict("not justified"), "guilty");
check("'not_justified' → guilty", normaliseVerdict("not_justified"), "guilty");
check("'Not Justified' → guilty", normaliseVerdict("Not Justified"), "guilty");
check("'justified' → not_guilty", normaliseVerdict("justified"), "not_guilty");

console.log("\nAnd strict decoding actually offers it to the model");
const offered = VERDICT_JSON_SCHEMA.schema.properties.verdict.enum;
console.log(`      enum: ${JSON.stringify(offered)}`);
check("offers 'not_justified'", offered.includes("not_justified"), true);
check("offers 'justified'", offered.includes("justified"), true);
check("still offers 'guilty'", offered.includes("guilty"), true);
check("still offers 'not_guilty'", offered.includes("not_guilty"), true);
check("still offers 'hung'", offered.includes("hung"), true);

console.log("\nA judge that concludes 'not justified' is stored as guilty");
const verdict = (v) =>
  VerdictOutput.safeParse({
    verdict: v,
    confidence: 0.7,
    reasoning: "The accused bypassed a lawful exemption route.",
    points_credited: ["The exemption procedure existed and was not used."],
    points_rejected: ["A small private breach averted a greater public loss."],
  });

const notJustified = verdict("not_justified");
check("parses", notJustified.success, true);
check("stored as guilty", notJustified.success ? notJustified.data.verdict : null, "guilty");

const justified = verdict("justified");
check("'justified' stored as not_guilty", justified.success ? justified.data.verdict : null, "not_guilty");

// The whole point is that these two do NOT collapse together.
check(
  "'not_justified' and 'not_guilty' stay opposite",
  notJustified.success && notJustified.data.verdict !== verdict("not_guilty").data?.verdict,
  true,
);

console.log("\nAnd the judge's own word survives for the stamp to quote");
check(
  "'not_justified' is kept verbatim",
  notJustified.success ? notJustified.data.verdict_as_returned : null,
  "not_justified",
);
check(
  "'justified' is kept verbatim",
  justified.success ? justified.data.verdict_as_returned : null,
  "justified",
);
check(
  "'guilty' is kept verbatim",
  verdict("guilty").data?.verdict_as_returned ?? null,
  "guilty",
);
// A word outside the offered vocabulary still stores correctly, but there is
// nothing worth quoting — the board falls back to the mapped kind.
const acquitted = verdict("acquitted");
check("'acquitted' still stores as not_guilty", acquitted.data?.verdict ?? null, "not_guilty");
check("'acquitted' leaves nothing to quote", acquitted.data?.verdict_as_returned ?? null, null);

if (failures > 0) {
  console.log(`\n✗ ${failures} check(s) failed — a verdict may record the opposite of its reasoning.\n`);
  process.exit(1);
}

console.log("\n✓ Verdicts record what the reasoning says.\n");
