"use client";

import { useEffect, useState } from "react";
import { ExplainPanel } from "@/components/ExplainPanel";
import { SparkleIcon } from "@/components/SparkleIcon";

interface DiscrepancyRow {
  id: string;
  orderKey: string;
  class: string;
  severity: string;
  amountDifference: string | null;
  explanation: string | null;
}

const NOT_EXPLAINABLE = new Set(["MATCHED", "WITHIN_TOLERANCE"]);

const CLASS_OPTIONS = [
  "DUPLICATE_PAYMENT",
  "PAID_BUT_CANCELLED",
  "MISSING_PAYMENT",
  "FAILED_PAYMENT",
  "ORPHAN_PAYMENT",
  "CURRENCY_MISMATCH",
  "PARTIAL_REFUND",
  "UNRECORDED_REFUND",
  "OVERCHARGED",
  "UNDERCHARGED",
  "PENDING_PAYMENT",
  "DELAYED_SETTLEMENT",
  "MISSING_FIELDS",
];

const SEVERITY_OPTIONS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"];

interface DiscrepancyTableProps {
  refreshKey?: number;
}

export function DiscrepancyTable({ refreshKey = 0 }: DiscrepancyTableProps) {
  const [classFilter, setClassFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DiscrepancyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DiscrepancyRow | null>(null);

  useEffect(() => {
    setPage(1);
  }, [classFilter, severityFilter, search]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (classFilter) params.set("class", classFilter);
        if (severityFilter) params.set("severity", severityFilter);
        if (search) params.set("search", search);
        params.set("page", String(page));

        const res = await fetch(`/api/discrepancies?${params}`, { signal: controller.signal });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "Failed to load discrepancies.");
        setRows(data.discrepancies);
        setTotal(data.total);
        setPageSize(data.pageSize);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [classFilter, severityFilter, search, page, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search order key…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="rounded border px-2 py-1 text-sm">
          <option value="">All types</option>
          {CLASS_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="rounded border px-2 py-1 text-sm">
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Explain</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-gray-500">
                  No discrepancies match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{row.orderKey}</td>
                  <td className="px-3 py-2">{row.class.replaceAll("_", " ")}</td>
                  <td className="px-3 py-2">{row.severity}</td>
                  <td className="px-3 py-2">{row.amountDifference ? `$${row.amountDifference}` : "—"}</td>
                  <td className="px-3 py-2">
                    {NOT_EXPLAINABLE.has(row.class) ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <SparkleIcon />
                        {row.explanation ? "View" : "Explain"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <ExplainPanel
          key={selected.id}
          discrepancyId={selected.id}
          orderKey={selected.orderKey}
          discrepancyClass={selected.class}
          severity={selected.severity}
          amountDifference={selected.amountDifference}
          cachedExplanation={selected.explanation}
          onClose={() => setSelected(null)}
          onExplained={(explanation) => {
            setRows((prev) => prev.map((r) => (r.id === selected.id ? { ...r, explanation } : r)));
            setSelected((prev) => (prev ? { ...prev, explanation } : prev));
          }}
        />
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          Page {page} of {totalPages} ({total} total)
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border px-2 py-1 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border px-2 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
