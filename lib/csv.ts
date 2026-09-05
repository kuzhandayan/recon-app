import { parse } from "csv-parse/sync";

// Column names + normalization rules, see docs/RECONCILIATION-RULES.md
const ORDER_COLUMNS = ["order_id", "order_date", "customer_email", "currency", "gross_amount", "discount", "net_amount", "status"] as const;
const PAYMENT_COLUMNS = ["transaction_ref", "processed_at", "order_reference", "currency", "amount", "fee", "net_settled", "type", "status"] as const;

// customer_email/discount (orders) and processed_at (payments) are allowed to be blank — MISSING_FIELDS class, see docs/RECONCILIATION-RULES.md
const ORDER_REQUIRED = ["order_id", "order_date", "currency", "gross_amount", "net_amount", "status"] as const;
const PAYMENT_REQUIRED = ["transaction_ref", "order_reference", "currency", "amount", "fee", "net_settled", "type", "status"] as const;

// Detects the real file type from its header row, independent of which upload slot the user picked
export function detectCsvKind(csvText: string): "ORDERS" | "PAYMENTS" | null {
  const firstLine = csvText.split(/\r?\n/)[0] ?? "";
  const [header]: string[][] = parse(firstLine, { columns: false, skip_empty_lines: true, trim: true });
  if (!header) return null;

  const isOrders = ORDER_REQUIRED.every((c) => header.includes(c));
  const isPayments = PAYMENT_REQUIRED.every((c) => header.includes(c));
  if (isOrders && !isPayments) return "ORDERS";
  if (isPayments && !isOrders) return "PAYMENTS";
  return null;
}

export interface RowError {
  row: number; // 1-indexed, header excluded
  reason: string;
}

export interface ParsedOrderRow {
  orderKey: string;
  orderDate: Date;
  customerEmail: string | null;
  currency: string;
  grossAmount: string;
  discount: string | null;
  netAmount: string;
  status: string;
}

export interface ParsedPaymentRow {
  transactionRef: string;
  processedAt: Date | null;
  orderKey: string;
  currency: string;
  amount: string;
  fee: string;
  netSettled: string;
  type: string;
  status: string;
}

export interface ParseResult<T> {
  rows: T[];
  duplicatesDropped: number;
  rowErrors: RowError[];
}

function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase();
}

function assertColumns(header: string[], expected: readonly string[]) {
  const missing = expected.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`Missing required column(s): ${missing.join(", ")}`);
}

// Shared row-level validator, reused by both parsers below instead of a hand-rolled `if` chain each
function firstMissingField(record: Record<string, string>, requiredFields: readonly string[]): string | null {
  return requiredFields.find((f) => !record[f]?.trim()) ?? null;
}

// DD/MM/YYYY HH:MM, not MM/DD — see docs/RECONCILIATION-RULES.md
function parsePaymentDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseOrdersCsv(csvText: string): ParseResult<ParsedOrderRow> {
  const records: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (records.length > 0) assertColumns(Object.keys(records[0]), ORDER_COLUMNS);

  const rowErrors: RowError[] = [];
  const rows: ParsedOrderRow[] = [];
  const seen = new Map<string, string>(); // orderKey -> serialized row content, to detect exact duplicates

  records.forEach((r, i) => {
    const rowNum = i + 1;

    const missing = firstMissingField(r, ORDER_REQUIRED);
    if (missing) {
      rowErrors.push({ row: rowNum, reason: `Missing required field: ${missing}` });
      return;
    }

    const orderKey = normalizeKey(r.order_id);
    const serialized = JSON.stringify([orderKey, r.order_date, r.customer_email ?? "", r.currency, r.gross_amount, r.discount ?? "", r.net_amount, r.status]);

    const existing = seen.get(orderKey);
    if (existing !== undefined) {
      if (existing === serialized) {
        return; // exact duplicate row — drop silently, see docs/RECONCILIATION-RULES.md
      }
      rowErrors.push({ row: rowNum, reason: `Duplicate order_id "${orderKey}" with conflicting data` });
      return;
    }

    const orderDate = new Date(r.order_date.trim());
    if (Number.isNaN(orderDate.getTime())) {
      rowErrors.push({ row: rowNum, reason: "Invalid order_date" });
      return;
    }

    seen.set(orderKey, serialized);
    rows.push({
      orderKey,
      orderDate,
      customerEmail: r.customer_email?.trim() || null,
      currency: r.currency.trim(),
      grossAmount: r.gross_amount.trim(),
      discount: r.discount?.trim() || null,
      netAmount: r.net_amount.trim(),
      status: r.status.trim().toLowerCase(),
    });
  });

  const duplicatesDropped = records.length - rows.length - rowErrors.length;
  return { rows, duplicatesDropped, rowErrors };
}

export function parsePaymentsCsv(csvText: string): ParseResult<ParsedPaymentRow> {
  const records: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (records.length > 0) assertColumns(Object.keys(records[0]), PAYMENT_COLUMNS);

  const rowErrors: RowError[] = [];
  const rows: ParsedPaymentRow[] = [];

  records.forEach((r, i) => {
    const rowNum = i + 1;

    const missing = firstMissingField(r, PAYMENT_REQUIRED);
    if (missing) {
      rowErrors.push({ row: rowNum, reason: `Missing required field: ${missing}` });
      return;
    }

    // processed_at may legitimately be null — MISSING_FIELDS class, see docs/RECONCILIATION-RULES.md
    const processedAt = r.processed_at?.trim() ? parsePaymentDate(r.processed_at) : null;
    if (r.processed_at?.trim() && processedAt === null) {
      rowErrors.push({ row: rowNum, reason: "Invalid processed_at (expected DD/MM/YYYY HH:MM)" });
      return;
    }

    rows.push({
      transactionRef: r.transaction_ref.trim(),
      processedAt,
      orderKey: normalizeKey(r.order_reference),
      currency: r.currency.trim(),
      amount: r.amount.trim(),
      fee: r.fee.trim(),
      netSettled: r.net_settled.trim(),
      type: r.type.trim().toLowerCase(),
      status: r.status.trim().toLowerCase(),
    });
  });

  return { rows, duplicatesDropped: 0, rowErrors };
}
