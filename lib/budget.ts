import { db } from "./db";

/**
 * Spend guard.
 *
 * The default roster is entirely $0, so in the normal case this never fires and
 * never even queries. It exists for the ALLOW_PAID_FALLBACK=true path, so that a
 * demo left running cannot quietly spend real money.
 */

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** A single run can't consume the whole ceiling on its own. */
export const MAX_RUN_SPEND_USD = 0.05;

export function maxTotalSpendUsd(): number {
  const raw = process.env.MAX_TOTAL_SPEND_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5.0;
}

/** Cumulative spend across every run, all time. */
export async function totalSpendUsd(): Promise<number> {
  const { data, error } = await db().from("llm_calls").select("cost_usd");
  if (error) throw new Error(`budget check failed: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}

export async function runSpendUsd(runId: string): Promise<number> {
  const { data, error } = await db()
    .from("llm_calls")
    .select("cost_usd")
    .eq("run_id", runId);
  if (error) throw new Error(`budget check failed: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}

/**
 * Called before each paid attempt. Throws rather than returning a boolean so a
 * caller cannot forget to check the result.
 */
export async function assertWithinBudget(
  runId: string,
  estimatedCostUsd: number,
): Promise<void> {
  const [total, thisRun] = await Promise.all([totalSpendUsd(), runSpendUsd(runId)]);

  if (thisRun + estimatedCostUsd > MAX_RUN_SPEND_USD) {
    throw new BudgetExceededError(
      `Run cap reached: this run has spent $${thisRun.toFixed(4)} of $${MAX_RUN_SPEND_USD}.`,
    );
  }

  const ceiling = maxTotalSpendUsd();
  if (total + estimatedCostUsd > ceiling) {
    throw new BudgetExceededError(
      `Total cap reached: $${total.toFixed(4)} of $${ceiling.toFixed(2)} spent all-time.`,
    );
  }
}
