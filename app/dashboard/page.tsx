import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getDownloadUrl, b2Configured } from "@/lib/storage";
import { LogoutButton } from "./logout-button";
import { UploadForm } from "@/components/UploadForm";
import { Dashboard } from "@/components/Dashboard";

export default async function DashboardPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySession(token) : null;
  const user = session ? await db.user.findUnique({ where: { id: session.userId } }) : null;

  const IMPORT_PAGE_SIZE = 10;
  const imports = user
    ? await db.import.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: IMPORT_PAGE_SIZE + 1 })
    : [];
  const initialHasMore = imports.length > IMPORT_PAGE_SIZE;
  const initialPage = imports.slice(0, IMPORT_PAGE_SIZE);
  const initialImports = await Promise.all(
    initialPage.map(async (imp) => ({
      id: imp.id,
      kind: imp.kind,
      fileName: imp.fileName,
      status: imp.status,
      createdAt: imp.createdAt.toISOString(),
      downloadUrl: b2Configured() ? await getDownloadUrl(imp.key) : null,
    }))
  );
  const initialNextCursor = initialHasMore ? initialPage[initialPage.length - 1].id : null;

  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-8">
      <div className="flex w-full max-w-lg items-center justify-between">
        <p className="text-sm text-gray-500">Signed in as {user?.email}</p>
        <LogoutButton />
      </div>
      <UploadForm initialImports={initialImports} initialNextCursor={initialNextCursor} />
      <Dashboard />
    </main>
  );
}
