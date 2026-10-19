"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ApiError, resolveSegment } from "@/lib/api";
import type { DoubtfulSegment as DoubtfulSegmentType, ResolveSegmentPayload } from "@/lib/types";

export interface DoubtfulSegmentHandle {
  /** Confirma a seleção atual (usado pelo atalho de teclado Enter). */
  confirmSelection: () => void;
}

interface DoubtfulSegmentProps {
  projectId: string;
  segment: DoubtfulSegmentType;
  pendingIndex: number;
  pendingTotal: number;
  onResolved: (updated: DoubtfulSegmentType) => void;
  onUnauthorized: () => void;
}

type Selection = { kind: "current" } | { kind: "alternative"; index: number } | { kind: "custom" };

const DoubtfulSegment = forwardRef<DoubtfulSegmentHandle, DoubtfulSegmentProps>(function DoubtfulSegment(
  { projectId, segment, pendingIndex, pendingTotal, onResolved, onUnauthorized },
  ref
) {
  const [selection, setSelection] = useState<Selection>({ kind: "current" });
  const [customText, setCustomText] = useState(segment.reference_text);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confidencePct = Math.round(segment.score * 100);

  async function submit(payload: ResolveSegmentPayload) {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await resolveSegment(projectId, segment.id, payload);
      onResolved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : "Falha ao salvar a correção.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleConfirm() {
    if (submitting) return;
    if (selection.kind === "current") {
      submit({ action: "custom_text", text: segment.reference_text });
    } else if (selection.kind === "alternative") {
      submit({ action: "accept_alternative", alternative_index: selection.index });
    } else {
      const trimmed = customText.trim();
      if (!trimmed) {
        setError("Digite uma correção ou escolha uma das alternativas.");
        return;
      }
      submit({ action: "custom_text", text: trimmed });
    }
  }

  useImperativeHandle(ref, () => ({ confirmSelection: handleConfirm }));

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center justify-between text-xs text-amber-800">
        <span>
          Trecho {pendingIndex} de {pendingTotal}
        </span>
        <span title={`Confiança do sistema: ${confidencePct}%`} className="inline-flex items-center gap-1">
          <TriangleAlert size={14} /> Confiança: {confidencePct}%
        </span>
      </div>

      <fieldset className="mt-3 space-y-2">
        <legend className="text-sm font-medium text-slate-700">Escolha a versão correta</legend>

        <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm">
          <input
            type="radio"
            name={`choice-${segment.id}`}
            checked={selection.kind === "current"}
            onChange={() => setSelection({ kind: "current" })}
            className="mt-1"
          />
          <span>
            <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Atual</span>
            {segment.reference_text}
          </span>
        </label>

        {segment.alternatives.map((alt, index) => (
          <label key={index} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm">
            <input
              type="radio"
              name={`choice-${segment.id}`}
              checked={selection.kind === "alternative" && selection.index === index}
              onChange={() => setSelection({ kind: "alternative", index })}
              className="mt-1"
            />
            <span>
              <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                {alt.model}
              </span>
              {alt.text}
            </span>
          </label>
        ))}

        <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm">
          <input
            type="radio"
            name={`choice-${segment.id}`}
            checked={selection.kind === "custom"}
            onChange={() => setSelection({ kind: "custom" })}
            className="mt-1"
          />
          <span className="flex-1">
            <label htmlFor={`custom-text-${segment.id}`} className="mr-1 block text-xs font-medium text-slate-600">
              Digitar correção
            </label>
            <input
              id={`custom-text-${segment.id}`}
              type="text"
              value={customText}
              onChange={(e) => {
                setCustomText(e.target.value);
                setSelection({ kind: "custom" });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </span>
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={submitting}
        className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {submitting ? "Salvando..." : "Confirmar"} <span className="ml-1 text-xs text-blue-200">(Enter)</span>
      </button>
    </div>
  );
});

export default DoubtfulSegment;
