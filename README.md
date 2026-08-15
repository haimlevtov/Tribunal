# The Tribunal

A courtroom simulation run by LLMs. You write a charge sheet; four advocates argue it — two for
the accused, two against — and three judges then rule **independently**, without seeing each
other's verdicts. The app returns three verdicts, the reasoning behind each, and a full token
and cost ledger. It deliberately does **not** aggregate the verdicts into one answer: the
decision is left to you.

Every model in the default configuration is **free**. A complete run costs **$0.00**.

See [PLAN.md](PLAN.md) for the architecture and the reasoning behind each decision.

---

## Three ways to cast the tribunal

| Cast mode | What the user does | What the backend does |
|---|---|---|
| **Standing cast** | Nothing | Runs the seven built-in characters. Repeatable, and what the example charge sheet is tuned for. |
| **Name them yourself** | Types a name per seat — "Atticus Finch", "a tired public defender", "my grandmother" | Forges a full personality to fit each name and its seat |
| **Let the system decide** | Nothing | Invents a cast chosen to make *this* charge sheet hard to settle |

The last two add **one** model call to the run (8 instead of 7): the whole cast is written in a
single call, which keeps the daily free-tier budget intact and lets the model see all seven
seats at once — which is what stops it writing the same character twice.

System prompts are never written in the browser. The user supplies at most a *name*; the
identity is composed server-side, and the fiction framing and injection guard are appended by
`buildSystemPrompt()` so a forged character can't drop them.

If a name contradicts its seat — "Javert" on the defence bench — the character keeps the name
and the manner but argues the side the seat requires. The seat always wins.

If the forge fails, the run falls back to the standing cast and continues rather than dying.

## Two model modes

| Mode | What it does | Why |
|---|---|---|
| **Uniform** | One model drives all seven characters | Differences come purely from personality — isolates the variable |
| **Per-character** | Seven distinct models, one per seat | More varied, but personality and model are confounded |

Both are selectable per run and recorded in the database, so the same charge sheet can be run
in both modes and compared.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the database schema

The Supabase project is at `pbxfspcfrsunscglejfn`. Open the
[SQL editor](https://supabase.com/dashboard/project/pbxfspcfrsunscglejfn/sql/new), paste the
contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and run it.

It creates five tables (`runs`, `participants`, `speeches`, `verdicts`, `llm_calls`), a trigger
that maintains per-run token/cost totals, and enables RLS with **no** permissive policies —
the browser can never reach Postgres directly.

### 3. Configure secrets

```bash
cp .env.example .env.local
```

Fill in two values:

- `OPENROUTER_API_KEY` — from [openrouter.ai/keys](https://openrouter.ai/keys). A free account
  is enough; no credits needed.
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase dashboard → Project Settings → API → `service_role`.

None of these may carry a `NEXT_PUBLIC_` prefix. They must stay server-side.

### 4. Verify the model roster

```bash
npm run smoke
```

Probes all seven free models, confirms strict JSON mode works, and confirms OpenRouter is
returning cost data. Costs $0. If a model or two is unavailable that's normal — free endpoints
rotate, and the fallback chain handles it at runtime.

### 5. Run

```bash
npm run dev
```

---

## Deploying to Vercel

Import the repo at [vercel.com/new](https://vercel.com/new), then add `OPENROUTER_API_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_URL`) under Settings → Environment Variables. The
Hobby plan's 300s function ceiling is enough for a full run; `maxDuration` is already set.

---

## Rate limits

OpenRouter's free tier allows **20 requests/minute** and **50 requests/day**. One tribunal is
7 requests, so that's **7 complete runs per day**. Ample for a class demo, worth knowing before
you demo live. The app also caps itself at 40 runs/day globally.

---

## How a run works

```
POST /api/runs                    validate → insert run + 7 seats → return run_id (202)
  └─ background (waitUntil)
       wave 0: forge the cast in one call   (only for named / auto)
       wave 1: 4 advocates in parallel, blind to each other
       wave 2: 3 judges in parallel, given all speeches, blind to each other
GET  /api/runs/[id]               polled every 1.5s; UI fills in progressively
```

Judges see the speeches labelled by side but **never by model** — a judge that knew one advocate
ran on a 2.6B model would be judging the roster rather than the argument.

---

## Cost tracking

Every attempt, including failures and retries, is written to `llm_calls` with tokens, cost,
latency, and the OpenRouter generation id. Cost comes from `usage: { include: true }` on each
request — without that flag OpenRouter omits the cost field entirely.

The UI shows a per-model breakdown and a run total at the bottom of every verdict page.

---

## Security notes

- All five tables have RLS enabled with no permissive policies. Only the service-role key
  (server-side) can read or write.
- Character descriptions, the prompt framing, and the judging rubric live in server-only modules
  and are verified absent from the client bundle.
- The charge sheet is untrusted input: it's wrapped in explicit delimiters and every persona is
  instructed to treat its contents as subject matter, never as instructions.
- User-supplied character names are untrusted too. They're length-capped, wrapped in delimiters
  inside the forge prompt, and the forge is told to treat them as plain names — never as
  instructions. Forged output is length-capped and still gets the injection guard appended.

---

## Layout

```
app/
  page.tsx                  charge sheet form (server → client form)
  charge-sheet-form.tsx     mode selector, model picker
  run/[id]/                 live verdict board (polls)
  api/runs/                 POST create · GET status+results
lib/
  personas.ts               7 default characters + prompt framing   SERVER ONLY
  persona-forge.ts          writes a cast from names, or from scratch
  rubric.ts                 judging rubric          SERVER ONLY
  models.ts                 rosters + fallback chains
  openrouter.ts             3-tier JSON, retries, cost capture
  orchestrator.ts           two-wave run engine
  budget.ts                 spend guard (inert while free-only)
  schemas.ts                Zod + JSON Schema
  db.ts                     service-role client
supabase/migrations/        schema
scripts/smoke.mjs           roster pre-flight
```
