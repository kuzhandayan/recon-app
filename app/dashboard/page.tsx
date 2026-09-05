import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

// Placeholder until the full dashboard (tiles, chart, drill-down table) is built, see docs/BUILD-PLAN.md
export default async function DashboardPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySession(token) : null;
  const user = session ? await db.user.findUnique({ where: { id: session.userId } }) : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
      <p className="text-sm text-gray-500">Signed in as {user?.email}</p>
      <LogoutButton />
    </main>
  );
}
