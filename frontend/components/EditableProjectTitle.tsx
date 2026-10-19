"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { ApiError, renameProject } from "@/lib/api";
import type { Project } from "@/lib/types";

interface EditableProjectTitleProps {
  project: Project;
  onUpdated: (updated: Project) => void;
  onUnauthorized: () => void;
  /** "lg" (padrão, título da página do projeto) ou "sm" (linha na lista de projetos). */
  size?: "lg" | "sm";
}

const SIZE_CLASSES = {
  lg: { tag: "h1" as const, title: "text-lg font-semibold text-slate-900", input: "text-lg font-semibold", icon: 18 },
  sm: { tag: "p" as const, title: "font-medium text-slate-900", input: "text-sm font-medium", icon: 14 },
};

export default function EditableProjectTitle({ project, onUpdated, onUnauthorized, size = "lg" }: EditableProjectTitleProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.filename);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { tag: Tag, title: titleClass, input: inputClass, icon: iconSize } = SIZE_CLASSES[size];

  function startEditing() {
    setValue(project.filename);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("O título não pode ficar vazio.");
      return;
    }
    if (trimmed === project.filename) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await renameProject(project.id, trimmed);
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : "Falha ao renomear o projeto.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick(e: React.MouseEvent) {
    // O botão pode aparecer dentro de um <Link> clicável (lista de projetos) — não navega ao editar.
    e.preventDefault();
    e.stopPropagation();
    startEditing();
  }

  if (editing) {
    return (
      // Sem "relative" aqui: este card pode estar sobre um <Link> que cobre o
      // cartão inteiro (lista de projetos) — só os controles de verdade
      // (input, botões) precisam de position:relative para ficar por cima
      // dele; a div em volta não, senão vira uma área "morta" que intercepta
      // cliques sem fazer nada.
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          disabled={submitting}
          aria-label="Editar título do projeto"
          className={`relative min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-slate-900 focus-visible:outline-blue-600 ${inputClass}`}
        />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            save();
          }}
          disabled={submitting}
          title="Salvar"
          aria-label="Salvar título"
          className="relative shrink-0 rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-60"
        >
          <Check size={iconSize} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(false);
          }}
          disabled={submitting}
          title="Cancelar"
          aria-label="Cancelar edição do título"
          className="relative shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-60"
        >
          <X size={iconSize} />
        </button>
        {error && (
          <p role="alert" className="relative ml-1 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Tag className={`truncate ${titleClass}`}>{project.filename}</Tag>
      <button
        type="button"
        onClick={handleEditClick}
        title="Renomear projeto"
        aria-label="Renomear projeto"
        className="relative shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Pencil size={iconSize} />
      </button>
    </div>
  );
}
