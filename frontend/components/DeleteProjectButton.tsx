"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ApiError, deleteProject } from "@/lib/api";
import ConfirmDialog from "./ConfirmDialog";

interface DeleteProjectButtonProps {
  projectId: string;
  filename: string;
  onDeleted: () => void;
  onUnauthorized: () => void;
  className?: string;
}

export default function DeleteProjectButton({
  projectId,
  filename,
  onDeleted,
  onUnauthorized,
  className,
}: DeleteProjectButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setConfirmOpen(true);
  }

  async function handleConfirmDelete() {
    setConfirmOpen(false);
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(projectId);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        // Já foi excluído (outra aba/sessão, ou duplo clique) — trata como sucesso.
        onDeleted();
        return;
      }
      setError(err instanceof Error ? err.message : "Falha ao excluir o projeto.");
      setDeleting(false);
    }
  }

  return (
    <span className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={deleting}
        title="Excluir projeto"
        aria-label={`Excluir projeto ${filename}`}
        className="relative rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
      >
        {deleting ? "..." : <Trash2 size={16} />}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}

      <ConfirmDialog
        open={confirmOpen}
        title="Excluir projeto"
        message={`Excluir o projeto "${filename}"? O áudio e a transcrição serão apagados permanentemente.`}
        confirmLabel="Excluir"
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </span>
  );
}
