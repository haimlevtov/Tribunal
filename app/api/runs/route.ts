import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_UNIFORM_MODEL, isAllowedUniformModel } from "@/lib/models";
import {
  assignModels,
  createParticipants,
  executeRun,
  type SeatNames,
} from "@/lib/orchestrator";
import { PERSONA_KEYS } from "@/lib/personas";
import { CreateRunInput } from "@/lib/schemas";
import { describeSetupError } from "@/lib/setup-errors";

export const runtime = "nodejs";
// The background work runs inside this invocation via waitUntil, so the ceiling
// has to cover the whole tribunal, not just the response. 300s is the Hobby max.
export const maxDuration = 300;

/** Cheap abuse ceiling. No IPs stored — a global cap is enough for a class demo. */
const MAX_RUNS_PER_DAY = 40;

async function runsInLastDay(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await db()
    .from("runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (error) throw new Error(`could not check run quota: ${error.message}`);
  return count ?? 0;
}

/**
 * Hand the run off to the platform so the response can return immediately.
 * Outside a Vercel request context (i.e. `next dev`) waitUntil throws, and a
 * plain floating promise is the right local equivalent.
 */
async function runInBackground(promise: Promise<void>): Promise<void> {
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(promise);
  } catch {
    void promise.catch((e) => console.error("[background run] unhandled:", e));
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = CreateRunInput.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid charge sheet.", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const requiredCode = process.env.TRIBUNAL_ACCESS_CODE;
  if (requiredCode && input.access_code !== requiredCode) {
    return NextResponse.json({ error: "Incorrect access code." }, { status: 401 });
  }

  // A uniform model arriving from the browser is untrusted: allow-list it, or a
  // caller could point the run at an expensive model.
  let uniformModelId: string | null = null;
  if (input.model_mode === "uniform") {
    const requested = input.uniform_model_id ?? DEFAULT_UNIFORM_MODEL;
    if (!isAllowedUniformModel(requested)) {
      return NextResponse.json({ error: "Unsupported model." }, { status: 400 });
    }
    uniformModelId = requested;
  }

  // Seat names from the browser. `key` names a seat, so an unknown key is rejected
  // rather than silently ignored — otherwise a typo would quietly run the default
  // character and the user would never know why their choice had no effect.
  const seatNames: SeatNames = {};
  if (input.character_mode === "named") {
    for (const c of input.character_names ?? []) {
      if (!PERSONA_KEYS.includes(c.key)) {
        return NextResponse.json(
          { error: `Unknown character seat: ${c.key}` },
          { status: 400 },
        );
      }
      seatNames[c.key] = c.name;
    }
    if (Object.keys(seatNames).length === 0) {
      return NextResponse.json(
        { error: "Name at least one character, or choose a different cast mode." },
        { status: 400 },
      );
    }
  }

  try {
    if ((await runsInLastDay()) >= MAX_RUNS_PER_DAY) {
      return NextResponse.json(
        { error: "Daily run limit reached. Try again tomorrow." },
        { status: 429 },
      );
    }

    const { data: run, error } = await db()
      .from("runs")
      .insert({
        charge_sheet: input.charge_sheet,
        model_mode: input.model_mode,
        uniform_model_id: uniformModelId,
        character_mode: input.character_mode,
        status: "queued",
      })
      .select()
      .single();

    if (error || !run) {
      throw new Error(`could not create run: ${error?.message}`);
    }

    const models = assignModels(input.model_mode, uniformModelId);
    await createParticipants(run.id, models, input.character_mode, seatNames);

    await runInBackground(executeRun(run.id));

    return NextResponse.json({ run_id: run.id }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/runs]", message);
    return NextResponse.json({ error: describeSetupError(message) }, { status: 500 });
  }
}
