import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { fetchRawFile } from "@/lib/storage";
import { parseOrdersCsv, parsePaymentsCsv, detectCsvKind } from "@/lib/csv";

export interface ParseSummary {
  importId: string;
  status: "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED";
  inserted: number;
  duplicatesDropped: number;
  rowErrors: { row: number; reason: string }[];
  error?: string;
}

// Shared by the upload route (auto-trigger) and this route's POST handler (manual re-run)
export async function runParse(importId: string, userId: string): Promise<ParseSummary> {
  const record = await db.import.findUnique({ where: { id: importId } });
  if (!record || record.userId !== userId) {
    throw new Error("Import not found");
  }

  await db.import.update({ where: { id: importId }, data: { status: "PROCESSING" } });

  let csvText: string;
  try {
    csvText = await fetchRawFile(record.key);
  } catch {
    await db.import.update({ where: { id: importId }, data: { status: "FAILED" } });
    return { importId, status: "FAILED", inserted: 0, duplicatesDropped: 0, rowErrors: [], error: "Could not read the uploaded file from storage." };
  }

  const actualKind = detectCsvKind(csvText);
  if (actualKind && actualKind !== record.kind) {
    await db.import.update({ where: { id: importId }, data: { status: "FAILED" } });
    const message = `This looks like a ${actualKind.toLowerCase()} file, not ${record.kind.toLowerCase()}.csv. Select it in the correct box.`;
    return { importId, status: "FAILED", inserted: 0, duplicatesDropped: 0, rowErrors: [], error: message };
  }

  try {
    if (record.kind === "ORDERS") {
      const { rows, duplicatesDropped, rowErrors } = parseOrdersCsv(csvText);
      const { count } = await db.order.createMany({
        data: rows.map((r) => ({ ...r, userId })),
        skipDuplicates: true,
      });
      const status = rowErrors.length > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";
      await db.import.update({ where: { id: importId }, data: { status } });
      return { importId, status, inserted: count, duplicatesDropped, rowErrors };
    }

    const { rows, rowErrors } = parsePaymentsCsv(csvText);
    const { count } = await db.payment.createMany({
      data: rows.map((r) => ({ ...r, userId })),
      skipDuplicates: true,
    });
    const status = rowErrors.length > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";
    await db.import.update({ where: { id: importId }, data: { status } });
    return { importId, status, inserted: count, duplicatesDropped: rows.length - count, rowErrors };
  } catch (err) {
    await db.import.update({ where: { id: importId }, data: { status: "FAILED" } });
    const message = err instanceof Error ? err.message : "Unknown parsing error";
    return { importId, status: "FAILED", inserted: 0, duplicatesDropped: 0, rowErrors: [], error: message };
  }
}

export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  const body = await req.json().catch(() => null);
  const importId = typeof body?.importId === "string" ? body.importId : "";

  if (!importId) {
    return NextResponse.json({ error: "importId is required." }, { status: 400 });
  }

  try {
    const summary = await runParse(importId, userId);
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Import not found." }, { status: 404 });
  }
}
