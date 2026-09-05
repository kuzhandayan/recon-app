# Build Plan

Total budget assumed: ~6 hours of actual build time. Track against this — if a step overruns by more
than 15 minutes, cut scope rather than push the deadline.

- [x] **Rename repo before first push.** Generic name, no company reference in any form. Update remote origin. (`recon-app`)
- [x] **Scaffold** — `npx create-next-app@latest` (TypeScript, App Router, Tailwind ok). Prisma init. Neon DB created, `DATABASE_URL` in `.env`. — 45 min
- [x] **Schema** — `User`, `Order`, `Payment`, `Discrepancy`, `Import` models in `prisma/schema.prisma`, scoped by `userId`. Run migration. — included above
- [x] **Auth** — signup/login API routes, bcrypt hash, JWT in httpOnly cookie, `proxy.ts` (Next.js 16's renamed middleware) protects `/dashboard` and all `/api/*` except auth routes. — 45 min
- [x] **Upload + ingest** — two-file picker, POST to `/api/upload`, parse CSV server-side (`lib/csv.ts`), normalize keys per `RECONCILIATION-RULES.md`, insert rows tied to `userId`, dedupe on both `Order` and `Payment` via unique constraints + `skipDuplicates`. — 45 min
- [x] **Reconciliation engine** — `lib/reconcile.ts` implementing the classification table in `RECONCILIATION-RULES.md` exactly, in order, with the stated tolerances. Pure function: `(orders, payments) => Discrepancy[]`, no I/O inside it. Verified against the real CSVs — every count and dollar figure matched the data-findings analysis exactly. — 90 min
- [x] **Dashboard** — headline tiles, one chart (discrepancy counts by type), drill-down table with filter/search/pagination that opens the exact rows behind a number, plus an `isReconciled` indicator per import so the UI shows when new data hasn't been reconciled yet. — 90 min
- [x] **LLM explain** — `/api/explain` route, sends one already-classified discrepancy to Groq (`openai/gpt-oss-20b`), JSON mode, temperature 0.2, automatic fallback to Gemini (`gemini-flash-lite-latest`) on failure, try/catch around the parse, cached per discrepancy row, slide-in drawer UI with loading/error states and a word-by-word reveal on first generation. — 30 min
- [ ] **Deploy** — Vercel env vars set, confirm it works from a clean browser (private window, no cached login).
- [x] **README** — written from what was actually built: setup steps, architecture, reconciliation logic + tolerances + why, data findings, LLM approach + temperature reasoning, what's next, AI-tool usage note.
- [x] **`.env.example`** — variable names only, no real secrets.
- [x] **Final check** — signed up fresh, uploaded both CSVs, confirmed all 15 discrepancy types appear with the right classes/severities/amounts and the $0.04 rounding noise does NOT appear as a dispute (`WITHIN_TOLERANCE`, excluded from totals). Verified line-by-line against `data-findings.md`.

## Commit discipline

Commit after each checked box above, not as one dump at the end. The next round walks through
specific commits and asks you to defend specific decisions — a clean history is part of the grade
("Code clarity and Git hygiene... meaningful commits rather than one large dump").
