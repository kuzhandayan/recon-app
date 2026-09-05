import { NextResponse } from "next/server";

// Liveness only, no DB query — polling the DB would block Neon's free-tier auto-suspend
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
