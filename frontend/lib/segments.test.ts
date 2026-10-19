import { describe, expect, it } from "vitest";
import { adjacentPendingSegment, nextPendingAfterResolving, pendingSegmentsSorted } from "./segments";
import type { DoubtfulSegment } from "./types";

function seg(partial: Partial<DoubtfulSegment> & { id: string; start_ms: number }): DoubtfulSegment {
  return {
    end_ms: partial.start_ms + 1000,
    reference_text: "texto",
    alternatives: [],
    score: 0.5,
    status: "pending",
    resolved_text: null,
    ...partial,
  };
}

describe("pendingSegmentsSorted", () => {
  it("filtra resolvidos e ordena por start_ms", () => {
    const segments = [
      seg({ id: "c", start_ms: 3000 }),
      seg({ id: "a", start_ms: 1000 }),
      seg({ id: "b", start_ms: 2000, status: "resolved" }),
    ];
    expect(pendingSegmentsSorted(segments).map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("nextPendingAfterResolving", () => {
  it("avança para o próximo pendente na linha do tempo", () => {
    const segments = [
      seg({ id: "a", start_ms: 1000, status: "resolved" }),
      seg({ id: "b", start_ms: 2000 }),
      seg({ id: "c", start_ms: 3000 }),
    ];
    const next = nextPendingAfterResolving(segments, 1000);
    expect(next?.id).toBe("b");
  });

  it("volta para o primeiro pendente quando resolve o último (wrap-around)", () => {
    const segments = [
      seg({ id: "a", start_ms: 1000 }),
      seg({ id: "b", start_ms: 2000, status: "resolved" }),
    ];
    const next = nextPendingAfterResolving(segments, 2000);
    expect(next?.id).toBe("a");
  });

  it("retorna null quando não há mais pendentes", () => {
    const segments = [seg({ id: "a", start_ms: 1000, status: "resolved" })];
    const next = nextPendingAfterResolving(segments, 1000);
    expect(next).toBeNull();
  });
});

describe("adjacentPendingSegment", () => {
  const segments = [
    seg({ id: "a", start_ms: 1000 }),
    seg({ id: "b", start_ms: 2000 }),
    seg({ id: "c", start_ms: 3000 }),
  ];

  it("navega para o próximo com direction 1", () => {
    expect(adjacentPendingSegment(segments, "a", 1)?.id).toBe("b");
  });

  it("navega para o anterior com direction -1", () => {
    expect(adjacentPendingSegment(segments, "b", -1)?.id).toBe("a");
  });

  it("dá wrap-around no fim e no início da lista", () => {
    expect(adjacentPendingSegment(segments, "c", 1)?.id).toBe("a");
    expect(adjacentPendingSegment(segments, "a", -1)?.id).toBe("c");
  });

  it("retorna o primeiro pendente quando não há seleção atual", () => {
    expect(adjacentPendingSegment(segments, null, 1)?.id).toBe("a");
  });
});
