@AGENTS.md

## Token management — read this before doing anything

This repo already has its decisions written down. Don't re-derive them —
read the doc, don't re-think the problem:

- **Why any tech choice was made** → `docs/ARCHITECTURE.md` (stack, file
  storage, folder structure, naming rules).
- **What counts as a discrepancy and how to classify it** →
  `docs/RECONCILIATION-RULES.md`.
- **What each page/component/route does** → `docs/FEATURES.md`.
- **What's left to build** → `docs/BUILD-PLAN.md`.

Rules to avoid burning context:

- Never read `node_modules/`, `package-lock.json`, or `.next/`. If you need
  to confirm a library's behavior, check its version in `package.json` and
  reason from that, or read one specific file inside `node_modules/<pkg>`
  — not the whole tree.
- Read only the file you're about to edit, not the whole `app/` or `lib/`
  tree "to get context." The docs above already describe the shape.
- Don't re-read a doc you already read earlier in the same session unless
  it may have changed.
- Keep code comments minimal — one line max pointing to the relevant doc.
  Reasoning belongs in `docs/`, not in code.
- Every markdown file in `docs/` stays under 200 lines. If a doc is
  approaching that, split it rather than letting it grow.
