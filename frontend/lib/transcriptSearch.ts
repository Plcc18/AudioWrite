import type { WordTiming } from "./types";

export interface SearchMatch {
  wordIndex: number;
  startMs: number;
}

/**
 * Busca `query` (substring, case-insensitive) no texto formado por
 * word_timings, incluindo frases que cruzam várias palavras (ex.: "da sua").
 * Cada ocorrência é mapeada de volta para a palavra onde ela começa, cujo
 * start_ms é usado para pular o áudio até lá.
 */
export function findMatches(wordTimings: WordTiming[], query: string): SearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q || wordTimings.length === 0) return [];

  const wordStartOffsets: number[] = [];
  let fullText = "";
  wordTimings.forEach((w, i) => {
    if (i > 0) fullText += " ";
    wordStartOffsets.push(fullText.length);
    fullText += w.text;
  });
  const lower = fullText.toLowerCase();

  const matches: SearchMatch[] = [];
  let fromIndex = 0;
  while (fromIndex <= lower.length) {
    const idx = lower.indexOf(q, fromIndex);
    if (idx === -1) break;

    let wordIndex = wordStartOffsets.length - 1;
    for (let i = 0; i < wordStartOffsets.length; i++) {
      const start = wordStartOffsets[i];
      const end = i + 1 < wordStartOffsets.length ? wordStartOffsets[i + 1] : fullText.length;
      if (idx >= start && idx < end) {
        wordIndex = i;
        break;
      }
    }

    matches.push({ wordIndex, startMs: wordTimings[wordIndex].start_ms });
    fromIndex = idx + Math.max(q.length, 1);
  }

  return matches;
}
