import { describe, expect, it } from "vitest";
import { blockWordBoundaries, blocksFromSpeakerSegments, parseBlocks, serializeBlocks } from "./speakerBlocks";

describe("serializeBlocks", () => {
  it("formata cada trecho como 'Falante: texto', separados por linha em branco", () => {
    const result = serializeBlocks([
      { speaker: "Falante 1", text: "Oi, tudo bem?" },
      { speaker: "Falante 2", text: "Tudo sim!" },
    ]);
    expect(result).toBe("Falante 1: Oi, tudo bem?\n\nFalante 2: Tudo sim!");
  });

  it("usa 'Falante' como nome padrão quando o campo fica em branco", () => {
    const result = serializeBlocks([{ speaker: "  ", text: "texto sem nome" }]);
    expect(result).toBe("Falante: texto sem nome");
  });

  it("descarta trechos com texto vazio", () => {
    const result = serializeBlocks([
      { speaker: "Falante 1", text: "oi" },
      { speaker: "Falante 2", text: "   " },
    ]);
    expect(result).toBe("Falante 1: oi");
  });
});

describe("parseBlocks", () => {
  it("é o inverso de serializeBlocks para o caso comum", () => {
    const original = [
      { speaker: "Falante 1", text: "Oi, tudo bem?" },
      { speaker: "Falante 2", text: "Tudo sim!" },
    ];
    expect(parseBlocks(serializeBlocks(original))).toEqual(original);
  });

  it("texto sem o padrão 'Falante:' vira um trecho sem falante atribuído", () => {
    expect(parseBlocks("um parágrafo qualquer sem rótulo")).toEqual([
      { speaker: "", text: "um parágrafo qualquer sem rótulo" },
    ]);
  });

  it("não confunde um rótulo com uma frase comum que contém dois pontos", () => {
    // mais de 40 caracteres antes do ":" não é tratado como nome de falante
    const text = "Ele me disse uma frase bem longa antes dos dois pontos: e seguiu falando";
    expect(parseBlocks(text)).toEqual([{ speaker: "", text }]);
  });

  it("texto vazio retorna lista vazia", () => {
    expect(parseBlocks("   ")).toEqual([]);
  });
});

describe("blockWordBoundaries", () => {
  it("marca o índice de palavra onde cada trecho começa", () => {
    const text = serializeBlocks([
      { speaker: "Falante 1", text: "Oi tudo bem" },
      { speaker: "Falante 2", text: "Tudo sim" },
    ]);
    expect(blockWordBoundaries(text)).toEqual([
      { wordIndex: 0, speaker: "Falante 1" },
      { wordIndex: 5, speaker: "Falante 2" }, // "Falante", "1:", "Oi", "tudo", "bem" = 5 tokens
    ]);
  });

  it("texto sem rótulo de falante ainda conta como um único trecho", () => {
    expect(blockWordBoundaries("um dois tres")).toEqual([{ wordIndex: 0, speaker: "" }]);
  });
});

describe("blocksFromSpeakerSegments", () => {
  it("mapeia speaker_segments para blocos, tratando null como falante vazio", () => {
    const result = blocksFromSpeakerSegments([
      { speaker: "Falante 1", text: "oi" },
      { speaker: null, text: "inaudível" },
    ]);
    expect(result).toEqual([
      { speaker: "Falante 1", text: "oi" },
      { speaker: "", text: "inaudível" },
    ]);
  });
});
