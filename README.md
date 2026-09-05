# Orders & Payments Reconciler

Ingests an orders export and a payments export, reconciles them deterministically against
a fixed set of business rules, and presents the result as a dashboard someone responsible
for revenue could actually act on — headline figures, a breakdown by discrepancy type, a
filterable drill-down table, and an on-demand AI explanation for any individual row.

## Setup and running locally

Requirements: Node 22+, a Postgres database (this project targets [Neon](https://neon.tech)'s
free tier), a [Groq](https://console.groq.com) API key (free tier), optionally a
[Gemini](https://aistudio.google.com) API key and a Backblaze B2 bucket.

```bash
npm install
cp .env.example .env   # fill in the variables — see .env.example for what each one is for
npx prisma migrate deploy
npm run dev
```

Open `http://localhost:3000`, sign up with any email/password, upload `orders.csv` and
`payments.csv`, click **Run reconciliation**, and the dashboard populates.

Docker is also supported for local dev (hot reload via a bind-mounted volume):

```bash
docker compose up --build
```

No test account is seeded — sign-up is open and takes a few seconds.

## Architecture

- **Next.js 16 (App Router) + TypeScript** — one app, one language. API routes under `app/api/`
  are the backend; pages under `app/` are the frontend.
- **Prisma + PostgreSQL (Neon)**, connected over Neon's serverless driver on **WebSocket/443**
  (`@prisma/adapter-neon`) instead of the standard Postgres port 5432, which some networks
  block outright — also the recommended driver for serverless hosts like Vercel.
- **Auth: custom** — email + password, `bcryptjs` hash (cost 12), a JWT signed with
  `jsonwebtoken` in an httpOnly cookie. `proxy.ts` (Next.js 16's renamed middleware) verifies
  the cookie on every request to `/dashboard` and `/api/*` except the auth routes themselves,
  and forwards the verified `userId` to route handlers via an `x-user-id` header — so
  individual routes never need to re-verify a JWT, they just trust a header only the proxy
  can set.
- **Raw file storage: Backblaze B2** (S3-compatible, private bucket) — the uploaded CSVs
  themselves are kept, not just their parsed rows, as a re-processable audit trail: if the
  reconciliation logic changes later, it can be re-run against the original file without
  asking the user to re-upload. The bucket is private because the files contain customer
  emails and amounts; the backend reads them back with its own credentials or a short-lived
  signed URL, never a stored public link.
- **Reconciliation: plain TypeScript**, not Python/pandas — the dataset is ~200 rows total, so
  there's no performance case for a dataframe library, and keeping it in the same language as
  everything else means one thing to explain in a review, not two services talking over a
  network.
- **LLM: Groq primary, Gemini automatic fallback** — see the LLM section below.

**Data flow:** sign up/log in → upload both CSVs → each is parsed and normalized server-side,
rows inserted into `Order`/`Payment` tables scoped by `userId` → click "Run reconciliation" →
`lib/reconcile.ts` runs a pure, deterministic function over that user's current orders and
payments → writes `Discrepancy` rows → the dashboard queries aggregated totals and the
discrepancy list → clicking "Explain" on any real discrepancy calls the LLM once, caches the
result on that row.

**Folder structure (as built):**

```
app/
  (auth)/login, (auth)/signup       — auth pages
  dashboard/page.tsx                — the whole app: upload, headline tiles, chart, drill-down
  api/
    auth/{signup,login,logout}
    upload/route.ts                 — receives a file, sends it to B2, stores the key
    parse/route.ts                  — reads the file back from B2 by key, inserts rows
    reconcile/route.ts              — runs lib/reconcile.ts, marks imports isReconciled
    discrepancies/route.ts          — headline stats + paginated/filtered drill-down list
    explain/route.ts                — the one LLM call per discrepancy, cached afterward
    health/route.ts                 — liveness only, no DB query (see LEARNING.md)
lib/
  auth.ts        — hash/verify, JWT sign/verify
  db.ts          — Prisma client singleton (Neon adapter)
  storage.ts     — B2 upload / signed-URL / fetch
  csv.ts         — CSV parsing, column validation, file-kind detection
  reconcile.ts   — the deterministic engine, pure function, no I/O
  llm.ts         — the one Groq/Gemini call, structured output + error handling
components/      — UploadForm, Dashboard, StatTile, DiscrepancyChart, DiscrepancyTable, ExplainPanel
prisma/          — schema.prisma + migrations
docs/            — ARCHITECTURE.md, RECONCILIATION-RULES.md, FEATURES.md, BUILD-PLAN.md
```

## Reconciliation logic

The engine (`lib/reconcile.ts`) is a pure function — `(orders, payments) => Discrepancy[]` —
with no database access, no `Date.now()`, no `Math.random()` inside it, so the same input
always produces the same output. Before any comparison, keys are normalized (trim + uppercase)
and duplicate order rows are dropped, so formatting noise in the source files can't manufacture
fake discrepancies.

Every order is classified into exactly one of 15 buckets, checked in priority order
(most severe first):

| # | Class | Condition | Severity |
|---|---|---|---|
| 1 | `DUPLICATE_PAYMENT` | ≥2 charges, same order, same amount | Critical |
| 2 | `PAID_BUT_CANCELLED` | order cancelled, a settled charge exists | Critical |
| 3 | `MISSING_PAYMENT` | order completed, no payment row at all | High |
| 4 | `FAILED_PAYMENT` | payment exists, status = failed | High |
| 5 | `ORPHAN_PAYMENT` | payment references no existing order | High |
| 6 | `OVERCHARGED` | charge − order amount > tolerance | High |
| 7 | `CURRENCY_MISMATCH` | order currency ≠ payment currency | Medium |
| 8 | `PARTIAL_REFUND` | order refunded, refund < original charge | Medium |
| 9 | `UNRECORDED_REFUND` | refund fully offsets a charge, order still "completed" | Medium |
| 10 | `UNDERCHARGED` | order amount − charge > tolerance | Medium |
| 11 | `PENDING_PAYMENT` | payment status = pending | Low |
| 12 | `DELAYED_SETTLEMENT` | settlement lag > 72h, money did arrive | Low |
| 13 | `MISSING_FIELDS` | null in a non-amount field (email, discount, processed_at) | Low |
| 14 | `WITHIN_TOLERANCE` | amount difference ≤ tolerance | Not a discrepancy |
| 15 | `MATCHED` | everything agrees | Clean |

**Tolerances chosen, and why:**

- **Amount: $0.05 absolute, not a percentage.** The largest rounding noise observed in the
  real data is $0.02; the smallest genuine discrepancy is $18.50. $0.05 sits cleanly between
  them. A percentage tolerance was rejected because it scales with order size and would hide
  real errors on large orders.
- **Duplicate detection keys on (order, amount), never on transaction ID or time gap.** A real
  duplicate charge always has two *different* transaction IDs — the processor issues a new one
  per charge attempt, even for a mistaken repeat. Keying on transaction ID would miss every
  real duplicate. The two seeded duplicates in the sample data happen to be 29 minutes apart,
  but that number isn't hardcoded into the rule — it wouldn't generalize.
- **Currency is never numeric-compared.** A EUR 210 charge against a USD 210 order is not a
  match just because the digits match — it's its own class regardless of numeric equality.
- **Settlement lag threshold: 72 hours.** Clean orders in the sample settle within ~2 hours
  (median 41 minutes); the one anomalous case took 696 hours. 72h catches it with a wide
  margin and zero false positives on the clean set.

**Determinism:** the result list is sorted by a fixed key (order key ascending) before being
returned, so row order is identical across runs too, not just the classification.

## What was found in the data

Analysis of the real `orders.csv` (185 rows, 184 distinct after one duplicate row) and
`payments.csv` (187 rows) turned up 15 distinct discrepancy types, roughly **$1.7k across 25
orders out of a ~$42k book** (about 4% of value, 13% of orders):

- **Missing payments** (4 orders, $392.35) — goods shipped, money never arrived.
- **Orphan payments** (3, $308.00) — settled charges against order IDs that don't exist —
  deleted orders, bad references, or chargeback exposure.
- **Duplicate payments** (2 pairs, $248.58 owed back) — the same order charged twice under
  two distinct transaction IDs.
- **A currency swap** (2 orders) — a USD order charged in EUR and vice versa, same numeric
  amount, which would look matched under naive comparison but represents real FX exposure.
- **A cancelled order that still got charged** ($175, full refund liability), a **partial
  refund** left $120 outstanding, and an **unrecorded refund** that overstates revenue by $99.
- **A failed payment counted as a sale** ($310) and a **pending payment** ($67, not lost, just
  in transit) — kept as separate classes since one is a real loss and the other isn't.
- **A 29-day settlement delay** on one order against a ~2-hour baseline everywhere else.
- **Formatting noise that would fabricate false positives if not normalized**: two transaction
  references with stray case/whitespace (`" ord-1801 "`), and one duplicate order row —
  without deduplication these alone would produce 2 fake missing-payments, 2 fake orphans, and
  double-count $27.34 of revenue.
- **Three cases of genuine rounding noise** (≤ $0.02) that are correctly *excluded* from the
  dispute totals under the $0.05 tolerance — flagging these would mean inventing problems that
  aren't real.
- **Two traps in the file format itself**: payment dates are `DD/MM/YYYY` not `MM/DD` (116 of
  187 rows have a day value above 12, which proves it — parsing it wrong would fabricate
  timing anomalies across the whole file), and every processing fee is exactly
  `2.9% × amount + $0.30` with zero exceptions, so there's no fee discrepancy to build a rule
  for.

**What it means for the business:** about $769 was never collected at all (missing, failed,
and pending payments), about $629 is owed back to customers (duplicate charges, a charge on a
cancelled order, an unfinished refund, and one overcharge), and $308 came in against orders
that don't exist in the system — money that needs to be traced or is chargeback exposure
either way.

## LLM approach

`lib/llm.ts` is called only from `app/api/explain/route.ts`, never from `reconcile.ts` — the
LLM explains an already-decided classification, it never influences whether two records match.

- **Prompting.** The system prompt is deliberately narrow: it states the classification has
  already been made by a deterministic engine, instructs the model to never suggest a
  different classification or question whether the match is correct, and asks for exactly two
  fields — `whatHappened` and `recommendedAction` — capped at 1-2 concrete sentences each, "no
  hedging, no restating the class name verbatim." The user message is the discrepancy's own
  data as JSON (order key, class, severity, amount, details) — no extra scaffolding, since the
  model only needs the facts already computed, not raw CSV rows.
- **Model: Groq `openai/gpt-oss-20b`, with an automatic fallback to Gemini
  `gemini-flash-lite-latest` if Groq errors** (rate limit, outage, decommissioned model, etc).
  Both are the smallest capable models on their respective free tiers, not the largest
  available — a two-sentence explanation of an already-classified row doesn't need a large
  model's reasoning power, and a smaller model means the free-tier quota lasts far longer.
  Gemini's `-latest` alias is used instead of a pinned version number so it doesn't go stale
  the way Groq's original model choice did mid-project (see `LEARNING.md`).
- **Structured output.** Both providers are asked for JSON mode with a fixed shape —
  `{"whatHappened": string, "recommendedAction": string}` — via `response_format` (Groq) and
  `responseMimeType` (Gemini).
- **Temperature: 0.2.** The brief only requires the *reconciliation matching* to be
  deterministic, not the LLM's phrasing — a discrepancy's classification and amount are fixed
  by `reconcile.ts` regardless of what the LLM says. 0.2 keeps the output close to
  deterministic and factual (not 0, which buys nothing here since correctness isn't at stake,
  only how natural the sentence reads) while avoiding the more creative, higher-variance
  output a default temperature would give.
- **Handling bad responses.** `parseExplanation()` validates the JSON: empty response, invalid
  JSON, or a missing field all throw a specific error, caught in the route and returned as a
  clean `502` with a message — never an unhandled crash. The UI shows that message with a
  close button instead of hanging or breaking.
- **Cost control.** The explanation is generated once per discrepancy and saved onto that row;
  every later view of the same row (`"View"` instead of `"Explain"`) returns the cached text
  with zero additional API calls. Re-running reconciliation deletes and recreates the
  discrepancy rows (since the underlying data may have changed), which resets the cache —
  intentional, so a cached explanation can never describe numbers that no longer apply.

## Frontend states

Loading and error states exist for upload, parse, reconciliation, and the LLM call
specifically: a spinner while a discrepancy is being explained, a word-by-word reveal on a
freshly-generated answer (instant on a cached one), and a clear error message with a retry
path if the LLM call fails. Uploaded files show an `isReconciled` badge — new uploads default
to "not reconciled," flip to reconciled once "Run reconciliation" completes, and reset again
on the next upload, so it's always clear from the UI whether the discrepancy list reflects the
data currently on file.

## What's next with more time

- Explain a *set* of discrepancies at once (the brief allows either; single-row was built
  first as the floor requirement) — e.g. "explain all Critical items" as one summarized call.
- Per-customer / per-time-window views on top of the existing discrepancy data.
- A retry button on a failed LLM call instead of requiring the drawer to be reopened.
- Rate-limit handling with backoff on the Groq call specifically, rather than relying on the
  Gemini fallback to absorb every failure mode.

## AI tool usage

Built with Claude Code. Used for the initial scaffold, the reconciliation engine (matched
against the real CSVs and iterated until every class/amount lined up with a manual analysis of
the data), the LLM integration, and debugging a handful of environment-specific issues (Docker
networking, Prisma migrations in a non-interactive shell, a stale Groq model that had been
decommissioned mid-project). Every decision — the tolerances, the classification order, the
model choices, the caching strategy — was reviewed and is understood well enough to defend;
see `LEARNING.md` for the full reasoning behind each one.
