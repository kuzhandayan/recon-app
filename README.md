# Orders & Payments Reconciler

Ingests an orders export and a payments export, reconciles them deterministically,
and presents the discrepancies as a dashboard.

## Running locally

```bash
npm install
npm run dev
```

Requires a `.env` file — see `.env.example` for the variables needed.

Docker (optional):

```bash
docker compose up --build
```

## Documentation

- `docs/ARCHITECTURE.md` — stack, storage flow, folder structure
- `docs/RECONCILIATION-RULES.md` — discrepancy classification and tolerances
- `docs/FEATURES.md` — pages, components, API routes
- `docs/BUILD-PLAN.md` — build checklist

> Full write-up (reconciliation logic, data findings, LLM approach) is written
> once the application is complete.
