import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { uploadRawFile, getDownloadUrl, b2Configured } from "@/lib/storage";
import { runParse } from "@/app/api/parse/route";

const VALID_KINDS = ["ORDERS", "PAYMENTS"] as const;

export async function POST(req: NextRequest) {
  const userId = requireUserId(req);

  if (!b2Configured()) {
    return NextResponse.json({ error: "File storage is not configured. Set the B2_* env vars." }, { status: 500 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");

  if (!(file instanceof Blob) || typeof kind !== "string" || !VALID_KINDS.includes(kind as (typeof VALID_KINDS)[number])) {
    return NextResponse.json({ error: "A file and a kind of ORDERS or PAYMENTS are required." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `uploads/${userId}/${kind.toLowerCase()}-${Date.now()}.csv`;

  await uploadRawFile(key, buffer, "text/csv");
  const fileName = file instanceof File ? file.name : `${kind.toLowerCase()}.csv`;
  const record = await db.import.create({ data: { userId, kind: kind as "ORDERS" | "PAYMENTS", key, fileName, status: "PENDING" } });

  const summary = await runParse(record.id, userId);
  const downloadUrl = await getDownloadUrl(key);

  return NextResponse.json({ import: { id: record.id, kind: record.kind, status: summary.status }, downloadUrl, summary });
}

const PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  const cursor = req.nextUrl.searchParams.get("cursor");

  const imports = await db.import.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = imports.length > PAGE_SIZE;
  const page = imports.slice(0, PAGE_SIZE);
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  const withUrls = await Promise.all(
    page.map(async (imp) => ({
      id: imp.id,
      kind: imp.kind,
      fileName: imp.fileName,
      status: imp.status,
      isReconciled: imp.isReconciled,
      createdAt: imp.createdAt,
      downloadUrl: b2Configured() ? await getDownloadUrl(imp.key) : null,
    }))
  );

  return NextResponse.json({ imports: withUrls, nextCursor });
}
