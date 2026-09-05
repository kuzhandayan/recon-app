"use client";

// Catches transient DB errors (e.g. Neon free-tier cold-start after auto-suspend), see LEARNING.md
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm text-gray-500">
        Couldn&apos;t load the dashboard — the database may still be waking up. Please try again.
      </p>
      <button onClick={reset} className="rounded border px-3 py-1.5 text-sm font-medium">
        Retry
      </button>
    </main>
  );
}
