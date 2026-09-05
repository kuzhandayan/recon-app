# Learning Notes

Personal reference, not a deliverable doc — updated as we build, explaining
*what* we implemented and *why*, in plain terms. Not subject to the
docs/ 200-line rule (see CLAUDE.md) since it's just for you.

## Requirement checklist — what the brief asked for, what's done

| Requirement | Status | Where |
|---|---|---|
| Auth: signup/login, per-user isolation, hashed passwords, protected routes | Done | `lib/auth.ts`, `proxy.ts` |
| Data ingestion: upload both CSVs into a real database | Done | `app/api/upload`, `app/api/parse` |
| Reconciliation engine: deterministic, no LLM in the matching | Done, verified against real data | `lib/reconcile.ts` |
| Dashboard: headline stats, chart, filterable/searchable drill-down | Done, verified against real data | `components/Dashboard.tsx` + children |
| LLM integration: backend-only, structured output, temperature choice, never decides matching | Done | `lib/llm.ts`, `app/api/explain` |
| Frontend quality: loading/error states, including during the LLM call | Done | `ExplainPanel.tsx` |
| Deploy everything, live URL | Not done — local/Docker only so far | — |
| README: setup, architecture, reconciliation logic, findings, LLM approach, next steps, AI-tool note | Done | `README.md` |
| `.env.example` | Done | `.env.example` |

## "Why this, not that" — quick answers for the defend-your-decisions round

The brief says the next round walks through specific commits and asks *why*. These are the
one-line versions; each has a fuller entry below or in `docs/`.

- **Why Next.js for both frontend and backend, not a separate API service?** One language, one
  deploy target, one thing to explain. API routes under `app/api/` are a real backend (they
  run server-side, never ship to the browser) — this isn't a shortcut, it's App Router doing
  what it's designed for.
- **Why Prisma + Postgres, not a NoSQL store or raw SQL?** The data is inherently relational
  (users own orders, orders relate to payments, payments produce discrepancies) — a document
  store would just be simulating joins badly. Prisma over raw SQL: generated types catch a
  typo'd column name at compile time instead of a runtime query failure, and `schema.prisma`
  is one file that documents the whole data model, useful to point at in a review call.
- **Why custom auth, not NextAuth/Clerk/Auth0?** One less dependency, one less third-party
  outage risk on a live demo, and the requirement (email+password, hash, session) is simple
  enough that a library adds surface area without adding real safety — `bcryptjs` + a signed
  JWT in an httpOnly cookie *is* the standard pattern those libraries wrap anyway.
- **Why TypeScript for the reconciliation engine, not Python/pandas?** ~200 rows total — no
  performance case for a dataframe library. Same language as the rest of the app means no
  second service, no network hop between a Python worker and the Node app, one less thing to
  operate and explain.
- **Why keep the raw CSV in B2 instead of just the parsed rows (which is all the brief
  requires)?** Re-processability: if the reconciliation logic changes, it can be re-run
  against the original upload without asking the user to upload again. Private bucket because
  the files contain customer emails and amounts.
- **Why Groq + Gemini fallback instead of just OpenAI?** Both are free-tier and sufficient for
  a two-sentence explanation task — no reason to spend on a paid API for this. Two providers
  (not one) because a single point of failure on a live demo is a bad look; Gemini only fires
  when Groq itself errors, so under normal operation only one provider's quota is ever spent.
- **Why the smallest model on each provider, not the largest available?** The task is
  summarizing an already-computed classification in 1-2 sentences each — that doesn't need a
  large model's reasoning depth, and a smaller model means the free-tier quota lasts through
  a full demo/review session instead of getting rate-limited mid-walkthrough.
- **Why temperature 0.2 specifically, not 0 or the default (~0.7-1)?** The brief requires the
  *matching* to be deterministic, not the LLM's prose — the classification and dollar amount
  are already fixed by `reconcile.ts` before the LLM ever sees the row, so the LLM changing a
  word of phrasing between runs costs nothing. 0 buys no real benefit here since there's no
  correctness at stake in phrasing, only naturalness — a temperature-0 output reads
  noticeably flatter/more repetitive. The default is too high: JSON-mode outputs get more
  prone to a stray malformed response as temperature rises, and there's no upside to variety
  in a factual 2-sentence explanation. 0.2 is the "boring but reliable" middle: close to
  deterministic, low risk of a broken JSON response, still reads like a sentence a person
  wrote rather than a template.
- **Why cache the explanation instead of calling the LLM every time a row is viewed?** Cost
  and speed — the underlying discrepancy doesn't change between views, so there's nothing new
  to explain. Cache invalidates specifically when reconciliation re-runs (deletes and
  recreates all discrepancy rows), which is exactly when a stale explanation could describe
  numbers that no longer apply — not on a timer, not manually, tied to the one event that
  actually invalidates it.

## Cookies vs localStorage (auth)

- **httpOnly cookie** — the server sets it via a `Set-Cookie` response header.
  Browser JS (`document.cookie`) cannot read or touch it. The browser
  automatically attaches it to every request to the same domain. This is
  what we're using for the JWT.
- **localStorage** — plain key/value storage, fully readable by any JS
  running on the page. If a JWT sits here and an attacker manages to inject
  a script (XSS), they can read the token and impersonate the user forever
  (until it expires). This is why we're NOT using it.
- Extra flags we'll set on the cookie: `secure` (HTTPS only), `sameSite=lax`
  (blocks it being sent on cross-site requests, mitigates CSRF).

## Why Prisma (not raw SQL / another ORM)

- Auto-generates TypeScript types from the schema — the compiler catches
  typos in field names instead of failing at runtime.
- `schema.prisma` is one readable file that documents the whole data model —
  useful in a review call, easy to diff.
- Migrations are tracked and reproducible (`prisma migrate dev`), rather than
  hand-written SQL scripts you have to remember to run in order.

## Why UUIDs for primary keys (not auto-increment integers)

- Auto-increment ints leak information (e.g. "user #4" tells you how many
  users exist, easy to enumerate: `/api/user/5`, `/api/user/6`...).
  UUIDs aren't guessable or sequential.
- Fine at this data scale (~200 rows) — the usual argument against UUIDs
  (larger index size, slightly slower joins) doesn't matter here.

## Why Prisma 7's binaryTargets matters for Docker

- Prisma ships a compiled query engine binary. The dev Docker image is
  `node:22-alpine`, which uses `musl` libc instead of the more common `glibc`.
  The default engine binary is compiled for `glibc` and simply won't run
  inside the Alpine container.
- Adding `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` tells
  Prisma to also compile/download an engine binary for musl, so `npx prisma
  generate` produces a client that works both on your host machine
  (`native`) and inside the Alpine container.

## Cross-checking docs against the real assignment files

- The actual brief and CSVs live outside this repo (`~/result-flow-ai-assignment/`,
  never committed). Checked the real `orders.csv` / `payments.csv` headers
  against the Prisma schema — they match field-for-field
  (`order_id, order_date, customer_email, currency, gross_amount, discount,
  net_amount, status` and `transaction_ref, processed_at, order_reference,
  currency, amount, fee, net_settled, type, status`).
- Found one real inconsistency: the original data-analysis notes called
  `OVERCHARGED` a **High** severity discrepancy, but the finalized rules doc
  had downgraded it to Medium. Fixed: `OVERCHARGED` is money you actively
  owe a customer back (a refund liability) — that's more urgent than
  `UNDERCHARGED` (revenue you simply never collected), so it should read as
  High, not be grouped with `UNDERCHARGED` at Medium just because both are
  "amount tolerance" checks.

## Why the migration had to run from your own terminal, not the agent's

- `npx prisma migrate dev` failed with `P1001: Can't reach database server`
  when run from the agent's sandboxed shell, even though raw TCP/TLS to the
  same host worked fine from that shell. Sending an actual Postgres protocol
  packet got an immediate connection reset.
- Likely cause: free-tier database providers often rate-limit or block
  connections from known cloud/datacenter IP ranges to prevent abuse. The
  agent's sandbox runs in such an environment; your Mac's home/ISP IP does
  not have this problem. Running the same command from your own terminal
  worked immediately.
- Practical takeaway: DB migrations against Neon need to run from your own
  machine (or a real deploy pipeline), not from an agent's sandboxed shell.

## Auth: what actually got built, and one Next.js 16 surprise

- `lib/auth.ts` — bcrypt hash/compare (cost factor 12) and JWT sign/verify.
- Login always runs `bcrypt.compare`, even when the email doesn't exist (against
  a dummy hash), so a wrong-password response and a no-such-user response take
  the same amount of time. Otherwise an attacker could tell which emails are
  registered just by measuring response time (skipping bcrypt entirely for
  "no such user" is much faster than actually comparing a hash).
  This is a named, standard technique (**user enumeration via timing attack**
  mitigation) — it's in OWASP's Authentication Cheat Sheet, and Django and
  Devise both do the same dummy-hash trick internally. Not something
  invented for this project; safe to reuse as the default pattern in any
  login route from now on, including in other projects.
- **`middleware.ts` doesn't exist anymore in Next.js 16** — it's renamed to
  `proxy.ts`, exporting a `proxy` function instead of `middleware`. Checked
  the bundled docs before writing this since AGENTS.md warns this Next.js
  version has breaking changes from training data. Bonus: Proxy now defaults
  to the **Node.js runtime** (it used to be Edge-only), which matters because
  `jsonwebtoken` needs Node's `crypto` module and doesn't work on Edge.
- `proxy.ts` protects `/dashboard` and all `/api/*` except `/api/auth/*`. When
  the JWT is valid, it forwards the decoded `userId` to the route via an
  `x-user-id` header, so individual routes don't each need to re-verify the
  JWT — they just trust the header, since it can only be set by proxy.ts
  (client-set headers with that name get overwritten, not merged).

## Why hot reload wasn't working in Docker (only picked up changes on manual refresh)

- `docker-compose.yml` already had `WATCHPACK_POLLING=true` set, which is the
  standard fix for Docker's bind-mounted volumes not propagating native
  filesystem change events (common on macOS) to the dev server's watcher —
  so it looked like this was already handled.
- The catch: **`WATCHPACK_POLLING` only affects webpack's file watcher.**
  Next.js 16 defaults to **Turbopack** for `next dev` (a separate, Rust-based
  bundler with its own watcher), and Turbopack doesn't read that env var at
  all. So the container's watcher genuinely wasn't seeing file changes at
  all — a manual browser refresh still showed the latest code because Next's
  dev server recompiles the requested route fresh on each request
  regardless of the watcher, but the automatic live-reload push over
  WebSocket (the part that updates the page without you touching refresh)
  never fired.
- Fix: run the dev container with `next dev --webpack` instead of the
  Turbopack default, so `WATCHPACK_POLLING` actually applies. This only
  affects the Docker path — running `npm run dev` directly on the host still
  uses Turbopack, since the bind-mount problem doesn't exist there.

## The occasional slow request / one-time dashboard crash isn't a bug — it's Neon waking up

- After switching to `npm run dev`, one request to `/dashboard` still threw a
  Prisma error once, and a couple of auth requests took 2-3 seconds instead
  of the usual <100ms — then everything went back to normal immediately.
- This is Neon's free-tier compute **auto-suspending after a few minutes of
  no queries**, then taking a moment to wake back up on the next request. If
  you pause between clicks while testing (reading a page, typing a
  password), that's often enough idle time to trigger it. It's expected
  free-tier behavior, not something to eliminate — Neon is designed exactly
  this way to stay inside the free compute-hour budget (same reason
  `/api/health` doesn't touch the DB, see above).
- Two changes to handle it gracefully instead of crashing:
  - `lib/db.ts`: raised `connectionTimeoutMillis` to 10s on the pg pool, so
    a slow-but-eventually-successful wake-up doesn't get killed early.
  - `app/dashboard/error.tsx`: a Next.js error boundary that shows "the
    database may still be waking up, try again" with a retry button,
    instead of a raw crash — since even with a longer timeout, a wake-up can
    occasionally still take longer than one request should wait.

## The real reason the database kept failing: port 5432 was blocked

- Every database error this session — `ETIMEDOUT`, `ECONNRESET`, "Server has
  closed the connection", "Connection terminated unexpectedly" — traced back
  to one cause, and it was never our code.
- The test that proved it, run against the same host at the same moment:

  | Port | TCP | TLS |
  |---|---|---|
  | 443 | OK | **OK** (full handshake) |
  | 5432 | OK | **ECONNRESET** |

  TLS to the *same server* succeeds on 443 and gets reset on 5432. That's a
  firewall inspecting traffic and killing Postgres connections — typical of
  campus, corporate, and some public networks.
- Two earlier tests pointed the same way and are worth remembering as
  technique:
  - Connecting with a **deliberately wrong password** produced the *identical*
    error. A reachable server would answer `28P01 password authentication
    failed`. Same error for a wrong password proves the connection never
    reaches authentication.
  - Disabling TLS verification entirely changed nothing, ruling out
    certificates.
- Fix: **`@prisma/adapter-neon` + `@neondatabase/serverless`**, which tunnel
  Postgres over WebSocket on **port 443** — the port we proved works. `pg` and
  `@prisma/adapter-pg` were removed; nothing uses 5432 anymore.
- This isn't only a workaround: the Neon serverless driver is the
  recommended one for serverless hosts like Vercel, so the app is better off
  on it regardless of network.
- The Neon driver needs a WebSocket implementation. The obvious choice is the
  `ws` package, but that pulls optional **native addons** (`bufferutil`),
  which crashed in Docker with `TypeError: bufferUtil.mask is not a function`
  — compiled-for-macOS binaries don't run in a Linux container. Instead of
  fighting that, we use Node's **built-in global `WebSocket`** (stable in
  Node 22+, and both the host and `node:22-slim` have it). One less
  dependency, and no compiled binaries to mismatch.
- **Known limitation:** the `prisma migrate` CLI still connects on 5432
  directly and has no adapter option, so schema migrations fail on a network
  that blocks it. The schema is already applied, so this only matters for
  future changes — run those from an unblocked network (a phone hotspot
  works), or apply the SQL through Neon's web console.
- Debugging lesson: when a connection fails, test **a different port on the
  same host** early. It separates "the service is down" from "this port is
  blocked" in one step, and those have completely different fixes.

## The "correct password rejected" scare — not a bug

- Reported symptom: entered the right password, login still said wrong.
- Verified the code against the running server: signup → 201, login with the
  same password → **200**, login with a wrong password → 401. The logic is
  correct.
- What actually happened, visible in the server log:
  `POST /api/auth/signup 409` → `GET /login` → `POST /api/auth/login 401`.
  The signup was rejected because that email **already had an account from
  an earlier attempt**. Then login was attempted with the password just
  typed into the signup form — but the stored account was created earlier
  with a different password. So the password felt right, but wasn't the one
  on file for that account.
- Fixed the confusing part rather than the (correct) logic: the 409 message
  now reads "...Log in using that account's original password," so the next
  person doesn't fall into the same trap.
- General lesson: when auth "mysteriously" rejects valid input, read the
  status codes in order. The 409 before the 401 told the whole story.

## The real cause of Docker's ETIMEDOUT: Alpine's musl DNS resolver

- Symptom: from inside the Docker container, every connection to Neon failed
  with `ETIMEDOUT` — including the boot-time health check — while the exact
  same code with `npm run dev` on the host connected instantly, every time.
- The `NODE_OPTIONS=--dns-result-order=ipv4first` attempt didn't fix it,
  which ruled out the "Node picked an unreachable IPv6 address" theory.
- Actual cause: the base image was **`node:22-alpine`**, and Alpine uses
  **`musl` libc** instead of glibc. musl's DNS stub resolver is known to be
  unreliable when a hostname returns several A *and* AAAA records — it fires
  the lookups in parallel and handles timeouts/retries poorly. Neon's pooler
  hostname returns exactly that shape (we saw 3 IPv4 + 3 IPv6 addresses for
  it), so it hit musl's weak spot every time.
- Fix: **`node:22-slim`** (Debian, glibc) as the base image instead. glibc's
  resolver handles multi-record hostnames correctly. The image is somewhat
  larger than Alpine, which is a fine trade for a dev image that actually
  works. `binaryTargets` in `schema.prisma` changed to
  `debian-openssl-3.0.x` to match.
- **Confirmed working**: after `docker compose up --build`, the container
  logs `[startup] Database connected successfully`. Both `docker compose up`
  and `npm run dev` are now valid ways to run this locally.
- **Later correction**: the port-5432 block (see above) was discovered
  afterwards and was likely the dominant cause of the connection failures
  all along — the network simply wasn't blocking at the moment the Alpine
  fix was tested. Keeping `node:22-slim` regardless: glibc's resolver is
  still the safer default, and the musl DNS weakness is real. But the
  honest read is that this fix was less decisive than it looked at the time.
- Lesson worth keeping: when something works on the host but times out in a
  container, suspect **DNS resolution inside the image** before suspecting
  the network, the database, or the application code. "Alpine + musl + DNS"
  is a common enough combination to check early.

## Why Prisma/Postgres timed out (ETIMEDOUT) only inside Docker

- Signup worked fine with `npm run dev` on the host, but failed with
  `ETIMEDOUT` reaching Neon from inside the Docker container.
- Neon's pooler host resolves to both IPv4 (A) and IPv6 (AAAA) addresses.
  Docker Desktop's default bridge network doesn't give containers a working
  IPv6 route, but Node (since a few major versions ago) no longer prefers
  IPv4 by default — it uses whatever order the OS resolver returns. If that
  happens to be an IPv6 address first, the connection attempt goes nowhere
  and eventually times out (`ETIMEDOUT`), rather than failing fast.
- Fix: `NODE_OPTIONS=--dns-result-order=ipv4first` in `docker-compose.yml`,
  forcing Node to always try the IPv4 address first inside the container.
  Nothing changes on the host, since this only applies within the container
  where the env var is set.

## Why /api/health doesn't query the database

- First version ran `SELECT 1` against Postgres on every health check, to
  confirm the DB was actually reachable ("readiness"), not just that the
  Next.js process was up ("liveness").
- Wrong call for this specific setup: **Neon's free tier auto-suspends its
  compute when idle**, which is how it stays inside the free 100 CU-hours/
  month budget. A hosting platform's health checker typically polls every
  10-30 seconds, forever. If that poll touches the DB every time, the
  compute never gets an idle window to suspend — it stays awake 24/7,
  burning through the monthly compute budget in days instead of the
  intended month of light, bursty usage.
- Fixed: `/api/health` now only confirms the Next.js process itself is
  running, no DB call. `instrumentation.ts`'s one-time boot-time check is
  enough evidence that the DB is reachable at deploy time — that only runs
  once per deploy/restart, not on a poll loop.

## Why we switched from Railway/Fly.io back to Vercel for deploy

- Original ARCHITECTURE.md logic: "production Docker" was explicitly
  requested, and Vercel doesn't run custom Dockerfiles, so deploy had to
  move to a Docker-friendly host (Railway or Fly.io).
- Revisited this: dropped the production-Dockerfile requirement and moved
  to Vercel instead — it deploys Next.js natively with no container config,
  has a generous free tier, and is what this kind of take-home is usually
  reviewed on anyway. This also fixed an existing inconsistency: BUILD-PLAN.md's
  Deploy step already said "Vercel," while ARCHITECTURE.md said Railway/Fly —
  the docs disagreed with each other before this.
- The **local dev Docker setup stays exactly as built** (`Dockerfile.dev`,
  `docker-compose.yml`) — that's a local convenience only, separate from how
  the app actually gets deployed. Nothing there changes.

## Re-uploading payments.csv silently doubled every payment — Payment had no unique constraint

- Symptom: uploaded `orders.csv` + `payments.csv`, ran reconciliation, numbers
  matched the data-findings doc exactly (verified line by line). Then
  re-uploaded the same `payments.csv` again to test the flow a second time —
  `Total payments` jumped from 187 to 374, and 180 of 184 orders suddenly
  showed as `DUPLICATE_PAYMENT`.
- Not a reconciliation bug: the engine was reacting correctly to what was
  actually in the database. Every payment row genuinely existed twice, so
  every order genuinely had two identical charges — `DUPLICATE_PAYMENT` was
  the right call for that (corrupted) input.
- Root cause: `Order` has `@@unique([userId, orderKey])`, and its insert
  already used `skipDuplicates: true` — so re-uploading `orders.csv` silently
  no-ops on the second pass (`Total orders` correctly stayed at 184).
  `Payment` had **no unique constraint at all**, and its insert had no
  `skipDuplicates`, so a repeat upload just blindly appended 187 more rows.
- Key distinction that made the fix safe: a *real* double-charge (the
  `DUPLICATE_PAYMENT` case the engine is supposed to catch, e.g. `ORD-1501`
  charged twice) always has **two different transaction refs**
  (`TXN700167`, `TXN700168`) — see data-findings.md: "Transaction refs are
  distinct, so deduplication has to key on (order reference, amount, close
  processing time) — not on the transaction ref." A re-uploaded file
  duplicate has the **same** transaction ref appearing twice. So a
  uniqueness rule on `transactionRef` blocks only the accidental-reupload
  case and never touches the real business case, which the engine already
  keys on amount-within-an-order instead.
- Fix, in order (schema changes need existing duplicates gone first, or the
  migration fails on the constraint violation):
  1. Deleted the duplicated rows directly in Neon (kept the earliest row per
     `(userId, transactionRef)`, via a `ROW_NUMBER() OVER (PARTITION BY ...)`
     delete — `npx prisma db execute --file=...`, not `migrate dev`, which
     needs a TTY and fails non-interactively).
  2. Added `@@unique([userId, transactionRef])` to `Payment` in
     `prisma/schema.prisma`, matching the pattern `Order` already had.
  3. Added `skipDuplicates: true` to the payment insert in
     `app/api/parse/route.ts`, and changed `duplicatesDropped` from a
     hardcoded `0` to `rows.length - count` — same as the order insert.
  4. `prisma migrate dev` also refused to run non-interactively; worked
     around it with `prisma migrate diff --script` to get the exact SQL,
     hand-wrote the migration folder to match Prisma's naming convention,
     then `prisma migrate deploy` to apply it. Applied cleanly with zero
     conflicts, confirming step 1 fully cleaned the duplicates first.
- After the fix: a repeat upload of the same payments file gets silently
  ignored (no doubling), while a genuine double-charge in the source data is
  still caught and shown as `DUPLICATE_PAYMENT`, unaffected by this change.

## Why Prisma migration commands need `--file` / `--create-only`-style workarounds here

- `npx prisma migrate dev` refuses to run at all in this environment:
  `Error: Prisma Migrate has detected that the environment is
  non-interactive, which is not supported.` Both the plain form and
  `--create-only` hit the same wall — Prisma 7's `migrate dev` unconditionally
  wants a TTY, even when only creating a migration file (no prompt content
  needed for a single additive change).
- Working pattern for a one-off additive migration from this shell:
  1. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
     — prints the exact SQL Prisma would generate, without touching anything.
  2. Hand-create `prisma/migrations/<timestamp>_<name>/migration.sql` with
     that SQL, matching the existing folder-naming convention so `migrate
     deploy`'s history table recognizes it as one more entry in sequence.
  3. `npx prisma migrate deploy` — this one *does* run non-interactively
     (it's meant for CI/deploy pipelines), applies the migration, and updates
     Prisma's `_prisma_migrations` tracking table.
  4. `npx prisma generate` to regenerate the client against the new schema.
- Also relevant from earlier: DB migrations sometimes need to run from a
  network that isn't blocking Postgres's port (see "the real reason the
  database kept failing" above) — this session's network wasn't blocked, so
  that wasn't the issue this time, only the TTY requirement was.

## Why Backblaze B2 for raw file storage (not just parsing and discarding)

- The assignment only requires the *parsed* rows in a database — but keeping
  the original uploaded CSV as a private object gives us a re-processable
  audit trail: if the reconciliation logic changes later, you can re-run it
  against the original file without asking the user to re-upload.
- Bucket is **private** (not public) because the CSVs contain customer
  emails and amounts — anyone with the object URL could read them if it
  were public. The backend fetches using its own B2 credentials or a
  short-lived signed URL, generated fresh each time, never stored.

## Building the LLM integration: both original model names were already dead

- The plan (`docs/ARCHITECTURE.md`) named `llama-3.3-70b-versatile` on Groq and a manual
  Gemini fallback. Wired up `lib/llm.ts` + `/api/explain/route.ts` + `ExplainPanel.tsx` exactly
  per the existing docs/schema (the `Discrepancy.explanation` field and `groq-sdk` dependency
  were already scaffolded), then the first real test call failed: `404 model_not_found`.
- Checked `GET /openai/v1/models` on the actual key instead of guessing a replacement — Groq
  had decommissioned that model entirely. The active text-chat models with JSON-mode support
  turned out to be `openai/gpt-oss-20b` and `openai/gpt-oss-120b`; picked the 20B one, since a
  two-sentence explanation of an already-classified row doesn't need the larger model's
  reasoning depth, and the smaller one preserves free-tier quota for a full demo/review.
- Promoted Gemini from "manual fallback" to **automatic**: `explainDiscrepancy()` tries Groq
  first, and only calls Gemini if Groq itself throws — so under normal operation only one
  provider's quota is ever touched.
- The Gemini side had the *same* staleness problem, twice over, before landing on a fix that
  actually holds: `gemini-2.0-flash` → 404 (deprecated), `gemini-2.5-flash` → 404 ("no longer
  available to new users"), `gemini-flash-latest` → 503 (temporarily overloaded, but at least a
  valid name), `gemini-3.1-flash-lite` → worked, confirmed with the exact request/response
  shape used by `lib/llm.ts`. But hardcoding "3.1" is exactly the mistake that killed the Groq
  model in the first place. Found `gemini-flash-lite-latest` — a semantic alias, not a pinned
  version — and confirmed it transparently resolves to whatever Google's current lite model is
  (`gemini-3.5-flash-lite` at the time of testing, per the `modelVersion` field in the
  response) without ever needing the code updated again as versions roll over.
- Lesson: **never trust a model name from docs, training data, or a plan written days earlier
  — hit the provider's own `/models` endpoint (or the docs bundled with the SDK) and verify
  live before wiring it in.** Two providers, two stale names, on the very first real test.

## The explanation drawer wasn't covering the full screen — an ancestor-transform bug

- Symptom: the "Explain" drawer (a `position: fixed` right-side panel) left a visible gap on
  one edge, showing un-dimmed page content behind the backdrop that was supposed to cover the
  whole viewport.
- Cause: `position: fixed` is normally relative to the *viewport* — but if any ancestor element
  has a CSS `transform`, `filter`, `perspective`, or similar property, that ancestor becomes
  the containing block for `fixed` descendants instead, and the "fixed" element only covers
  that ancestor's box, not the true screen. This is a well-known CSS gotcha, not obvious from
  the component's own code, since `ExplainPanel.tsx` itself never got a transform — some
  ancestor further up the tree did.
- Fix: render the backdrop + drawer through a **React Portal** (`createPortal(..., document.body)`)
  instead of in-place in the component tree. A portal only changes *where in the DOM* the
  element lives, not the React state/props relationship — so it escapes every ancestor's
  stacking context entirely and is guaranteed to cover the real viewport regardless of what any
  parent component does with CSS, now or in the future.
- Needed a `mounted` guard (`useEffect(() => setMounted(true), [])`) before calling
  `createPortal`, since `document` doesn't exist during server-side rendering — the portal only
  renders after the component has actually mounted in the browser.

## Two dark-mode contrast bugs: light Tailwind classes on a page that renders dark

- `app/globals.css` uses `prefers-color-scheme: dark` to flip the whole page to a near-black
  background with near-white text when the OS/browser is in dark mode — which is how this app
  was actually being viewed throughout testing.
- Bug 1: `ExplainPanel` was first built with `bg-gray-50` (a near-white fill) and no explicit
  text color, so the paragraph text inherited the page's near-white foreground — near-white
  text on a near-white background, unreadable. Fixed by dropping the fill entirely and using a
  border-only box like the rest of the dashboard (`StatTile` etc.), which already worked
  correctly in both themes.
- Bug 2: the "Explain"/"View" button's `hover:bg-gray-100` had the identical problem on hover —
  a light hover fill combined with inherited light text. Fixed with a theme-aware overlay
  instead of a solid light fill: `hover:bg-black/5 dark:hover:bg-white/10` — translucent, so it
  darkens on a light background and lightens on a dark one, staying legible either way.
- General lesson for this codebase: **never pair a plain light Tailwind fill class
  (`bg-gray-50`, `hover:bg-gray-100`, etc.) with inherited/unset text color** — either give the
  element an explicit text color that matches, or use a translucent black/white overlay
  (`black/5`, `white/10`) that adapts to whatever surface it sits on instead of a fixed light
  shade.

## Word-by-word reveal on a fresh explanation, instant on a cached "View"

- Feature request: make a first-time LLM explanation visibly "generate" (word-by-word, like
  it's being typed), so the UI reads as the AI actually working — but a second view of the same
  already-cached row should show the text immediately, since nothing is actually being
  generated the second time.
- Implementation: a `wasCachedOnOpen` ref, set once from the `cachedExplanation` prop at mount
  (a `key={selected.id}` on `<ExplainPanel>` forces a clean remount per row, so this never
  leaks state between different discrepancies). If the panel opened already cached, the full
  text renders immediately. If it opened fresh, a `setInterval` reveals one more word every
  ~45ms until the full response is shown, with a blinking cursor while incomplete.
- This is a pure UI/UX layer — it has no effect on caching, on how many LLM calls are made, or
  on what's stored in the database. The full explanation is already sitting in memory the
  moment the fetch resolves; the reveal is purely a rendering choice for how it appears.

## The "explain" request that showed as failed (ECONNRESET) wasn't a bug — React Strict Mode

- Symptom: the very first live test of `/api/explain` showed **two** network requests in
  DevTools — one canceled (red), one successful (200) — and the server log showed
  `Error: aborted / code: ECONNRESET` right before the successful request.
- Cause: Next.js has `reactStrictMode: true` by default (nothing in `next.config.ts` overrides
  it), and Strict Mode deliberately double-invokes effects in development only — mount, run
  effects, unmount (running cleanup), mount again — specifically to catch effects that don't
  clean up properly. `ExplainPanel`'s `useEffect` uses an `AbortController` or matches this
  pattern; the first mount's cleanup called `controller.abort()`, killing that in-flight
  request mid-flight — which the server correctly logs as a reset connection — before the
  second mount's fetch completed normally.
- Not a bug: it's proof the cleanup function *is* working (an uncleaned effect is what Strict
  Mode is designed to expose), and it's dev-mode-only noise — `next build && next start` never
  double-invokes effects, so this never happens in production.
- Lesson: **a paired canceled+successful request for the same endpoint, immediately after each
  other, in dev only, is the Strict Mode signature** — check `next.config.ts` for
  `reactStrictMode` before assuming a real race condition or backend flakiness.

## The `isReconciled` flag: closing the "did I already reconcile this data" gap

- Request: after uploading, a user shouldn't have to guess whether the discrepancy list on
  screen reflects the data currently on file — the UI should say so directly, per import.
- Added `isReconciled Boolean @default(false)` to the `Import` model. New uploads start false.
  `/api/reconcile`'s existing `$transaction` (which already deletes/recreates all of a user's
  `Discrepancy` rows on every run) got one more statement:
  `db.import.updateMany({ where: { userId }, data: { isReconciled: true } })` — marking every
  import current at the time of that run as covered by it, atomically with the rest.
- The self-correcting part: a *later* upload creates a brand-new `Import` row, which defaults
  back to `isReconciled: false` via the column default — nothing needs to explicitly "reset" it,
  the default does that for free. Verified live: uploaded, reconciled (flipped true), uploaded
  again (new row false, old row stayed true), exactly the intended behavior.
- `UploadForm.tsx` renders a badge per row — green "Reconciled" or yellow "Run reconciliation to
  see this" — driven directly by this field, no separate polling or check needed since the
  existing post-upload `refreshImports()` call already re-fetches it.
- Migration for this went through the same non-interactive workaround as the earlier
  `Payment.transactionRef` constraint (see above): `migrate diff --script` → hand-write the
  migration folder → `migrate deploy`.
