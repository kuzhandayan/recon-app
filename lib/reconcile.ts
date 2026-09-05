// Deterministic, pure function (no DB/fetch/Date.now/Math.random) — spec in docs/RECONCILIATION-RULES.md

export interface ReconcileOrder {
  orderKey: string;
  orderDate: Date;
  customerEmail: string | null;
  currency: string;
  netAmount: number;
  discount: number | null;
  status: string; // lowercase
}

export interface ReconcilePayment {
  transactionRef: string;
  processedAt: Date | null;
  orderKey: string;
  currency: string;
  amount: number;
  type: string; // lowercase: "charge" | "refund"
  status: string; // lowercase: "settled" | "pending" | "failed"
}

export type DiscrepancyClass =
  | "DUPLICATE_PAYMENT"
  | "PAID_BUT_CANCELLED"
  | "MISSING_PAYMENT"
  | "FAILED_PAYMENT"
  | "ORPHAN_PAYMENT"
  | "CURRENCY_MISMATCH"
  | "PARTIAL_REFUND"
  | "UNRECORDED_REFUND"
  | "OVERCHARGED"
  | "UNDERCHARGED"
  | "PENDING_PAYMENT"
  | "DELAYED_SETTLEMENT"
  | "MISSING_FIELDS"
  | "WITHIN_TOLERANCE"
  | "MATCHED";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface Discrepancy {
  orderKey: string;
  class: DiscrepancyClass;
  severity: Severity;
  amountDifference: number | null;
  details: Record<string, unknown>;
}

const AMOUNT_TOLERANCE = 0.05; // dollars — see docs/RECONCILIATION-RULES.md
const SETTLEMENT_LAG_HOURS = 72;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

export function reconcile(orders: ReconcileOrder[], payments: ReconcilePayment[]): Discrepancy[] {
  const ordersByKey = new Map<string, ReconcileOrder>();
  for (const o of orders) ordersByKey.set(o.orderKey, o);

  const paymentsByKey = new Map<string, ReconcilePayment[]>();
  for (const p of payments) {
    const list = paymentsByKey.get(p.orderKey) ?? [];
    list.push(p);
    paymentsByKey.set(p.orderKey, list);
  }
  // Sort each group so classification never depends on the order rows were fetched in
  for (const list of paymentsByKey.values()) {
    list.sort((a, b) => a.transactionRef.localeCompare(b.transactionRef));
  }

  const results: Discrepancy[] = [];
  const allKeys = new Set<string>([...ordersByKey.keys(), ...paymentsByKey.keys()]);

  for (const key of allKeys) {
    const order = ordersByKey.get(key);
    const orderPayments = paymentsByKey.get(key) ?? [];

    if (!order) {
      // Payment references an order key that doesn't exist at all
      for (const p of orderPayments) {
        results.push({
          orderKey: key,
          class: "ORPHAN_PAYMENT",
          severity: "HIGH",
          amountDifference: round2(p.amount),
          details: { transactionRef: p.transactionRef, amount: p.amount, currency: p.currency },
        });
      }
      continue;
    }

    results.push(classifyOrder(order, orderPayments));
  }

  results.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  return results;
}

function classifyOrder(order: ReconcileOrder, payments: ReconcilePayment[]): Discrepancy {
  const charges = payments.filter((p) => p.type === "charge");
  const refunds = payments.filter((p) => p.type === "refund");

  // 1. DUPLICATE_PAYMENT — two or more charges at the same amount
  const chargeAmountGroups = new Map<number, ReconcilePayment[]>();
  for (const c of charges) {
    const list = chargeAmountGroups.get(c.amount) ?? [];
    list.push(c);
    chargeAmountGroups.set(c.amount, list);
  }
  for (const [amount, group] of chargeAmountGroups) {
    if (group.length >= 2) {
      return {
        orderKey: order.orderKey,
        class: "DUPLICATE_PAYMENT",
        severity: "CRITICAL",
        amountDifference: round2(amount * (group.length - 1)),
        details: { transactionRefs: group.map((p) => p.transactionRef), amount },
      };
    }
  }

  // 3. MISSING_PAYMENT — completed order, no payment row matches the key at all
  if (payments.length === 0 && order.status === "completed") {
    return {
      orderKey: order.orderKey,
      class: "MISSING_PAYMENT",
      severity: "HIGH",
      amountDifference: round2(order.netAmount),
      details: {},
    };
  }

  const settledCharge = charges.find((c) => c.status === "settled");

  // 2. PAID_BUT_CANCELLED
  if (order.status === "cancelled" && settledCharge) {
    return {
      orderKey: order.orderKey,
      class: "PAID_BUT_CANCELLED",
      severity: "CRITICAL",
      amountDifference: round2(settledCharge.amount),
      details: { transactionRef: settledCharge.transactionRef },
    };
  }

  // 4. FAILED_PAYMENT
  const failedCharge = charges.find((c) => c.status === "failed");
  if (failedCharge) {
    return {
      orderKey: order.orderKey,
      class: "FAILED_PAYMENT",
      severity: "HIGH",
      amountDifference: round2(failedCharge.amount),
      details: { transactionRef: failedCharge.transactionRef },
    };
  }

  // 6. CURRENCY_MISMATCH — never numeric-compare across currencies, regardless of amount equality
  if (settledCharge && settledCharge.currency !== order.currency) {
    return {
      orderKey: order.orderKey,
      class: "CURRENCY_MISMATCH",
      severity: "MEDIUM",
      amountDifference: null,
      details: { orderCurrency: order.currency, paymentCurrency: settledCharge.currency, amount: settledCharge.amount },
    };
  }

  // 7 & 8: refund handling
  if (settledCharge && refunds.length > 0) {
    const refundTotal = round2(refunds.reduce((sum, r) => sum + r.amount, 0));
    const outstanding = round2(settledCharge.amount - refundTotal);

    if (order.status === "refunded" && outstanding > AMOUNT_TOLERANCE) {
      return {
        orderKey: order.orderKey,
        class: "PARTIAL_REFUND",
        severity: "MEDIUM",
        amountDifference: outstanding,
        details: { chargeAmount: settledCharge.amount, refundTotal },
      };
    }

    if (order.status === "completed" && Math.abs(outstanding) <= AMOUNT_TOLERANCE) {
      return {
        orderKey: order.orderKey,
        class: "UNRECORDED_REFUND",
        severity: "MEDIUM",
        amountDifference: refundTotal,
        details: { chargeAmount: settledCharge.amount, refundTotal },
      };
    }
  }

  // 9 & 10: amount mismatch against a settled charge
  if (settledCharge) {
    const diff = round2(settledCharge.amount - order.netAmount);
    if (diff > AMOUNT_TOLERANCE) {
      return {
        orderKey: order.orderKey,
        class: "OVERCHARGED",
        severity: "HIGH",
        amountDifference: diff,
        details: { chargeAmount: settledCharge.amount, netAmount: order.netAmount },
      };
    }
    if (-diff > AMOUNT_TOLERANCE) {
      return {
        orderKey: order.orderKey,
        class: "UNDERCHARGED",
        severity: "MEDIUM",
        amountDifference: round2(-diff),
        details: { chargeAmount: settledCharge.amount, netAmount: order.netAmount },
      };
    }
  }

  // 11. PENDING_PAYMENT
  const pendingCharge = charges.find((c) => c.status === "pending");
  if (pendingCharge) {
    return {
      orderKey: order.orderKey,
      class: "PENDING_PAYMENT",
      severity: "LOW",
      amountDifference: null,
      details: { transactionRef: pendingCharge.transactionRef, amount: pendingCharge.amount },
    };
  }

  // 12. DELAYED_SETTLEMENT — money did arrive, just late
  if (settledCharge?.processedAt) {
    const hours = hoursBetween(order.orderDate, settledCharge.processedAt);
    if (hours > SETTLEMENT_LAG_HOURS) {
      return {
        orderKey: order.orderKey,
        class: "DELAYED_SETTLEMENT",
        severity: "LOW",
        amountDifference: null,
        details: { hours: Math.round(hours) },
      };
    }
  }

  // 13. MISSING_FIELDS — data quality only, not a money discrepancy
  const hasMissingField =
    !order.customerEmail || order.discount === null || payments.some((p) => p.processedAt === null);
  if (hasMissingField) {
    return { orderKey: order.orderKey, class: "MISSING_FIELDS", severity: "LOW", amountDifference: null, details: {} };
  }

  // 14. WITHIN_TOLERANCE — a real but negligible amount difference; never counted as a discrepancy
  if (settledCharge) {
    const diff = Math.abs(round2(settledCharge.amount - order.netAmount));
    if (diff > 0 && diff <= AMOUNT_TOLERANCE) {
      return { orderKey: order.orderKey, class: "WITHIN_TOLERANCE", severity: "NONE", amountDifference: diff, details: {} };
    }
  }

  // 15. MATCHED
  return { orderKey: order.orderKey, class: "MATCHED", severity: "NONE", amountDifference: null, details: {} };
}
