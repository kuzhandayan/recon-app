"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ExplainPanelProps {
  discrepancyId: string;
  orderKey: string;
  discrepancyClass: string;
  severity: string;
  amountDifference: string | null;
  cachedExplanation: string | null;
  onClose: () => void;
  onExplained?: (explanation: string) => void;
}

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "border-red-500 text-red-500",
  HIGH: "border-orange-500 text-orange-500",
  MEDIUM: "border-yellow-500 text-yellow-500",
  LOW: "border-blue-500 text-blue-500",
  NONE: "border-gray-400 text-gray-400",
};

const WORD_REVEAL_MS = 45;

export function ExplainPanel({
  discrepancyId,
  orderKey,
  discrepancyClass,
  severity,
  amountDifference,
  cachedExplanation,
  onClose,
  onExplained,
}: ExplainPanelProps) {
  const [explanation, setExplanation] = useState<string | null>(cachedExplanation);
  const [loading, setLoading] = useState(!cachedExplanation);
  const [error, setError] = useState<string | null>(null);
  const [visibleWordCount, setVisibleWordCount] = useState(cachedExplanation ? Infinity : 0);
  const [mounted, setMounted] = useState(false);

  // Only a fresh generation gets the word-by-word reveal, not a cached "View"
  const wasCachedOnOpen = useRef(!!cachedExplanation);

  useEffect(() => setMounted(true), []);

  // Escape closes the drawer, same as clicking the backdrop or the ✕ button
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (cachedExplanation) return;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discrepancyId }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "Failed to get an explanation.");
        setExplanation(data.explanation);
        onExplained?.(data.explanation);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [discrepancyId, cachedExplanation]);

  // Word-by-word reveal, only for a freshly-generated answer
  useEffect(() => {
    if (!explanation || wasCachedOnOpen.current) return;
    const words = explanation.split(" ");
    setVisibleWordCount(0);
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setVisibleWordCount(i);
      if (i >= words.length) clearInterval(interval);
    }, WORD_REVEAL_MS);
    return () => clearInterval(interval);
  }, [explanation]);

  if (!mounted) return null;

  const words = explanation?.split(" ") ?? [];
  const shownText = wasCachedOnOpen.current ? explanation : words.slice(0, visibleWordCount).join(" ");

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop, click to close — portaled to <body> so it always covers the true viewport, see LEARNING.md */}
      <button
        type="button"
        aria-label="Close explanation panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      <aside className="relative flex h-full w-full max-w-sm flex-col overflow-y-auto border-l bg-white p-5 shadow-xl dark:bg-neutral-900">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">AI explanation</p>
            <h3 className="text-lg font-semibold">{orderKey}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full border px-2 py-0.5 font-medium ${SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.NONE}`}>
            {severity}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-gray-400">{discrepancyClass.replaceAll("_", " ")}</span>
          {amountDifference && <span className="text-gray-400">${amountDifference}</span>}
        </div>

        <div className="flex-1 text-sm">
          {loading && (
            <p className="flex items-center gap-2 text-gray-400">
              <span
                aria-hidden
                className="h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"
              />
              Asking the LLM…
            </p>
          )}

          {!loading && error && (
            <div className="space-y-2">
              <p className="text-red-500">{error}</p>
              <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-xs">
                Close
              </button>
            </div>
          )}

          {!loading && !error && explanation && (
            <p className="whitespace-pre-line leading-relaxed">
              {shownText}
              {!wasCachedOnOpen.current && visibleWordCount < words.length && (
                <span aria-hidden className="ml-0.5 inline-block w-1.5 animate-pulse bg-current align-middle text-transparent">
                  |
                </span>
              )}
            </p>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}
