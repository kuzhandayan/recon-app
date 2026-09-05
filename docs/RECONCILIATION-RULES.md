# Reconciliation Rules — implementation spec

Source data verified directly: 185 order rows, 187 payment rows, 184 distinct orders.
Full discrepancy-by-discrepancy detail is in `~/result-flow-ai-assignment/data-findings.md` (reference only, not part of this repo).

## Pre-processing (before any comparison)

1. **Normalize keys**: `order_id` / `order_reference` → trim whitespace, uppercase. (Two seeded rows are `" ord-1801 "` and `"ord-1802"` — raw-string matching fabricates false missing-payments and false orphans.)
2. **Deduplicate order rows**: drop exact-duplicate rows before matching (one seeded duplicate: `ORD-1004`).
3. **Parse payment dates as `DD/MM/YYYY HH:MM`**, not `MM/DD`. 116 of 187 rows have a day value above 12, which proves the format. Order dates are already ISO.
4. Do NOT touch fee values — every charge is exactly `2.9% × amount + $0.30`, verified with zero exceptions across all 187 rows. There is no fee bug to build a rule for.

## Classification order (first match wins, evaluate top to bottom)

| # | Class | Condition | Severity |
|---|---|---|---|
| 1 | `DUPLICATE_PAYMENT` | ≥2 payments with same normalized order key, same amount, both `type = charge` | Critical |
| 2 | `PAID_BUT_CANCELLED` | order status = `cancelled`, a settled charge exists against it | Critical |
| 3 | `MISSING_PAYMENT` | order status = `completed`, no payment row matches the key at all | High |
| 4 | `FAILED_PAYMENT` | matching payment exists but `status = failed` | High |
| 5 | `ORPHAN_PAYMENT` | payment key matches no order at all | High |
| 6 | `CURRENCY_MISMATCH` | order.currency ≠ payment.currency | Medium — never compare amounts across currencies, regardless of numeric equality |
| 7 | `PARTIAL_REFUND` | order status = `refunded`, refund amount < original charge amount | Medium |
| 8 | `UNRECORDED_REFUND` | a refund fully offsets a charge, but order status is still `completed` | Medium |
| 9 | `OVERCHARGED` | payment.amount − order.net_amount > tolerance | Medium |
| 10 | `UNDERCHARGED` | order.net_amount − payment.amount > tolerance | Medium |
| 11 | `PENDING_PAYMENT` | matching payment `status = pending` | Low — in transit, not lost, keep separate from failed |
| 12 | `DELAYED_SETTLEMENT` | payment processed_at − order_date > 72 hours (money did arrive) | Low |
| 13 | `MISSING_FIELDS` | null in a non-amount field (email, discount, processed_at) | Low — data quality note, not a money discrepancy |
| 14 | `WITHIN_TOLERANCE` | amount difference ≤ tolerance | Not a discrepancy — show separately, never in money-at-risk totals |
| 15 | `MATCHED` | everything lines up | Clean |

## Tolerances (state and defend these in the README)

- **Amount tolerance: $0.05 absolute.** Largest observed rounding noise is $0.02; smallest real discrepancy is $18.50. $0.05 sits cleanly between them — no percentage tolerance, because that would scale with order size and hide errors on large orders.
- **Settlement lag threshold: 72 hours.** Baseline max for clean orders is ~2 hours (median 41 minutes); the one bad case is 696 hours. 72h catches it with wide margin, zero false positives on the clean set.
- **Duplicate rule: key + amount + type, never time gap.** The two seeded duplicates happen to be 29 minutes apart — do not hardcode that number, it won't generalize.
- **Currency: never numeric-compare across currencies.** A EUR 210 charge against a USD 210 order is not a match; it's its own class regardless of the numeric equality.

## Determinism requirements

- No `Math.random()`, `Date.now()`, or any wall-clock read inside the matching logic.
- Sort the final discrepancy list by a fixed key (e.g. order key ascending) before returning it, so row order is identical across runs too.
- The LLM is never called inside `reconcile.ts`. It only runs afterward, in `lib/llm.ts`, against already-classified rows, purely to generate the explanation text.
