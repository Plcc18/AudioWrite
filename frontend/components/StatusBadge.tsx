import type { ProjectStatus } from "@/lib/types";

const LABELS: Record<ProjectStatus, string> = {
  queued: "Na fila",
  processing: "Processando",
  needs_review: "Revisão pendente",
  done: "Concluído",
  failed: "Falhou",
};

const STYLES: Record<ProjectStatus, string> = {
  queued: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-700",
  needs_review: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export default function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
