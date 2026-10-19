import type { SpeakerSegment } from "./types";

/**
 * Mapeia start_ms -> speaker para cada trecho de falante. Funciona porque
 * speaker_segments é derivado, no backend, exatamente da mesma lista de
 * word_timings que o Transcript já renderiza (ver app/api/projects.py:
 * _speaker_segments_out) — o start_ms de cada trecho de falante sempre
 * coincide com o start_ms de alguma palavra (ou trecho pendente) já exibido,
 * então um lookup exato é suficiente (sem precisar de correspondência por
 * sobreposição de tempo aqui no frontend).
 */
export function buildSpeakerLabelMap(speakerSegments: SpeakerSegment[]): Map<number, string | null> {
  const map = new Map<number, string | null>();
  for (const seg of speakerSegments) {
    map.set(seg.start_ms, seg.speaker);
  }
  return map;
}
