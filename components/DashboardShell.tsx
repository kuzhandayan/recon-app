"use client";

import { useState } from "react";
import { UploadForm } from "@/components/UploadForm";
import { Dashboard } from "@/components/Dashboard";

interface ImportRow {
  id: string;
  kind: "ORDERS" | "PAYMENTS";
  fileName: string;
  status: string;
  isReconciled: boolean;
  createdAt: string;
  downloadUrl: string | null;
}

interface DashboardShellProps {
  initialImports: ImportRow[];
  initialNextCursor: string | null;
}

export function DashboardShell({ initialImports, initialNextCursor }: DashboardShellProps) {
  const [importsRefreshKey, setImportsRefreshKey] = useState(0);
  const [uploadListRefreshKey, setUploadListRefreshKey] = useState(0);

  return (
    <>
      <UploadForm
        initialImports={initialImports}
        initialNextCursor={initialNextCursor}
        onUploaded={() => setImportsRefreshKey((k) => k + 1)}
        refreshSignal={uploadListRefreshKey}
      />
      <Dashboard
        importsRefreshKey={importsRefreshKey}
        onReconciled={() => setUploadListRefreshKey((k) => k + 1)}
      />
    </>
  );
}
