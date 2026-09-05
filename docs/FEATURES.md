# Features & Pages

What each page, component, and route actually does. For *why* a technology
was chosen, or the folder tree, see ARCHITECTURE.md — not repeated here.

## Pages (app/)

- `/login` — email + password form, posts to `api/auth/login`
- `/signup` — same shape, posts to `api/auth/signup`
- `/dashboard` — the whole app: upload, headline tiles, chart, drill-down table

## Common components (components/)

- `UploadForm` — the two-file CSV picker + submit button; each row in the uploaded-files list
  shows an `isReconciled` badge (flips true after a reconcile run, resets false on a new upload)
- `StatTile` — one headline number (label, value, optional severity color)
- `DiscrepancyChart` — one chart, discrepancy counts by type
- `DiscrepancyTable` — filterable/searchable drill-down table, an "Explain" button per row
- `ExplainPanel` — the LLM explanation as a right-side slide-in drawer (portaled to `document.body`
  so it always covers the true viewport), loading/error states, word-by-word reveal on a fresh
  answer, instant on a cached one

## API routes (app/api/)

- `auth/signup`, `auth/login` — issue the JWT cookie
- `auth/logout` — clears the session cookie
- `upload` — receives a file, sends it to B2, stores the returned key
- `parse` — reads the file back from B2 by key, inserts rows into Postgres
- `reconcile` — runs `lib/reconcile.ts` over that user's orders + payments, marks all current
  imports `isReconciled: true`
- `discrepancies` — returns the classified list for the dashboard
- `explain` — one LLM call per discrepancy (Groq, Gemini fallback), result cached on the row

## File upload — inside Docker specifically

Docker changes nothing about the upload logic. The container makes an
ordinary outbound HTTPS call to B2's S3-compatible endpoint, exactly like
running `next dev` directly on the host. The only Docker-specific piece is
that the B2 credentials have to reach the container as environment
variables — already handled by `env_file: .env` in `docker-compose.yml`.
Nothing else about the flow differs between containerized and non-containerized dev.
