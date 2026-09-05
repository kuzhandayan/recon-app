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

## Why Backblaze B2 for raw file storage (not just parsing and discarding)

- The assignment only requires the *parsed* rows in a database — but keeping
  the original uploaded CSV as a private object gives us a re-processable
  audit trail: if the reconciliation logic changes later, you can re-run it
  against the original file without asking the user to re-upload.
- Bucket is **private** (not public) because the CSVs contain customer
  emails and amounts — anyone with the object URL could read them if it
  were public. The backend fetches using its own B2 credentials or a
  short-lived signed URL, generated fresh each time, never stored.
