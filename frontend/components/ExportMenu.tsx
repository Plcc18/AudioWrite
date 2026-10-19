"use client";

import { useState } from "react";
import { ApiError, downloadExport } from "@/lib/api";
import type { ExportFormat } from "@/lib/types";
import ConfirmDialog from "./ConfirmDialog";

interface ExportMenuProps {
  projectId: string;
  filename: string;
  pendingCount: number;
  onUnauthorized: () => void;
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "txt", label: "TXT" },
  { value: "srt", label: "SRT" },
  { value: "docx", label: "DOCX" },
];

export default function ExportMenu({ projectId, filename, pendingCount, onUnauthorized }: ExportMenuProps) {
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [pendingExportFormat, setPendingExportFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const baseName = filename.replace(/\.[^/.]+$/, "");
  const hasPending = pendingCount > 0;

  async function runExport(format: ExportFormat) {
    setExportingFormat(format);
    setError(null);
    try {
      await downloadExport(projectId, format, baseName);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : "Falha ao exportar.");
    } finally {
      setExportingFormat(null);
    }
  }

  function handleExport(format: ExportFormat) {
    if (hasPending) {
      setPendingExportFormat(format);
      return;
    }
    runExport(format);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Exportar:</span>
        {FORMATS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleExport(value)}
            disabled={exportingFormat !== null}
            title={hasPending ? "Há trechos pendentes — será pedida confirmação" : undefined}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {exportingFormat === value ? "Gerando..." : label}
          </button>
        ))}
      </div>
      {hasPending && (
        <p className="mt-1 text-xs text-amber-700">
          {pendingCount} trecho(s) ainda pendente(s) — exportar agora vai pedir confirmação.
        </p>
      )}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}

      <ConfirmDialog
        open={pendingExportFormat !== null}
        title="Exportar com trechos pendentes"
        message={`Este projeto ainda tem ${pendingCount} trecho(s) pendente(s) de revisão. Exportar mesmo assim?`}
        confirmLabel="Exportar"
        onConfirm={() => {
          const format = pendingExportFormat;
          setPendingExportFormat(null);
          if (format) runExport(format);
        }}
        onCancel={() => setPendingExportFormat(null)}
      />
    </div>
  );
}
