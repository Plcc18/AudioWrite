"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

interface PlaybackRateMenuProps {
  rates: number[];
  value: number;
  onChange: (rate: number) => void;
}

export default function PlaybackRateMenu({ rates, value, onChange }: PlaybackRateMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Velocidade de reprodução"
        aria-label="Velocidade de reprodução"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {value}x
        <ChevronsUpDown size={12} className="text-slate-400" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Velocidade de reprodução"
          className="absolute right-0 top-full z-10 mt-1 w-20 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {rates.map((rate) => (
            <li key={rate}>
              <button
                type="button"
                role="option"
                aria-selected={rate === value}
                onClick={() => {
                  onChange(rate);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-100 ${
                  rate === value ? "font-medium text-blue-600" : "text-slate-700"
                }`}
              >
                {rate}x
                {rate === value && <Check size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
