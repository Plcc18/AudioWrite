"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getProject, listProjects } from "@/lib/api";
import { usePolling } from "@/lib/hooks/usePolling";
import type { Project } from "@/lib/types";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import EditableProjectTitle from "@/components/EditableProjectTitle";
import StatusBadge from "@/components/StatusBadge";
import TopBar from "@/components/TopBar";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Erro ao carregar projetos.");
      });
  }, [router]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Sem isso, um projeto queued/processing fica com o status preso na tela até
  // a página ser recarregada manualmente — a página de detalhe já faz esse
  // polling (mesmo padrão), a lista não fazia.
  const hasActiveProjects = projects?.some((p) => p.status === "queued" || p.status === "processing") ?? false;
  usePolling(refreshList, 5000, hasActiveProjects);

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Seus projetos</h1>
          <Link
            href="/projects/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Novo projeto
          </Link>
        </div>

        <div className="mt-6">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {!error && projects === null && <p className="text-sm text-slate-500">Carregando...</p>}

          {!error && projects !== null && projects.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <p className="text-sm text-slate-500">Você ainda não enviou nenhum áudio.</p>
              <Link href="/projects/new" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline">
                Enviar o primeiro áudio
              </Link>
            </div>
          )}

          {!error && projects !== null && projects.length > 0 && (
            <ul className="space-y-2">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="relative flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-blue-300 hover:shadow-sm sm:flex-row sm:items-center"
                >
                  {/* Card inteiro clicável: link "esticado" cobrindo o <li>, por baixo
                      dos controles interativos (que ficam por cima por serem renderizados
                      depois, em elementos com position: relative). */}
                  <Link
                    href={`/projects/${project.id}`}
                    className="absolute inset-0 rounded-lg"
                    aria-label={`Abrir projeto ${project.filename}`}
                  />

                  {/* Sem "relative" nestes dois: são blocos largos com bastante espaço
                      vazio (ex.: flex-1) que, se ficassem por cima, interceptariam o
                      clique ali sem fazer nada — melhor deixar passar pro link do card.
                      Só os controles de verdade (lápis, lixeira) precisam ficar por cima,
                      e cada um cuida da própria elevação. */}
                  <div className="min-w-0 flex-1">
                    <EditableProjectTitle
                      project={project}
                      size="sm"
                      onUpdated={(updated) =>
                        setProjects((prev) => prev?.map((p) => (p.id === project.id ? { ...p, ...updated } : p)) ?? null)
                      }
                      onUnauthorized={() => router.push("/login")}
                    />
                    <p className="text-xs text-slate-500">
                      {formatDate(project.created_at)}
                      {project.duration_ms !== null && ` · ${formatDuration(project.duration_ms)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 sm:justify-end">
                    <PendingCount projectId={project.id} status={project.status} />
                    <StatusBadge status={project.status} />
                  </div>

                  <DeleteProjectButton
                    projectId={project.id}
                    filename={project.filename}
                    onDeleted={() => setProjects((prev) => prev?.filter((p) => p.id !== project.id) ?? null)}
                    onUnauthorized={() => router.push("/login")}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * GET /projects não traz a contagem de trechos pendentes (só o schema
 * ProjectOut, sem doubtful_segments) — por isso buscamos o detalhe à parte,
 * e só para projetos needs_review (os únicos que podem ter pendências).
 */
function PendingCount({ projectId, status }: { projectId: string; status: Project["status"] }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (status !== "needs_review") return;
    let cancelled = false;
    getProject(projectId)
      .then((detail) => {
        if (!cancelled) setCount(detail.doubtful_segments.filter((s) => s.status === "pending").length);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, status]);

  if (status !== "needs_review") return null;
  return (
    <span className="text-xs text-amber-700">
      {count === null ? "carregando pendências..." : `${count} trecho(s) pendente(s)`}
    </span>
  );
}
