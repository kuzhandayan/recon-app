import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { explainDiscrepancy } from "@/lib/llm";

// One LLM call per discrepancy, result cached on the row afterward — see docs/RECONCILIATION-RULES.md
export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  const body = await req.json().catch(() => null);
  const discrepancyId = typeof body?.discrepancyId === "string" ? body.discrepancyId : "";

  if (!discrepancyId) {
    return NextResponse.json({ error: "discrepancyId is required." }, { status: 400 });
  }

  const discrepancy = await db.discrepancy.findUnique({ where: { id: discrepancyId } });
  if (!discrepancy || discrepancy.userId !== userId) {
    return NextResponse.json({ error: "Discrepancy not found." }, { status: 404 });
  }

  if (discrepancy.explanation) {
    return NextResponse.json({ explanation: discrepancy.explanation, cached: true });
  }

  try {
    const result = await explainDiscrepancy({
      orderKey: discrepancy.orderKey,
      class: discrepancy.class,
      severity: discrepancy.severity,
      amountDifference: discrepancy.amountDifference ? Number(discrepancy.amountDifference) : null,
      details: (discrepancy.details as Record<string, unknown>) ?? {},
    });

    const explanationText = `${result.whatHappened} ${result.recommendedAction}`;
    await db.discrepancy.update({ where: { id: discrepancy.id }, data: { explanation: explanationText } });

    return NextResponse.json({
      explanation: explanationText,
      whatHappened: result.whatHappened,
      recommendedAction: result.recommendedAction,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The explanation service is unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
