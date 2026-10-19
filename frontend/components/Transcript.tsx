"use client";

import { useEffect } from "react";
import { TriangleAlert, Volume2 } from "lucide-react";
import type { DoubtfulSegment, SpeakerSegment, WordTiming } from "@/lib/types";
import { pendingSegmentsSorted } from "@/lib/segments";
import { buildSpeakerLabelMap } from "@/lib/speakers";
import { blockWordBoundaries } from "@/lib/speakerBlocks";

interface TranscriptProps {
  finalText: string;
  segments: DoubtfulSegment[];
  wordTimings: WordTiming[];
  /** Vazio se a diarização não rodou/falhou — nesse caso nenhum rótulo de falante é mostrado. */
  speakerSegments: SpeakerSegment[];
  /** Posição atual da reprodução em ms, ou null se parado/sem áudio carregado. */
  playbackMs: number | null;
  selectedSegmentId: string | null;
  onSelectSegment: (segment: DoubtfulSegment) => void;
  /** Toca exatamente o intervalo que o usuário selecionou com o mouse no texto. */
  onSelectionPlay: (startMs: number, endMs: number) => void;
  /** Chamado quando a seleção de texto é desfeita (clique em branco, Esc, etc). */
  onSelectionCleared: () => void;
  /**
   * Depois de uma edição livre, word_timings vem de um realinhamento por diff
   * (ver backend: realign_word_timings) — as posições dos trechos pendentes
   * antigos não correspondem mais a nada no texto reescrito. Sobrepor os
   * botões de trecho nessas posições produzia uma mistura bagunçada de
   * palavras antigas e novas. Com manualOverride, os trechos pendentes não
   * são mais intercalados no texto (continuam revisáveis pelo painel abaixo).
   */
  manualOverride: boolean;
}

type Part = { type: "text"; content: string } | { type: "segment"; segment: DoubtfulSegment };

type Atom = { kind: "word"; timing: WordTiming } | { kind: "segment"; segment: DoubtfulSegment };

/**
 * Fallback usado quando não há word_timings (ex.: depois de uma edição livre,
 * ver manual_override) — localiza os trechos pendentes por texto dentro de
 * finalText, sem acompanhamento de reprodução.
 */
function buildParts(finalText: string, pending: DoubtfulSegment[]): Part[] {
  const ordered = pendingSegmentsSorted(pending);
  const parts: Part[] = [];
  let cursor = 0;

  for (const segment of ordered) {
    const idx = finalText.indexOf(segment.reference_text, cursor);
    if (idx === -1) continue; // não deveria acontecer, mas não quebra a tela se acontecer
    if (idx > cursor) {
      parts.push({ type: "text", content: finalText.slice(cursor, idx) });
    }
    parts.push({ type: "segment", segment });
    cursor = idx + segment.reference_text.length;
  }

  if (cursor < finalText.length) {
    parts.push({ type: "text", content: finalText.slice(cursor) });
  }

  return parts;
}

/**
 * word_timings particiona o texto inteiro em ordem cronológica (ver
 * backend: app/services/transcript.py:word_timings). Intercalamos os
 * trechos pendentes nessa mesma linha do tempo.
 *
 * Importante: a palavra (ou palavras) de um trecho pendente é pulada por
 * CONTAGEM, não por sobreposição de tempo (`start_ms`/`end_ms`). O Whisper
 * às vezes produz palavras com duração zero (start_ms === end_ms) — nesse
 * caso, comparar tempos faz a primeira palavra do trecho ser empurrada tanto
 * como texto normal quanto como botão do trecho (duplicada, uma ao lado da
 * outra). Como os trechos ainda pendentes passam intactos pelo merge do
 * backend (um item por palavra, só os resolvidos são colapsados), o número
 * de palavras em reference_text sempre corresponde 1:1 aos próximos itens de
 * word_timings — contar é robusto onde comparar tempos não é.
 */
function buildAtoms(wordTimings: WordTiming[], pending: DoubtfulSegment[]): Atom[] {
  const ordered = pendingSegmentsSorted(pending);
  const atoms: Atom[] = [];
  let wIdx = 0;

  for (const segment of ordered) {
    while (wIdx < wordTimings.length && wordTimings[wIdx].start_ms < segment.start_ms) {
      atoms.push({ kind: "word", timing: wordTimings[wIdx] });
      wIdx++;
    }
    atoms.push({ kind: "segment", segment });
    const wordCount = segment.reference_text.trim().split(/\s+/).filter(Boolean).length || 1;
    wIdx += wordCount;
  }

  while (wIdx < wordTimings.length) {
    atoms.push({ kind: "word", timing: wordTimings[wIdx] });
    wIdx++;
  }

  return atoms;
}

function isActive(playbackMs: number | null, startMs: number, endMs: number): boolean {
  return playbackMs !== null && playbackMs >= startMs && playbackMs < endMs;
}

/**
 * Lê a seleção de texto atual do navegador (window.getSelection) e, se ela
 * começa e termina dentro de palavras marcadas com data-start-ms/data-end-ms,
 * manda tocar exatamente esse intervalo. Ignora seleções vazias/colapsadas
 * (ex.: um clique sem arrastar).
 */
function handleTextSelection(onSelectionPlay: (startMs: number, endMs: number) => void) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().trim() === "") return;

  const range = selection.getRangeAt(0);
  const startEl =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as Element);
  const endEl =
    range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : (range.endContainer as Element);

  const startMarker = startEl?.closest<HTMLElement>("[data-start-ms]");
  const endMarker = endEl?.closest<HTMLElement>("[data-end-ms]");
  if (!startMarker || !endMarker) return;

  const startMs = Number(startMarker.dataset.startMs);
  const endMs = Number(endMarker.dataset.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;

  onSelectionPlay(startMs, endMs);
}

function SegmentButton({
  segment,
  isSelected,
  isPlaying,
  onSelectSegment,
}: {
  segment: DoubtfulSegment;
  isSelected: boolean;
  isPlaying: boolean;
  onSelectSegment: (segment: DoubtfulSegment) => void;
}) {
  const confidencePct = Math.round(segment.score * 100);

  return (
    <button
      type="button"
      onClick={() => onSelectSegment(segment)}
      title={`Confiança: ${confidencePct}%`}
      aria-label={`Trecho duvidoso, confiança ${confidencePct}%: ${segment.reference_text}`}
      className={`mx-0.5 rounded px-1 underline decoration-amber-600 decoration-2 ${
        isSelected ? "bg-amber-200 ring-2 ring-amber-500" : "bg-amber-100 hover:bg-amber-200"
      } ${isPlaying ? "animate-pulse" : ""}`}
    >
      <span aria-hidden="true" className="inline-flex align-text-bottom">
        {isPlaying ? <Volume2 size={14} /> : <TriangleAlert size={14} />}
      </span>{" "}
      {segment.reference_text}
    </button>
  );
}

// Paleta fixa (não aleatória) para que o mesmo falante sempre saia com a
// mesma cor dentro de uma transcrição — pares fundo/texto escolhidos para
// contraste acessível (WCAG AA) em texto pequeno.
const SPEAKER_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-emerald-100 text-emerald-800",
  "bg-violet-100 text-violet-800",
  "bg-amber-100 text-amber-900",
  "bg-pink-100 text-pink-800",
  "bg-cyan-100 text-cyan-800",
];

function speakerColorClass(speaker: string): string {
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = (hash * 31 + speaker.charCodeAt(i)) | 0;
  }
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}

function SpeakerTag({ speaker }: { speaker: string | null }) {
  const colorClass = speaker ? speakerColorClass(speaker) : "bg-slate-200 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {speaker ?? "Falante desconhecido"}
    </span>
  );
}

export default function Transcript({
  finalText,
  segments,
  wordTimings,
  speakerSegments,
  playbackMs,
  selectedSegmentId,
  onSelectSegment,
  onSelectionPlay,
  onSelectionCleared,
  manualOverride,
}: TranscriptProps) {
  // "selectionchange" dispara no documento inteiro sempre que a seleção muda,
  // inclusive quando ela é desfeita (clique em branco, Esc, etc) — é o único
  // jeito confiável de saber que não há mais nada selecionado, já que isso
  // não gera um "mouseup" dentro do texto.
  useEffect(() => {
    function handleSelectionChange() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.toString().trim() === "") {
        onSelectionCleared();
      }
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [onSelectionCleared]);

  // Ver o comentário de manualOverride em TranscriptProps: depois de uma
  // edição livre, as posições dos trechos pendentes antigos não batem mais
  // com o texto reescrito — não tentamos mais sobrepor os botões no texto.
  const pending = manualOverride ? [] : segments.filter((s) => s.status === "pending");

  if (!finalText) {
    return <p className="text-sm text-slate-500">Ainda não há texto transcrito.</p>;
  }

  if (wordTimings.length === 0) {
    const parts = buildParts(finalText, pending);
    return (
      <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-800">
        {parts.map((part, i) => {
          if (part.type === "text") return <span key={i}>{part.content}</span>;
          return (
            <SegmentButton
              key={part.segment.id}
              segment={part.segment}
              isSelected={part.segment.id === selectedSegmentId}
              isPlaying={false}
              onSelectSegment={onSelectSegment}
            />
          );
        })}
      </p>
    );
  }

  const atoms = buildAtoms(wordTimings, pending);
  // Depois de uma edição livre (manual_override), os rótulos de falante já
  // ficam embutidos no próprio texto ("Falante: ..." — ver EditableTranscript
  // e lib/speakerBlocks.ts), e o speaker_segments calculado pelo servidor
  // fica impreciso (baseado em sobreposição de tempo com os timings
  // realinhados). Mostrar os dois ao mesmo tempo duplicaria/contradiria a
  // informação, então as etiquetas automáticas somem nesse modo.
  const speakerLabels = manualOverride ? new Map<number, string | null>() : buildSpeakerLabelMap(speakerSegments);
  // O backend junta as palavras da edição livre com um split() comum
  // (realign_word_timings), perdendo as quebras de parágrafo entre trechos —
  // sem isso o texto aparece como um bloco só. Como manualOverride sempre tem
  // pending=[] (ver acima), cada atom é exatamente uma palavra, então o
  // índice do atom bate com o índice de palavra usado por blockWordBoundaries.
  const manualBreakAtIndex = manualOverride
    ? new Set(blockWordBoundaries(finalText).map((b) => b.wordIndex))
    : new Set<number>();

  return (
    <p
      className="whitespace-pre-wrap text-base leading-relaxed text-slate-800"
      onMouseUp={() => handleTextSelection(onSelectionPlay)}
      title="Selecione um trecho do texto para tocar só ele"
    >
      {atoms.map((atom, i) => {
        const startMs = atom.kind === "word" ? atom.timing.start_ms : atom.segment.start_ms;
        const endMs = atom.kind === "word" ? atom.timing.end_ms : atom.segment.end_ms;
        const speakerAtStart = speakerLabels.get(startMs);

        return (
          <span key={i} data-start-ms={startMs} data-end-ms={endMs}>
            {manualBreakAtIndex.has(i) ? (
              i > 0 && (
                <>
                  <br />
                  <br />
                </>
              )
            ) : speakerAtStart !== undefined ? (
              <>
                {i > 0 && (
                  <>
                    <br />
                    <br />
                  </>
                )}
                <SpeakerTag speaker={speakerAtStart} />
                <br />
              </>
            ) : (
              i > 0 && " "
            )}
            {atom.kind === "word" ? (
              <span
                className={
                  isActive(playbackMs, atom.timing.start_ms, atom.timing.end_ms)
                    ? "rounded bg-blue-100 text-blue-900"
                    : undefined
                }
              >
                {atom.timing.text}
              </span>
            ) : (
              <SegmentButton
                segment={atom.segment}
                isSelected={atom.segment.id === selectedSegmentId}
                isPlaying={isActive(playbackMs, atom.segment.start_ms, atom.segment.end_ms)}
                onSelectSegment={onSelectSegment}
              />
            )}
          </span>
        );
      })}
    </p>
  );
}
