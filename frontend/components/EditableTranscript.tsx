"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, RotateCcw, X } from "lucide-react";
import { ApiError, resetProject, updateFinalText } from "@/lib/api";
import type { DoubtfulSegment as DoubtfulSegmentType, ProjectDetail } from "@/lib/types";
import { blocksFromSpeakerSegments, parseBlocks, serializeBlocks, type SpeakerBlockInput } from "@/lib/speakerBlocks";
import ConfirmDialog from "./ConfirmDialog";
import Transcript from "./Transcript";
import TranscriptSearch from "./TranscriptSearch";

interface EditBlock extends SpeakerBlockInput {
  id: string;
}

interface EditableTranscriptProps {
  project: ProjectDetail;
  playbackMs: number | null;
  onJumpTo: (ms: number) => void;
  onSelectionPlay: (startMs: number, endMs: number) => void;
  onSelectionCleared: () => void;
  selectedSegmentId: string | null;
  onSelectSegment: (segment: DoubtfulSegmentType) => void;
  onUpdated: (updated: ProjectDetail) => void;
  onUnauthorized: () => void;
}

/**
 * O lápis fica sempre disponível (needs_review ou done). Ao salvar a primeira
 * vez, o backend marca manual_override=true: a partir daí ele para de
 * reconstruir final_text a cada trecho resolvido, porque a edição manual
 * passa a ser a fonte da verdade (senão seria sobrescrita).
 */
export default function EditableTranscript({
  project,
  playbackMs,
  onJumpTo,
  onSelectionPlay,
  onSelectionCleared,
  selectedSegmentId,
  onSelectSegment,
  onUpdated,
  onUnauthorized,
}: EditableTranscriptProps) {
  const [editing, setEditing] = useState(false);
  const [blocks, setBlocks] = useState<EditBlock[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const nextBlockId = useRef(0);
  function withIds(inputs: SpeakerBlockInput[]): EditBlock[] {
    return inputs.map((b) => {
      nextBlockId.current += 1;
      return { ...b, id: `b${nextBlockId.current}` };
    });
  }

  /**
   * Primeira vez editando (manual_override ainda false): começa a partir dos
   * trechos já identificados pela diarização, se houver. Reabrindo depois de
   * uma edição livre anterior: reconstrói os blocos a partir do próprio
   * final_text (que fomos nós que escrevemos no formato "Falante: texto"),
   * em vez de tentar recombinar com os turnos de diarização de novo — o
   * texto já editado é a fonte da verdade, não o cálculo por sobreposição de
   * tempo (que fica impreciso depois de uma reescrita livre).
   */
  function startEditing() {
    const initial = project.manual_override
      ? parseBlocks(project.final_text ?? "")
      : project.speaker_segments.length > 0
        ? blocksFromSpeakerSegments(project.speaker_segments)
        : [];
    setBlocks(withIds(initial.length > 0 ? initial : [{ speaker: "", text: project.final_text ?? "" }]));
    setError(null);
    setEditing(true);
  }

  function updateBlockSpeaker(id: string, speaker: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, speaker } : b)));
  }

  function updateBlockText(id: string, text: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, text } : b)));
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  function addBlock() {
    const lastSpeaker = blocks.length > 0 ? blocks[blocks.length - 1].speaker : "";
    setBlocks((prev) => [...prev, ...withIds([{ speaker: lastSpeaker, text: "" }])]);
  }

  async function save() {
    const serialized = serializeBlocks(blocks);
    if (!serialized) {
      setError("O texto não pode ficar vazio.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateFinalText(project.id, serialized);
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : "Falha ao salvar a edição.");
    } finally {
      setSubmitting(false);
    }
  }

  const pendingCount = project.doubtful_segments.filter((s) => s.status === "pending").length;
  const hasEdits = project.manual_override || project.doubtful_segments.some((s) => s.status === "resolved");

  async function handleReset() {
    setConfirmResetOpen(false);
    setResetting(true);
    setResetError(null);
    try {
      const updated = await resetProject(project.id);
      onUpdated(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setResetError(err instanceof Error ? err.message : "Falha ao resetar as edições.");
    } finally {
      setResetting(false);
    }
  }

  if (editing) {
    const speakerSuggestions = Array.from(new Set(blocks.map((b) => b.speaker.trim()).filter(Boolean)));

    return (
      <div>
        <datalist id="speaker-suggestions">
          {speakerSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <div className="space-y-3">
          {blocks.map((block, i) => (
            <div key={block.id} className="rounded-md border border-slate-200 p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <input
                  type="text"
                  autoFocus={i === 0}
                  value={block.speaker}
                  onChange={(e) => updateBlockSpeaker(block.id, e.target.value)}
                  list="speaker-suggestions"
                  placeholder="Falante"
                  aria-label={`Nome do falante do trecho ${i + 1}`}
                  className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm font-medium text-slate-700 focus-visible:outline-blue-600"
                />
                {blocks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBlock(block.id)}
                    title="Remover este trecho"
                    aria-label={`Remover trecho ${i + 1}`}
                    className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <textarea
                value={block.text}
                onChange={(e) => updateBlockText(block.id, e.target.value)}
                rows={3}
                aria-label={`Texto do trecho ${i + 1}`}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-base leading-relaxed text-slate-800 focus-visible:outline-blue-600"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addBlock}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Plus size={14} /> Adicionar trecho
        </button>

        {error && (
          <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Salvando..." : "Salvar"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={submitting}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Divida o texto em quantos trechos quiser e diga quem falou em cada um. A edição livre atualiza o texto
          exportado em .txt/.docx (incluindo o nome do falante de cada trecho). A legenda .srt continua usando os
          tempos originais da transcrição.
          {!project.manual_override && pendingCount > 0 && (
            <>
              {" "}
              Ainda há {pendingCount} trecho(s) pendente(s): depois de salvar, resolvê-los não vai mais alterar o
              texto automaticamente — use o lápis de novo para ajustar.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div>
      {project.manual_override && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-700">
          <Pencil size={14} /> Este texto foi editado manualmente. Resolver trechos pendentes não altera mais o texto
          automaticamente.
        </p>
      )}
      <TranscriptSearch wordTimings={project.word_timings} onJumpTo={onJumpTo} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <Transcript
            finalText={project.final_text ?? ""}
            segments={project.doubtful_segments}
            wordTimings={project.word_timings}
            speakerSegments={project.speaker_segments}
            playbackMs={playbackMs}
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={onSelectSegment}
            onSelectionPlay={onSelectionPlay}
            onSelectionCleared={onSelectionCleared}
            manualOverride={project.manual_override}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {hasEdits && (
            <button
              type="button"
              onClick={() => setConfirmResetOpen(true)}
              disabled={resetting}
              title="Resetar edições (voltar à transcrição original)"
              aria-label="Resetar edições e voltar à transcrição original"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
            >
              <RotateCcw size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={startEditing}
            title="Editar texto livremente"
            aria-label="Editar texto livremente"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <Pencil size={18} />
          </button>
        </div>
      </div>

      {resetError && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1 text-sm text-red-700">
          {resetError}
        </p>
      )}

      <ConfirmDialog
        open={confirmResetOpen}
        title="Resetar edições"
        message="Isso desfaz todos os trechos já corrigidos e qualquer edição livre, voltando exatamente à transcrição original — sem nenhuma revisão. Essa ação não pode ser desfeita."
        confirmLabel="Resetar"
        danger
        onConfirm={handleReset}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </div>
  );
}
