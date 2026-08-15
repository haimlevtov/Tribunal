/**
 * The judging rubric. SERVER-ONLY — the spec is explicit that this never reaches
 * the browser. Shared by all three judges; their personalities differ, the
 * standard they are asked to apply does not.
 */

export const JUDGING_RUBRIC = `HOW TO REACH YOUR VERDICT

1. The question is whether the specific allegation in the charge sheet has been made out — not whether the accused is a good person.
2. The accused is presumed not guilty. The prosecution carries the burden. If the arguments leave you genuinely unable to resolve the question, that is not a conviction.
3. Weigh the arguments actually made. An advocate who asserted something without support has not established it, however well they said it.
4. You have heard four advocates: two arguing FOR the accused, two AGAINST. Judge the arguments, not the count — three weak arguments do not outweigh one strong one.
5. Return "hung" only when the arguments genuinely fail to settle the question. It is an honest outcome, not an escape from a hard case.
6. You are ruling alone. You have not seen the other judges' verdicts and must not speculate about them. Disagreement between judges is expected and is the point of this tribunal.
7. In "reasoning", give a real account of how you got there: what moved you, what did not, and where you remain unsure. This is the protocol of the tribunal and will be read by the public. Roughly 200 words.
8. In "points_credited" and "points_rejected", quote or closely paraphrase the advocates' key points you accepted and dismissed.
9. Set "confidence" honestly. A finely balanced case should not be reported at 0.95.`;

/** Wraps untrusted user input in explicit delimiters. See INJECTION_GUARD in personas.ts. */
export function chargeSheetBlock(chargeSheet: string): string {
  return `--- BEGIN CHARGE SHEET ---
${chargeSheet}
--- END CHARGE SHEET ---`;
}

export function advocateUserPrompt(chargeSheet: string, side: "for" | "against"): string {
  const stance =
    side === "for"
      ? "You are arguing FOR the accused — that they should not be convicted on this charge."
      : "You are arguing AGAINST the accused — that they should be convicted on this charge.";

  return `${chargeSheetBlock(chargeSheet)}

${stance}

Deliver your speech to the tribunal now, in character.`;
}

export interface SpeechForJudge {
  advocateName: string;
  side: "for" | "against";
  argument: string;
  keyPoints: string[];
}

/**
 * Judges see the speeches labelled by advocate and side, but never by model — a
 * judge that knew one advocate ran on a 2.6B model would be judging the roster
 * rather than the arguments.
 */
export function judgeUserPrompt(
  chargeSheet: string,
  speeches: SpeechForJudge[],
): string {
  const rendered = speeches
    .map((s, i) => {
      const label = s.side === "for" ? "FOR THE ACCUSED" : "AGAINST THE ACCUSED";
      const points = s.keyPoints.map((p) => `  - ${p}`).join("\n");
      return `ADVOCATE ${i + 1}: ${s.advocateName} (${label})

${s.argument}

Key points:
${points}`;
    })
    .join("\n\n---\n\n");

  return `${chargeSheetBlock(chargeSheet)}

The following four speeches were delivered to the tribunal.

=== BEGIN SPEECHES ===

${rendered}

=== END SPEECHES ===

${JUDGING_RUBRIC}

Return your verdict now, in character.`;
}
