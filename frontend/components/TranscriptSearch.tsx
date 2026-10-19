"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { findMatches } from "@/lib/transcriptSearch";
import type { WordTiming } from "@/lib/types";

interface TranscriptSearchProps {
  wordTimings: WordTiming[];
  onJumpTo: (ms: number) => void;
}

export default function TranscriptSearch({ wordTimings, onJumpTo }: TranscriptSearchProps) {
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => findMatches(wordTimings, query), [wordTimings, query]);

  // Ao digitar, volta pro primeiro resultado e já pula o áudio até ele.
  useEffect(() => {
    setMatchIndex(0);
    if (matches.length > 0) onJumpTo(matches[0].startMs);
    // onJumpTo é estável (useCallback no componente pai) — só reagimos a matches mudando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  function goTo(index: number) {
    if (matches.length === 0) return;
    const wrapped = ((index % matches.length) + matches.length) % matches.length;
    setMatchIndex(wrapped);
    onJumpTo(matches[wrapped].startMs);
  }

  if (wordTimings.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goTo(e.shiftKey ? matchIndex - 1 : matchIndex + 1);
            }
          }}
          placeholder="Buscar no texto..."
          aria-label="Buscar no texto e pular o áudio até lá"
          className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus-visible:outline-blue-600"
        />
      </div>

      {query.trim() ? (
        <>
          <span className="whitespace-nowrap text-xs text-slate-500">
            {matches.length === 0 ? "nada encontrado" : `${matchIndex + 1} de ${matches.length}`}
          </span>
          <button
            type="button"
            onClick={() => goTo(matchIndex - 1)}
            disabled={matches.length === 0}
            title="Resultado anterior"
            aria-label="Resultado anterior"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            onClick={() => goTo(matchIndex + 1)}
            disabled={matches.length === 0}
            title="Próximo resultado"
            aria-label="Próximo resultado"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <ChevronDown size={16} />
          </button>
        </>
      ) : (
        <span className="text-xs italic text-slate-400">ou selecione um trecho no texto para tocar só ele</span>
      )}
    </div>
  );
}
