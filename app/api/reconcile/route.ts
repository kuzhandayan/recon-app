import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { reconcile, ReconcileOrder, ReconcilePayment } from "@/lib/reconcile";
import type { Prisma } from "@/app/generated/prisma/client";

// Re-runs the deterministic engine over this user's current orders + payments, see docs/RECONCILIATION-RULES.md
export async function POST(req: NextRequest) {
  const userId = requireUserId(req);

  const [orderRows, paymentRows] = await Promise.all([
    db.order.findMany({ where: { userId } }),
    db.payment.findMany({ where: { userId } }),
  ]);

  const orders: ReconcileOrder[] = orderRows.map((o) => ({
    orderKey: o.orderKey,
    orderDate: o.orderDate,
    customerEmail: o.customerEmail,
    currency: o.currency,
    netAmount: Number(o.netAmount),
    discount: o.discount === null ? null : Number(o.discount),
    status: o.status,
  }));

  const payments: ReconcilePayment[] = paymentRows.map((p) => ({
    transactionRef: p.transactionRef,
    processedAt: p.processedAt,
    orderKey: p.orderKey,
    currency: p.currency,
    amount: Number(p.amount),
    type: p.type,
    status: p.status,
  }));

  const results = reconcile(orders, payments);

  // Full re-run each time: previous results are stale the moment new data lands, so replace rather than merge
  await db.$transaction([
    db.discrepancy.deleteMany({ where: { userId } }),
    db.discrepancy.createMany({
      data: results.map((r) => ({
        userId,
        orderKey: r.orderKey,
        class: r.class,
        severity: r.severity,
        amountDifference: r.amountDifference,
        details: r.details as Prisma.InputJsonValue,
      })),
    }),
    // Every import currently in the DB was included in this run — mark them reconciled.
    // A later upload creates a fresh Import row with isReconciled defaulting back to false.
    db.import.updateMany({ where: { userId }, data: { isReconciled: true } }),
  ]);

  return NextResponse.json({ totalOrders: orders.length, totalPayments: payments.length, totalDiscrepancies: results.length });
}
