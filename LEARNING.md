# Learning Notes

Personal reference, not a deliverable doc — updated as we build, explaining
*what* we implemented and *why*, in plain terms. Not subject to the
docs/ 200-line rule (see CLAUDE.md) since it's just for you.

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

## Why Backblaze B2 for raw file storage (not just parsing and discarding)

- The assignment only requires the *parsed* rows in a database — but keeping
  the original uploaded CSV as a private object gives us a re-processable
  audit trail: if the reconciliation logic changes later, you can re-run it
  against the original file without asking the user to re-upload.
- Bucket is **private** (not public) because the CSVs contain customer
  emails and amounts — anyone with the object URL could read them if it
  were public. The backend fetches using its own B2 credentials or a
  short-lived signed URL, generated fresh each time, never stored.
