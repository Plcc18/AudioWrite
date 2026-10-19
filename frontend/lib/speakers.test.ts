import { describe, expect, it } from "vitest";
import { buildSpeakerLabelMap } from "./speakers";
import type { SpeakerSegment } from "./types";

function seg(start_ms: number, speaker: string | null): SpeakerSegment {
  return { start_ms, end_ms: start_ms + 1000, speaker, text: "texto" };
}

describe("buildSpeakerLabelMap", () => {
  it("retorna um mapa vazio para uma lista vazia", () => {
    expect(buildSpeakerLabelMap([]).size).toBe(0);
  });

  it("mapeia start_ms para o falante daquele trecho", () => {
    const map = buildSpeakerLabelMap([seg(0, "Falante 1"), seg(1000, "Falante 2")]);
    expect(map.get(0)).toBe("Falante 1");
    expect(map.get(1000)).toBe("Falante 2");
    expect(map.has(500)).toBe(false);
  });

  it("preserva falante null (trecho sem correspondência de diarização)", () => {
    const map = buildSpeakerLabelMap([seg(0, null)]);
    expect(map.get(0)).toBeNull();
    expect(map.has(0)).toBe(true);
  });
});
