// Suporta a edição livre "por falante" (ver EditableTranscript): o texto
// final continua sendo um único `string` (PATCH /final-text não muda), mas
// serializamos/desserializamos nele uma convenção simples e legível —
// "Falante: texto", um parágrafo por trecho — para poder editar e depois
// reabrir em blocos editáveis sem precisar de nenhum campo novo no backend.

export interface SpeakerBlockInput {
  speaker: string;
  text: string;
}

/** Uma linha "Falante: texto" por trecho, separados por linha em branco — já é
 * um formato de transcrição legível por si só, então o texto exportado em
 * .txt/.docx também sai assim (ver backend: export usa final_text direto). */
export function serializeBlocks(blocks: SpeakerBlockInput[]): string {
  return blocks
    .map((b) => ({ speaker: b.speaker.trim(), text: b.text.trim() }))
    .filter((b) => b.text)
    .map((b) => `${b.speaker || "Falante"}: ${b.text}`)
    .join("\n\n");
}

/**
 * Round-trip de serializeBlocks: cada parágrafo (separado por linha em
 * branco) vira um trecho; se o parágrafo começa com "Algo curto:", esse
 * prefixo vira o falante. Texto que não foi gerado por serializeBlocks (ex.:
 * já existia antes dessa funcionalidade) ainda funciona — só não terá
 * falante atribuído (fica "" e o usuário preenche na UI).
 */
export function parseBlocks(text: string): SpeakerBlockInput[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs.map((p) => {
    const match = p.match(/^([^\n:]{1,40}):\s*([\s\S]*)$/);
    if (match && match[2].trim()) {
      return { speaker: match[1].trim(), text: match[2].trim() };
    }
    return { speaker: "", text: p };
  });
}

/** Ponto de partida ao abrir a edição pela primeira vez (manual_override
 * ainda false): usa os trechos já identificados pela diarização. */
export function blocksFromSpeakerSegments(
  segments: { speaker: string | null; text: string }[]
): SpeakerBlockInput[] {
  return segments.map((s) => ({ speaker: s.speaker ?? "", text: s.text }));
}

/**
 * Em que índice de palavra (0-based) cada trecho começa dentro de final_text.
 * Usado por Transcript para inserir uma quebra de linha entre trechos depois
 * de uma edição livre — o backend (realign_word_timings) junta as palavras
 * com split() comum, perdendo as quebras de linha/parágrafo originais, então
 * sem isso o texto aparece como um bloco só, sem separação visual entre
 * falantes.
 *
 * Importante: a contagem de palavras por parágrafo precisa incluir o próprio
 * rótulo "Falante 1:" (não só o texto depois dele), porque é assim que o
 * backend tokeniza o final_text inteiro (sem saber que existe um "rótulo") —
 * usar só a contagem do texto do trecho (como parseBlocks devolve) deixaria o
 * índice errado por N palavras, uma por cada rótulo antes dele.
 */
export function blockWordBoundaries(finalText: string): { wordIndex: number; speaker: string }[] {
  const paragraphs = finalText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const boundaries: { wordIndex: number; speaker: string }[] = [];
  let wordIndex = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      const match = paragraph.match(/^([^\n:]{1,40}):\s*([\s\S]*)$/);
      const speaker = match && match[2].trim() ? match[1].trim() : "";
      boundaries.push({ wordIndex, speaker });
    }
    wordIndex += words.length;
  }
  return boundaries;
}
