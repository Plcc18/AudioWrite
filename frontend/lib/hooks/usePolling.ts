"use client";

import { useEffect, useRef } from "react";

/**
 * Chama `callback` imediatamente e depois a cada `intervalMs`, enquanto
 * `enabled` for true. Usado para o polling de GET /projects/{id} durante
 * queued/processing.
 */
export function usePolling(callback: () => void, intervalMs: number, enabled: boolean): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    callbackRef.current();
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}
