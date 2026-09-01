import { db } from "./db";

/**
 * Spend guard.
 *
 * The default roster is still $0, so a default run never spends — but paid
 * models are now reachable (see lib/models.ts), which makes this the thing
 * standing between a public URL and a real bill. Two ceilings, both checked
 * before every paid attempt:
 *
 *   MAX_RUN_SPEND_USD    one run cannot consume the whole allowance
 *   MAX_TOTAL_SPEND_USD  cumulative, all-time, across every run ($5 by default)
 *
 * Both read the ledger rather than a counter in memory, so the ceiling survives
 * a cold start, a redeploy, and several concurrent serverless invocations.
 */

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

function envUsd(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A single run can't consume the whole ceiling on its own. */
export function maxRunSpendUsd(): number {
  return envUsd("MAX_RUN_SPEND_USD", 0.05);
}

export function maxTotalSpendUsd(): number {
  return envUsd("MAX_TOTAL_SPEND_USD", 5.0);
}

/**
 * Cumulative spend across every run, all time.
 *
 * Read from the per-run totals the `llm_calls` trigger maintains, not by
 * re-aggregating the ledger itself: this now runs before every paid attempt, and
 * `runs` has one row per tribunal where `llm_calls` has upwards of seven.
 */
export async function totalSpendUsd(): Promise<number> {
  const { data, error } = await db().from("runs").select("total_cost_usd");
  if (error) throw new Error(`budget check failed: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + Number(r.total_cost_usd ?? 0), 0);
}

export async function runSpendUsd(runId: string): Promise<number> {
  const { data, error } = await db()
    .from("runs")
    .select("total_cost_usd")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`budget check failed: ${error.message}`);
  return Number(data?.total_cost_usd ?? 0);
}

function assertTotal(total: number, estimatedCostUsd: number): void {
  const ceiling = maxTotalSpendUsd();
  if (total + estimatedCostUsd > ceiling) {
    throw new BudgetExceededError(
      `Total cap reached: $${total.toFixed(4)} of $${ceiling.toFixed(
        2,
      )} spent all-time. Raise MAX_TOTAL_SPEND_USD to continue on paid models.`,
    );
  }
}

/**
 * Called before each paid attempt inside a run. Throws rather than returning a
 * boolean so a caller cannot forget to check the result.
 */
export async function assertWithinBudget(
  runId: string,
  estimatedCostUsd: number,
): Promise<void> {
  const [total, thisRun] = await Promise.all([totalSpendUsd(), runSpendUsd(runId)]);

  const runCeiling = maxRunSpendUsd();
  if (thisRun + estimatedCostUsd > runCeiling) {
    throw new BudgetExceededError(
      `Run cap reached: this run has spent $${thisRun.toFixed(4)} of $${runCeiling.toFixed(
        2,
      )}.`,
    );
  }

  assertTotal(total, estimatedCostUsd);
}

/**
 * The same guard for work that happens before a run exists — reading an uploaded
 * dossier. Only the all-time ceiling applies, there being no run to charge it
 * to. That spend cannot be written to `llm_calls` either (the ledger requires a
 * run id), so a dossier read is bounded by this check but does not itself count
 * towards the total. At a fraction of a cent per upload the drift is immaterial;
 * it is recorded here so nobody has to rediscover it.
 */
export async function assertWithinTotalBudget(estimatedCostUsd: number): Promise<void> {
  assertTotal(await totalSpendUsd(), estimatedCostUsd);
}
