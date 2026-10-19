import type { DoubtfulSegment } from "./types";

/** Trechos pendentes, ordenados pela posição no áudio. */
export function pendingSegmentsSorted(segments: DoubtfulSegment[]): DoubtfulSegment[] {
  return segments.filter((s) => s.status === "pending").sort((a, b) => a.start_ms - b.start_ms);
}

/**
 * Depois de resolver `resolvedSegmentId`, qual trecho pendente deve ganhar o
 * foco a seguir: o próximo na linha do tempo (por start_ms) entre os que
 * ainda estão pendentes em `segmentsAfterResolution`. Se não houver nenhum
 * pendente depois dele, volta para o primeiro pendente restante (wrap-around).
 * Se não houver nenhum pendente, retorna null.
 */
export function nextPendingAfterResolving(
  segmentsAfterResolution: DoubtfulSegment[],
  resolvedStartMs: number
): DoubtfulSegment | null {
  const pending = pendingSegmentsSorted(segmentsAfterResolution);
  if (pending.length === 0) return null;

  const after = pending.find((s) => s.start_ms > resolvedStartMs);
  return after ?? pending[0];
}

/** Vizinho (anterior/próximo) de `currentId` dentro da lista de pendentes, para navegação por seta. */
export function adjacentPendingSegment(
  segments: DoubtfulSegment[],
  currentId: string | null,
  direction: 1 | -1
): DoubtfulSegment | null {
  const pending = pendingSegmentsSorted(segments);
  if (pending.length === 0) return null;
  if (currentId === null) return pending[0];

  const index = pending.findIndex((s) => s.id === currentId);
  if (index === -1) return pending[0];

  const nextIndex = (index + direction + pending.length) % pending.length;
  return pending[nextIndex];
}
