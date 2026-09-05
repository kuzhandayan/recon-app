import { NextResponse } from "next/server";

// Liveness only, no DB query — polling the DB would block Neon's auto-suspend, see LEARNING.md
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
