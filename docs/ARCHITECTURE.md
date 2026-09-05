# Architecture

## Stack (locked)

- **Next.js 16.3 + TypeScript, App Router** — one app, one language. API routes are the backend, pages are the frontend.
- **Prisma + PostgreSQL (Neon free tier)** — real database, auto-generated types.
- **Auth: custom, not a third-party provider** — email + password, bcrypt hash, our own JWT in an httpOnly cookie. Every API route checks the cookie and scopes queries to `userId`.
- **Raw file storage: Backblaze B2 (private bucket)** — the uploaded CSVs themselves are stored here, not just their parsed rows. See "File storage" below for exactly how.
- **Parsing and reconciliation: TypeScript, not Python.** The dataset is ~200 rows total — no performance case for pandas/dataframes here. Keeping it TypeScript means one language, one service, one thing to explain in the review, rather than a second Python service talking to the Node one over the network.
- **LLM: Groq (Llama 3.3 70B), OpenAI-compatible SDK** — free tier, JSON mode for structured output. Gemini free tier is the manual fallback if Groq rate-limits.
- **Docker: dev (hot reload via volume mount) and production (multi-stage build)** — both requested explicitly. Because of this, deploy moves off Vercel (Vercel doesn't run custom Dockerfiles) to a Docker-friendly host — Railway or Fly.io are the candidates, decided at deploy time.

## File storage — how it actually works

The B2 bucket is **Private**, which is the correct, required setting (customer emails and amounts live in these files). That has one real consequence worth being precise about:

- The database does **not** store a plain public URL for the uploaded file. It stores the file's **key** (its path inside the bucket, e.g. `uploads/<userId>/orders-<timestamp>.csv`).
- When the app actually needs to read the file back (to parse it), the backend uses its own B2 credentials to either fetch the object directly, or generate a short-lived **signed URL** (expires in minutes) and fetch through that. A signed URL is never stored — it's generated fresh each time it's needed.
- This means: upload → raw bytes go to B2 → the **key** is written to Postgres via Prisma → parsing step reads the file back from B2 using that key → parsed rows are written to `Order` / `Payment` tables, tagged with `userId`.

Why keep the raw file at all, when the brief only requires the *parsed* data in a database? Because it gives a defensible answer in the review ("why is there a bucket here") — it's a re-processable audit trail: if the reconciliation logic changes, you can re-run it against the original upload without asking the user to upload again. That's the one-sentence justification to have ready.

## Explicitly NOT using

- No NextAuth / Clerk / Auth0 — one less dependency, one less thing to break on a live demo.
- No Python service for parsing or reconciliation — see above.
- No Vercel — Docker requirement moves deploy to a container-friendly host instead.

## Data flow

1. User signs up / logs in → JWT set as httpOnly cookie.
2. User uploads `orders.csv` and `payments.csv` from the browser.
3. API route streams the raw file to the B2 bucket, gets back a key, writes `{ userId, kind, key, uploadedAt }` to an `UploadedFile` row in Postgres.
4. A parse step (triggered right after upload, or by a separate action) fetches the file back from B2 using the stored key, parses it in TypeScript, validates columns, and inserts rows into `Order` / `Payment` tables, tagged with `userId`.
5. User triggers reconciliation (or it runs automatically after parsing) → `lib/reconcile.ts` runs the deterministic engine over that user's orders + payments → writes `Discrepancy` rows.
6. Dashboard page queries aggregated totals + discrepancy list for that user, renders headline numbers, one chart, and a filterable drill-down table.
7. User clicks a discrepancy → API route sends its already-classified fields to Groq → returns a plain-English explanation → shown in the UI with loading/error states.

## Folder structure

```
app/
  (auth)/login/page.tsx
  (auth)/signup/page.tsx
  dashboard/page.tsx
  api/
    auth/signup/route.ts
    auth/login/route.ts
    upload/route.ts          <- streams file to B2, stores the key
    parse/route.ts           <- reads file back from B2, inserts rows
    reconcile/route.ts
    discrepancies/route.ts
    explain/route.ts         <- the one LLM call
lib/
  auth.ts                    <- hash, verify, sign/verify JWT
  db.ts                      <- Prisma client singleton
  storage.ts                 <- B2 upload / signed-URL / fetch helpers
  csv.ts                     <- CSV parsing + column validation
  reconcile.ts               <- the deterministic engine (isolated, unit-testable)
  llm.ts                     <- the one Groq call, structured output + error handling
prisma/
  schema.prisma
docs/
  ARCHITECTURE.md            <- this file
  RECONCILIATION-RULES.md    <- classification spec + tolerances
  BUILD-PLAN.md              <- task checklist against the clock
seed/
  orders.csv
  payments.csv
Dockerfile                   <- production, multi-stage build
Dockerfile.dev                <- development, hot reload via volume mount
docker-compose.yml            <- dev
docker-compose.prod.yml       <- production
README.md                    <- written LAST, after the app works
.env.example
```

## Naming — do not skip this

The brief: *"Do not mention any company. Our company name and product must not appear anywhere in the code, commits, README, repository name, or the application itself."*

- The **GitHub repo name must not reference the company**, even split or disguised (e.g. `result-flow`, `resultflow`, `rf-recon`). Use something generic and descriptive: `orders-payments-reconciler`, `recon-dashboard`, `revenue-recon`.
- No cloud resource (bucket, DB instance name, project name) should contain it either — anything that shows up in a URL or a dashboard screenshot during the review call counts as "the application itself." (The bucket is already named `recon-uploads-kv` — safe.)
- This local folder name (`result_flow_assignment`) never gets pushed — it's just your working directory. Only the GitHub repo name and any live URLs matter.
