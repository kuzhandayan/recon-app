// One chart, discrepancy counts by type — MATCHED/WITHIN_TOLERANCE excluded, they aren't discrepancies (docs/RECONCILIATION-RULES.md)
const EXCLUDED_CLASSES = ["MATCHED", "WITHIN_TOLERANCE"];

interface DiscrepancyChartProps {
  byClass: Record<string, number>;
}

export function DiscrepancyChart({ byClass }: DiscrepancyChartProps) {
  const rows = Object.entries(byClass)
    .filter(([cls]) => !EXCLUDED_CLASSES.includes(cls))
    .sort((a, b) => b[1] - a[1]);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No discrepancies found.</p>;
  }

  const max = Math.max(...rows.map(([, count]) => count));

  return (
    <div className="space-y-2">
      {rows.map(([cls, count]) => (
        <div key={cls} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate">{cls.replaceAll("_", " ")}</span>
          <div className="h-4 flex-1 rounded bg-gray-100">
            <div
              className="h-4 rounded bg-red-500"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
}
