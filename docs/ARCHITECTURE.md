# Architecture

## Stack (locked)

- **Next.js 16.3 + TypeScript, App Router** — one app, one language. API routes are the backend, pages are the frontend.
- **Prisma + PostgreSQL (Neon free tier)** — real database, auto-generated types. Connects through Neon's **serverless driver over WebSocket/443** (`@prisma/adapter-neon`), not the standard Postgres port 5432, which some networks block outright. This is also the recommended driver for serverless hosts like Vercel.
- **Auth: custom, not a third-party provider** — email + password, bcrypt hash, our own JWT in an httpOnly cookie. Every API route checks the cookie and scopes queries to `userId`.
- **Raw file storage: Backblaze B2 (private bucket)** — the uploaded CSVs themselves are stored here, not just their parsed rows. See "File storage" below for exactly how.
- **Parsing and reconciliation: TypeScript, not Python.** The dataset is ~200 rows total — no performance case for pandas/dataframes here. Keeping it TypeScript means one language, one service, one thing to explain in the review, rather than a second Python service talking to the Node one over the network.
- **LLM: Groq (`openai/gpt-oss-20b`), OpenAI-compatible SDK** — free tier, JSON mode for structured output. `llama-3.3-70b-versatile` (the original choice) was decommissioned by Groq; swapped for a currently-active model verified against `GET /openai/v1/models`. Gemini (`gemini-flash-lite-latest` — an alias, not a pinned version, so it can't go stale the same way) is an **automatic** fallback — `lib/llm.ts` calls it only when Groq itself errors (rate limit, outage, decommissioned model, etc.), not a manual backup.
- **Docker: local dev only** (hot reload via volume mount). **Deploy target: Vercel** — Next.js's native platform, zero container config, generous free tier. No production Dockerfile is built; the dev Docker setup stays a local convenience only.
- **Either `npm run dev` on the host or Docker works for local dev.** The Docker path had `ETIMEDOUT` database failures until the base image moved from Alpine to Debian (see the Docker section below).

## File storage — how it actually works

The B2 bucket is **Private**, which is the correct, required setting (customer emails and amounts live in these files). That has one real consequence worth being precise about:

- The database does **not** store a plain public URL for the uploaded file. It stores the file's **key** (its path inside the bucket, e.g. `uploads/<userId>/orders-<timestamp>.csv`).
- When the app actually needs to read the file back (to parse it), the backend uses its own B2 credentials to either fetch the object directly, or generate a short-lived **signed URL** (expires in minutes) and fetch through that. A signed URL is never stored — it's generated fresh each time it's needed.
- This means: upload → raw bytes go to B2 → the **key** is written to Postgres via Prisma → parsing step reads the file back from B2 using that key → parsed rows are written to `Order` / `Payment` tables, tagged with `userId`.

Why keep the raw file at all, when the brief only requires the *parsed* data in a database? Because it gives a defensible answer in the review ("why is there a bucket here") — it's a re-processable audit trail: if the reconciliation logic changes, you can re-run it against the original upload without asking the user to upload again. That's the one-sentence justification to have ready.

## Explicitly NOT using

- No NextAuth / Clerk / Auth0 — one less dependency, one less thing to break on a live demo.
- No Python service for parsing or reconciliation — see above.
- No production Dockerfile — Vercel builds Next.js natively, no container needed for deploy.

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
  llm.ts                     <- the one LLM call (Groq, Gemini fallback), structured output + error handling
prisma/
  schema.prisma
docs/
  ARCHITECTURE.md            <- this file
  RECONCILIATION-RULES.md    <- classification spec + tolerances
  BUILD-PLAN.md              <- task checklist against the clock
seed/
  orders.csv
  payments.csv
Dockerfile.dev                <- local dev only, hot reload via volume mount
docker-compose.yml            <- local dev only
README.md                    <- written LAST, after the app works
.env.example
```

## Naming — do not skip this

The brief: *"Do not mention any company. Our company name and product must not appear anywhere in the code, commits, README, repository name, or the application itself."*

- The **GitHub repo name must not reference the company**, even split or disguised (e.g. `result-flow`, `resultflow`, `rf-recon`). Use something generic and descriptive: `orders-payments-reconciler`, `recon-dashboard`, `revenue-recon`.
- No cloud resource (bucket, DB instance name, project name) should contain it either — anything that shows up in a URL or a dashboard screenshot during the review call counts as "the application itself." (The bucket is already named `recon-uploads-kv` — safe.)
- This local folder name (`result_flow_assignment`) never gets pushed — it's just your working directory. Only the GitHub repo name and any live URLs matter.

## Docker (local development)

- **Base image: `node:22-slim` (Debian/glibc), not Alpine.** Alpine was the original choice for size, but its `musl` libc DNS resolver is unreliable for hostnames that return multiple A *and* AAAA records — which is exactly what Neon's pooler hostname does. That caused persistent `ETIMEDOUT` failures reaching the database from inside the container. Debian's glibc resolver handles it correctly. `prisma/schema.prisma`'s `generator client` block matches the base image:
  ```prisma
  binaryTargets = ["native", "debian-openssl-3.0.x"]
  ```
- **Rebuild required whenever `package.json` changes.** `RUN npm install` happens once, at image build time — it is baked into that layer. Adding a new dependency (Prisma, bcryptjs, groq-sdk, csv-parse, the B2/S3 SDK, all still to come) and just restarting the container will **not** pick it up; the container will run against the old `node_modules` baked into the image. After adding any dependency, rebuild with:
  ```
  docker compose up --build
  ```
  Editing existing `.ts`/`.tsx` source files does **not** need a rebuild — those are bind-mounted live from the host, which is what makes hot reload work. Only a `package.json` change (or a change to `Dockerfile.dev` itself) needs `--build`.
- **No production Dockerfile** — deploy target is Vercel (see Stack above), which builds Next.js natively. Only `Dockerfile.dev`, `docker-compose.yml`, and `.dockerignore` exist, and stay local-dev-only.
