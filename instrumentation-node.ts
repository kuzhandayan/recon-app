export default async function registerNode() {
  const { db } = await import("@/lib/db");
  try {
    await db.$queryRaw`SELECT 1`;
    console.log("[startup] Database connected successfully");
  } catch (err) {
    console.error("[startup] Database connection failed:", err instanceof Error ? err.message : err);
  }
}
