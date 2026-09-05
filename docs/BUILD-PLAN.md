# Build Plan

Total budget assumed: ~6 hours of actual build time. Track against this — if a step overruns by more
than 15 minutes, cut scope rather than push the deadline.

- [ ] **Rename repo before first push.** Generic name, no "result flow" in any form. Update remote origin.
- [ ] **Scaffold** — `npx create-next-app@latest` (TypeScript, App Router, Tailwind ok). Prisma init. Neon DB created, `DATABASE_URL` in `.env`. — 45 min
- [ ] **Schema** — `User`, `Order`, `Payment`, `Discrepancy` models in `prisma/schema.prisma`, scoped by `userId`. Run migration. — included above
- [ ] **Auth** — signup/login API routes, bcrypt hash, JWT in httpOnly cookie, middleware to protect `/dashboard` and all `/api/*` except auth routes. — 45 min
- [ ] **Upload + ingest** — file input on a page, POST to `/api/upload`, parse CSV server-side (`csv-parse` or similar), normalize keys per `RECONCILIATION-RULES.md`, insert rows tied to `userId`. — 45 min
- [ ] **Reconciliation engine** — `lib/reconcile.ts` implementing the classification table in `RECONCILIATION-RULES.md` exactly, in order, with the stated tolerances. Pure function: `(orders, payments) => Discrepancy[]`, no I/O inside it — easy to point at in the review. — 90 min
- [ ] **Dashboard** — headline tiles (total orders, total payments, total reconciled, total at risk), one chart (discrepancy counts by type), drill-down table with filter/search that opens the exact rows behind a number. — 90 min
- [ ] **LLM explain** — `/api/explain` route, sends one already-classified discrepancy to Groq, JSON mode, temperature 0.2, try/catch around the parse, loading + error state in the UI. — 30 min
- [ ] **Deploy** — Vercel env vars set, confirm it works from a clean browser (private window, no cached login). — 30 min
- [ ] **README** — written last, from what was actually built: setup steps, architecture, reconciliation logic + tolerances + why, data findings, LLM approach + temperature reasoning, what's next, AI-tool usage note. — 30 min
- [ ] **`.env.example`** — variable names only, no real secrets.
- [ ] **Final check** — sign up fresh, upload both CSVs, confirm the 25 known discrepancies appear with the right classes and the $0.04 rounding noise does NOT appear as a dispute.

## Commit discipline

Commit after each checked box above, not as one dump at the end. The next round walks through
specific commits and asks you to defend specific decisions — a clean history is part of the grade
("Code clarity and Git hygiene... meaningful commits rather than one large dump").
