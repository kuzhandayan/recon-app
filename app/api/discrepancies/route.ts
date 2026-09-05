import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import type { Prisma } from "@/app/generated/prisma/client";

const PAGE_SIZE = 20;

// Classes that aren't real discrepancies — never counted in dispute/at-risk totals, see docs/RECONCILIATION-RULES.md
const NON_DISCREPANCY_CLASSES = ["MATCHED", "WITHIN_TOLERANCE", "MISSING_FIELDS"];

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  const params = req.nextUrl.searchParams;
  const classFilter = params.get("class");
  const severityFilter = params.get("severity");
  const search = params.get("search")?.trim();
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const where: Prisma.DiscrepancyWhereInput = { userId };
  if (classFilter) where.class = classFilter as Prisma.DiscrepancyWhereInput["class"];
  if (severityFilter) where.severity = severityFilter as Prisma.DiscrepancyWhereInput["severity"];
  if (search) where.orderKey = { contains: search.toUpperCase() };

  const [total, discrepancies, allForHeadline, totalOrders, totalPayments] = await Promise.all([
    db.discrepancy.count({ where }),
    db.discrepancy.findMany({
      where,
      orderBy: [{ severity: "asc" }, { orderKey: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.discrepancy.findMany({ where: { userId }, select: { class: true, severity: true, amountDifference: true, orderKey: true } }),
    db.order.count({ where: { userId } }),
    db.payment.count({ where: { userId } }),
  ]);

  const byClass: Record<string, number> = {};
  let totalValueInDispute = 0;
  let moneyAtRisk = 0;
  const reconciledOrderKeys: string[] = [];

  for (const row of allForHeadline) {
    byClass[row.class] = (byClass[row.class] ?? 0) + 1;

    if (NON_DISCREPANCY_CLASSES.includes(row.class)) {
      if (row.class === "MATCHED" || row.class === "WITHIN_TOLERANCE") reconciledOrderKeys.push(row.orderKey);
      continue;
    }

    const amount = row.amountDifference ? Number(row.amountDifference) : 0;
    totalValueInDispute += amount;
    // Money at risk = the urgent subset (Critical/High severity), see docs/RECONCILIATION-RULES.md severities
    if (row.severity === "CRITICAL" || row.severity === "HIGH") moneyAtRisk += amount;
  }

  const reconciledSum = reconciledOrderKeys.length
    ? await db.order.aggregate({ where: { userId, orderKey: { in: reconciledOrderKeys } }, _sum: { netAmount: true } })
    : null;

  return NextResponse.json({
    headline: {
      totalOrders,
      totalPayments,
      totalValueReconciled: Number(reconciledSum?._sum.netAmount ?? 0),
      totalValueInDispute: Math.round(totalValueInDispute * 100) / 100,
      moneyAtRisk: Math.round(moneyAtRisk * 100) / 100,
      reconciledOrders: reconciledOrderKeys.length,
    },
    byClass,
    discrepancies,
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}
