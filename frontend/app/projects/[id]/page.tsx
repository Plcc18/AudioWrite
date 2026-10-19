"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ApiError, createProject, getAudioUrl, getProject } from "@/lib/api";
import { usePolling } from "@/lib/hooks/usePolling";
import { adjacentPendingSegment, nextPendingAfterResolving, pendingSegmentsSorted } from "@/lib/segments";
import { validateAudioFile } from "@/lib/validateAudioFile";
import type { DoubtfulSegment as DoubtfulSegmentType, Project, ProjectDetail } from "@/lib/types";
import AudioPlayer, { type AudioPlayerHandle } from "@/components/AudioPlayer";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import DoubtfulSegment, { type DoubtfulSegmentHandle } from "@/components/DoubtfulSegment";
import EditableProjectTitle from "@/components/EditableProjectTitle";
import EditableTranscript from "@/components/EditableTranscript";
import StatusBadge from "@/components/StatusBadge";
import ExportMenu from "@/components/ExportMenu";
import TopBar from "@/components/TopBar";

const STATUS_MESSAGES: Record<string, string> = {
  queued: "Seu áudio está na fila e vai começar a ser processado em breve.",
  processing: "Transcrevendo o áudio e comparando versões... isso pode levar alguns minutos.",
};

function isFormField(el: Element | null): boolean {
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName);
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: projectId } = use(params);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioUrlError, setAudioUrlError] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [playbackMs, setPlaybackMs] = useState<number | null>(null);
  const [activeSelection, setActiveSelection] = useState<{ startMs: number; endMs: number } | null>(null);

  const audioPlayerRef = useRef<AudioPlayerHandle>(null);
  const segmentRef = useRef<DoubtfulSegmentHandle>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goToLogin = useCallback(() => router.push("/login"), [router]);

  const refreshProject = useCallback(() => {
    getProject(projectId)
      .then((detail) => {
        setProject(detail);
        setLoadError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          goToLogin();
          return;
        }
        setLoadError(err instanceof Error ? err.message : "Erro ao carregar o projeto.");
      });
  }, [projectId, goToLogin]);

  useEffect(() => {
    refreshProject();
  }, [refreshProject]);

  const isPolling = project?.status === "queued" || project?.status === "processing";
  usePolling(refreshProject, 5000, isPolling);

  // URL assinada do áudio: só precisamos dela quando já há algo pra revisar/ouvir,
  // e precisamos renová-la antes de expirar (signed URL do Supabase Storage).
  useEffect(() => {
    if (!project || project.status === "queued" || project.status === "processing") return;

    let cancelled = false;

    function scheduleRefresh(expiresInSeconds: number) {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      const delayMs = Math.max((expiresInSeconds - 60) * 1000, 30_000);
      refreshTimerRef.current = setTimeout(fetchUrl, delayMs);
    }

    function fetchUrl() {
      getAudioUrl(projectId)
        .then(({ url, expires_in }) => {
          if (cancelled) return;
          setAudioUrl(url);
          setAudioUrlError(null);
          scheduleRefresh(expires_in);
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof ApiError && err.status === 401) {
            goToLogin();
            return;
          }
          setAudioUrlError(err instanceof Error ? err.message : "Falha ao carregar o áudio.");
        });
    }

    fetchUrl();
    return () => {
      cancelled = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [project?.status, projectId, goToLogin]);

  // Seleciona automaticamente o primeiro trecho pendente quando o projeto entra em revisão.
  useEffect(() => {
    if (!project) return;
    const pending = pendingSegmentsSorted(project.doubtful_segments);
    if (pending.length === 0) {
      setSelectedSegmentId(null);
      return;
    }
    if (!selectedSegmentId || !pending.some((s) => s.id === selectedSegmentId)) {
      setSelectedSegmentId(pending[0].id);
    }
  }, [project, selectedSegmentId]);

  const selectSegmentAndPlay = useCallback(
    (segment: DoubtfulSegmentType) => {
      setSelectedSegmentId(segment.id);
      setActiveSelection(null);
      audioPlayerRef.current?.playRange(segment.start_ms, segment.end_ms);
    },
    []
  );

  const jumpToMs = useCallback((ms: number) => {
    setActiveSelection(null);
    audioPlayerRef.current?.playFrom(ms);
  }, []);

  // Enquanto o trecho selecionado no texto continuar selecionado, o botão
  // Tocar/Pausar e o atalho de espaço (ver AudioPlayer) se limitam a ele —
  // ver activeSelection/onSelectionCleared.
  const playSelection = useCallback((startMs: number, endMs: number) => {
    setActiveSelection({ startMs, endMs });
    audioPlayerRef.current?.playRange(startMs, endMs);
  }, []);

  const clearSelection = useCallback(() => setActiveSelection(null), []);

  // Atalhos de teclado: espaço (tocar/pausar), Enter (confirmar), setas (navegar entre pendentes).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!project) return;
      const active = document.activeElement;

      if (e.key === " " || e.code === "Space") {
        if (isFormField(active)) return;
        e.preventDefault();
        audioPlayerRef.current?.togglePlayPause();
      } else if (e.key === "Enter") {
        if (active?.tagName === "BUTTON" || active?.tagName === "INPUT") return;
        segmentRef.current?.confirmSelection();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (isFormField(active)) return;
        e.preventDefault();
        const next = adjacentPendingSegment(project.doubtful_segments, selectedSegmentId, 1);
        // Com trechos pendentes, as setas navegam entre eles (fluxo de revisão).
        // Sem nenhum pendente (ou já todos resolvidos), passam a avançar o
        // áudio alguns segundos, em vez de não fazer nada.
        if (next) selectSegmentAndPlay(next);
        else audioPlayerRef.current?.skip(5);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (isFormField(active)) return;
        e.preventDefault();
        const prev = adjacentPendingSegment(project.doubtful_segments, selectedSegmentId, -1);
        if (prev) selectSegmentAndPlay(prev);
        else audioPlayerRef.current?.skip(-5);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [project, selectedSegmentId, selectSegmentAndPlay]);

  function handleSegmentResolved(resolved: DoubtfulSegmentType) {
    getProject(projectId)
      .then((detail) => {
        setProject(detail);
        setActiveSelection(null);
        const next = nextPendingAfterResolving(detail.doubtful_segments, resolved.start_ms);
        setSelectedSegmentId(next ? next.id : null);
        if (next) audioPlayerRef.current?.seekTo(next.start_ms);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) goToLogin();
      });
  }

  if (loadError) {
    return (
      <PageShell>
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={16} /> Voltar aos projetos
        </Link>
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      </PageShell>
    );
  }

  if (!project) {
    return (
      <PageShell>
        <p className="text-sm text-slate-500">Carregando...</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={16} /> Voltar aos projetos
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <EditableProjectTitle
          project={project}
          onUpdated={(updated: Project) => setProject((prev) => (prev ? { ...prev, ...updated } : prev))}
          onUnauthorized={goToLogin}
        />
        <div className="flex items-center gap-2">
          <StatusBadge status={project.status} />
          <DeleteProjectButton
            projectId={project.id}
            filename={project.filename}
            onDeleted={() => router.push("/projects")}
            onUnauthorized={goToLogin}
          />
        </div>
      </div>

      {(project.status === "queued" || project.status === "processing") && (
        <ProcessingIndicator status={project.status} />
      )}

      {project.status === "failed" && <FailedState project={project} onRetried={(id) => router.push(`/projects/${id}`)} />}

      {(project.status === "needs_review" || project.status === "done") && (
        <ReviewView
          project={project}
          audioUrl={audioUrl}
          audioUrlError={audioUrlError}
          audioPlayerRef={audioPlayerRef}
          segmentRef={segmentRef}
          playbackMs={playbackMs}
          onTimeUpdate={setPlaybackMs}
          activeSelection={activeSelection}
          onJumpTo={jumpToMs}
          onSelectionPlay={playSelection}
          onSelectionCleared={clearSelection}
          selectedSegmentId={selectedSegmentId}
          onSelectSegment={selectSegmentAndPlay}
          onSegmentResolved={handleSegmentResolved}
          onProjectUpdated={setProject}
          onUnauthorized={goToLogin}
        />
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="space-y-4">{children}</div>
      </main>
    </div>
  );
}

function ProcessingIndicator({ status }: { status: "queued" | "processing" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-700">{STATUS_MESSAGES[status]}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label={STATUS_MESSAGES[status]}>
        <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
      </div>
      <p className="mt-2 text-xs text-slate-400">Atualizando automaticamente a cada 5 segundos.</p>
    </div>
  );
}

function FailedState({ project, onRetried }: { project: ProjectDetail; onRetried: (newProjectId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRetry() {
    if (!file) return;
    setSubmitting(true);
    setUploadError(null);
    setProgress(0);
    try {
      const newProject = await createProject(file, setProgress);
      onRetried(newProject.id);
    } catch (err) {
      setSubmitting(false);
      setProgress(null);
      setUploadError(err instanceof Error ? err.message : "Falha ao reenviar o áudio.");
    }
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">O processamento falhou.</p>
      {project.error && <p className="mt-1 text-sm text-red-700">{project.error}</p>}

      <p className="mt-3 text-sm text-slate-700">
        Não há reprocessamento automático: envie o áudio novamente para criar um novo projeto.
      </p>

      <label htmlFor="retry-file" className="mt-3 block text-sm font-medium text-slate-700">
        Selecionar áudio novamente
      </label>
      <input
        id="retry-file"
        type="file"
        disabled={submitting}
        onChange={(e) => {
          const selected = e.target.files?.[0] ?? null;
          setFile(null);
          setUploadError(null);
          if (!selected) return;
          const error = validateAudioFile(selected);
          if (error) {
            setValidationError(error);
            return;
          }
          setValidationError(null);
          setFile(selected);
        }}
        className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700"
      />

      {validationError && <p className="mt-2 text-sm text-red-700">{validationError}</p>}
      {progress !== null && <p className="mt-2 text-xs text-slate-500">Enviando... {progress}%</p>}
      {uploadError && <p className="mt-2 text-sm text-red-700">{uploadError}</p>}

      <button
        type="button"
        onClick={handleRetry}
        disabled={!file || submitting}
        className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {submitting ? "Enviando..." : "Reenviar áudio"}
      </button>
    </div>
  );
}

interface ReviewViewProps {
  project: ProjectDetail;
  audioUrl: string | null;
  audioUrlError: string | null;
  audioPlayerRef: React.RefObject<AudioPlayerHandle>;
  segmentRef: React.RefObject<DoubtfulSegmentHandle>;
  playbackMs: number | null;
  onTimeUpdate: (ms: number) => void;
  activeSelection: { startMs: number; endMs: number } | null;
  onJumpTo: (ms: number) => void;
  onSelectionPlay: (startMs: number, endMs: number) => void;
  onSelectionCleared: () => void;
  selectedSegmentId: string | null;
  onSelectSegment: (segment: DoubtfulSegmentType) => void;
  onSegmentResolved: (resolved: DoubtfulSegmentType) => void;
  onProjectUpdated: (updated: ProjectDetail) => void;
  onUnauthorized: () => void;
}

function ReviewView({
  project,
  audioUrl,
  audioUrlError,
  audioPlayerRef,
  segmentRef,
  playbackMs,
  onTimeUpdate,
  activeSelection,
  onJumpTo,
  onSelectionPlay,
  onSelectionCleared,
  selectedSegmentId,
  onSelectSegment,
  onSegmentResolved,
  onProjectUpdated,
  onUnauthorized,
}: ReviewViewProps) {
  const pending = pendingSegmentsSorted(project.doubtful_segments);
  const selectedSegment = pending.find((s) => s.id === selectedSegmentId) ?? null;
  const selectedIndex = selectedSegment ? pending.indexOf(selectedSegment) + 1 : 0;

  return (
    <div className="space-y-4">
      <AudioPlayer
        ref={audioPlayerRef}
        audioUrl={audioUrl}
        loadError={audioUrlError}
        onTimeUpdate={onTimeUpdate}
        activeSelection={activeSelection}
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <EditableTranscript
          project={project}
          playbackMs={playbackMs}
          onJumpTo={onJumpTo}
          onSelectionPlay={onSelectionPlay}
          onSelectionCleared={onSelectionCleared}
          selectedSegmentId={selectedSegmentId}
          onSelectSegment={onSelectSegment}
          onUpdated={onProjectUpdated}
          onUnauthorized={onUnauthorized}
        />
      </div>

      {pending.length === 0 ? (
        <>
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Sem trechos pendentes. A transcrição está pronta para exportar.
          </p>
          <p className="text-xs text-slate-500">
            Atalhos: espaço tocar/pausar · setas avançar/voltar 5s (quando o foco não estiver em um campo)
          </p>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          Atalhos: espaço tocar/pausar · Enter confirmar · setas navegar entre trechos (quando o foco não estiver em um
          campo)
        </p>
      )}

      {selectedSegment && (
        <DoubtfulSegment
          ref={segmentRef}
          projectId={project.id}
          segment={selectedSegment}
          pendingIndex={selectedIndex}
          pendingTotal={pending.length}
          onResolved={onSegmentResolved}
          onUnauthorized={onUnauthorized}
        />
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <ExportMenu projectId={project.id} filename={project.filename} pendingCount={pending.length} onUnauthorized={onUnauthorized} />
      </div>
    </div>
  );
}
