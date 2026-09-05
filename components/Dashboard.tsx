"use client";

import { useEffect, useState } from "react";
import { StatTile } from "@/components/StatTile";
import { DiscrepancyChart } from "@/components/DiscrepancyChart";
import { DiscrepancyTable } from "@/components/DiscrepancyTable";

interface Headline {
  totalOrders: number;
  totalPayments: number;
  totalValueReconciled: number;
  totalValueInDispute: number;
  moneyAtRisk: number;
  reconciledOrders: number;
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface DashboardProps {
  importsRefreshKey?: number;
  onReconciled?: () => void;
}

export function Dashboard({ importsRefreshKey = 0, onReconciled }: DashboardProps) {
  const [headline, setHeadline] = useState<Headline | null>(null);
  const [byClass, setByClass] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasUnreconciled, setHasUnreconciled] = useState(false);

  async function loadHeadline() {
    const res = await fetch("/api/discrepancies?page=1");
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setHeadline(data.headline);
      setByClass(data.byClass);
    }
  }

  // Any completed import not yet covered by a reconcile run — see docs/RECONCILIATION-RULES.md
  async function checkUnreconciled() {
    const res = await fetch("/api/upload");
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setHasUnreconciled(data.imports.some((imp: { status: string; isReconciled: boolean }) => imp.status === "COMPLETED" && !imp.isReconciled));
    }
  }

  useEffect(() => {
    loadHeadline();
  }, []);

  useEffect(() => {
    checkUnreconciled();
  }, [importsRefreshKey]);

  async function runReconciliation() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/reconcile", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Reconciliation failed.");
      await loadHeadline();
      await checkUnreconciled();
      setRefreshKey((k) => k + 1);
      onReconciled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconciliation failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="w-full max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Reconciliation</h2>
          {hasUnreconciled && (
            <span className="rounded-full border border-yellow-500 px-2 py-0.5 text-xs font-medium text-yellow-500">
              New data — click &quot;Run reconciliation&quot; to see it
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={runReconciliation}
          disabled={running}
          className="flex items-center gap-2 rounded border bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running && (
            <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          {running ? "Running…" : "Run reconciliation"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {headline && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatTile label="Total orders" value={String(headline.totalOrders)} />
          <StatTile label="Total payments" value={String(headline.totalPayments)} />
          <StatTile label="Value reconciled" value={formatCurrency(headline.totalValueReconciled)} />
          <StatTile label="Value in dispute" value={formatCurrency(headline.totalValueInDispute)} tone="critical" />
          <StatTile label="Money at risk" value={formatCurrency(headline.moneyAtRisk)} tone="critical" />
          <StatTile label="Reconciled orders" value={String(headline.reconciledOrders)} />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium">Discrepancies by type</h3>
        <DiscrepancyChart byClass={byClass} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Drill-down</h3>
        <DiscrepancyTable refreshKey={refreshKey} />
      </div>
    </div>
  );
}
