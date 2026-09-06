"use client";

import { useEffect, useRef, useState } from "react";
import { Toast } from "@/components/Toast";

interface ImportRow {
  id: string;
  kind: "ORDERS" | "PAYMENTS";
  fileName: string;
  status: string;
  isReconciled: boolean;
  createdAt: string;
  downloadUrl: string | null;
}

interface UploadFormProps {
  initialImports: ImportRow[];
  initialNextCursor: string | null;
  onUploaded?: () => void;
  refreshSignal?: number;
  sampleOrdersUrl: string | null;
  samplePaymentsUrl: string | null;
}

interface FilePickerProps {
  kind: "ORDERS" | "PAYMENTS";
  label: string;
  file: File | null;
  fieldError: string | null;
  disabled: boolean;
  onChange: (file: File | null) => void;
}

function FilePicker({ kind, label, file, fieldError, disabled, onChange }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <input
        ref={inputRef}
        id={`${kind}-file`}
        type="file"
        accept=".csv"
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        Select file
      </button>
      {file && <p className="text-sm text-gray-500">Selected: {file.name}</p>}
      {fieldError && <p className="text-sm text-red-600">{fieldError}</p>}
    </div>
  );
}

export function UploadForm({
  initialImports,
  initialNextCursor,
  onUploaded,
  refreshSignal,
  sampleOrdersUrl,
  samplePaymentsUrl,
}: UploadFormProps) {
  const [imports, setImports] = useState<ImportRow[]>(initialImports);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ordersFile, setOrdersFile] = useState<File | null>(null);
  const [paymentsFile, setPaymentsFile] = useState<File | null>(null);
  const [ordersFieldError, setOrdersFieldError] = useState<string | null>(null);
  const [paymentsFieldError, setPaymentsFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const sentinelRef = useRef<HTMLLIElement>(null);

  async function uploadOne(file: File, kind: "ORDERS" | "PAYMENTS") {
    const body = new FormData();
    body.append("file", file);
    body.append("kind", kind);
    const res = await fetch("/api/upload", { method: "POST", body });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `Upload failed for ${kind.toLowerCase()}.csv`);
    return data;
  }

  // Reset back to page 1 after a fresh upload, so newly-completed imports show up at the top
  async function refreshImports() {
    const res = await fetch("/api/upload");
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setImports(data.imports);
      setNextCursor(data.nextCursor);
    }
  }

  // Re-fetch when the parent signals a reconcile just completed, so isReconciled badges update without a page refresh
  useEffect(() => {
    if (refreshSignal) refreshImports();
  }, [refreshSignal]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/upload?cursor=${nextCursor}`);
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setImports((prev) => [...prev, ...data.imports]);
        setNextCursor(data.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  // Infinite scroll: load the next page of imports when the sentinel div scrolls into view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setOrdersFieldError(ordersFile ? null : "orders.csv is mandatory");
    setPaymentsFieldError(paymentsFile ? null : "payments.csv is mandatory");
    if (!ordersFile || !paymentsFile) return;

    setError(null);
    setLoading(true);
    try {
      await uploadOne(ordersFile, "ORDERS");
      await uploadOne(paymentsFile, "PAYMENTS");
      setOrdersFile(null);
      setPaymentsFile(null);
      await refreshImports();
      onUploaded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative w-full max-w-lg">
      <div className="hidden xl:block absolute left-full top-0 ml-6 w-64 rounded border border-dashed p-3 text-sm">
        <p className="font-medium">Need sample files?</p>
        <p className="mt-1 text-gray-500">
          These templates come with reference data already in them — clear it out and drop in your own
          rows, but keep the column headings exactly as they are (mandatory), so your CSV matches the
          expected format.
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {sampleOrdersUrl ? (
            <a href={sampleOrdersUrl} className="underline" target="_blank" rel="noreferrer">
              Orders template to use
            </a>
          ) : (
            <span className="text-gray-400">Orders template to use</span>
          )}
          {samplePaymentsUrl ? (
            <a href={samplePaymentsUrl} className="underline" target="_blank" rel="noreferrer">
              Payments template to use
            </a>
          ) : (
            <span className="text-gray-400">Payments template to use</span>
          )}
        </div>
      </div>

      <div className="w-full space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4 rounded border p-4">
          <FilePicker
            kind="ORDERS"
            label="orders.csv"
            file={ordersFile}
            fieldError={ordersFieldError}
            disabled={loading}
            onChange={(file) => {
              setOrdersFile(file);
              setOrdersFieldError(file ? null : ordersFieldError);
            }}
          />

          <FilePicker
            kind="PAYMENTS"
            label="payments.csv"
            file={paymentsFile}
            fieldError={paymentsFieldError}
            disabled={loading}
            onChange={(file) => {
              setPaymentsFile(file);
              setPaymentsFieldError(file ? null : paymentsFieldError);
            }}
          />

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded border bg-black py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading && (
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
            )}
            {loading ? "Uploading…" : "Upload"}
          </button>
        </form>

        {error && <Toast message={error} onClose={() => setError(null)} />}

        {imports.length > 0 && (
          <div className="rounded border">
            <button
              type="button"
              onClick={() => setListOpen(!listOpen)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
            >
              <span>Uploaded files</span>
              <span aria-hidden>{listOpen ? "▲" : "▼"}</span>
            </button>

            {listOpen && (
              <ul className="max-h-96 space-y-2 overflow-y-auto border-t p-3 text-sm">
                {imports.map((imp) => {
                  const tooltip = `File: ${imp.fileName || "(unknown)"}\nUploaded: ${new Date(imp.createdAt).toLocaleString()}`;
                  return (
                    <li key={imp.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
                      <span className="flex items-center gap-2">
                        {imp.kind} — {imp.status}
                        {imp.status === "COMPLETED" && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              imp.isReconciled
                                ? "border-green-500 text-green-500"
                                : "border-yellow-500 text-yellow-500"
                            }`}
                          >
                            {imp.isReconciled ? "Reconciled" : "Run reconciliation to see this"}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        {imp.downloadUrl && (
                          <a href={imp.downloadUrl} className="underline" target="_blank" rel="noreferrer">
                            Download
                          </a>
                        )}
                        <span title={tooltip} className="cursor-help text-gray-500">
                          ⓘ
                        </span>
                      </span>
                    </li>
                  );
                })}
                {nextCursor && (
                  <li ref={sentinelRef} className="py-2 text-center text-gray-500">
                    {loadingMore ? "Loading more…" : ""}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
