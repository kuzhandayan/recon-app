interface StatTileProps {
  label: string;
  value: string;
  tone?: "neutral" | "critical";
}

export function StatTile({ label, value, tone = "neutral" }: StatTileProps) {
  return (
    <div className="min-w-0 rounded border p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`break-words text-2xl font-semibold ${tone === "critical" ? "text-red-600" : ""}`}>{value}</p>
    </div>
  );
}
