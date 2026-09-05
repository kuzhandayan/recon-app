"use client";

import { useEffect } from "react";

interface ToastProps {
  message: string;
  onClose: () => void;
}

export function Toast({ message, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      role="alert"
      className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
    >
      <span>{message}</span>
      <button onClick={onClose} aria-label="Dismiss" className="text-white/80 hover:text-white">
        ✕
      </button>
    </div>
  );
}
