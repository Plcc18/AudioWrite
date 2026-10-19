"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import type WaveSurfer from "wavesurfer.js";
import PlaybackRateMenu from "./PlaybackRateMenu";

export interface AudioPlayerHandle {
  /** Pula para `startMs` e toca até `endMs` (pausa automaticamente ao chegar lá). */
  playRange: (startMs: number, endMs: number) => void;
  /** Pula para `startMs` e toca sem parar sozinho (usado pela busca no texto). */
  playFrom: (startMs: number) => void;
  /** Só posiciona o cursor em `startMs`, sem tocar (usado ao avançar automaticamente de trecho). */
  seekTo: (startMs: number) => void;
  togglePlayPause: () => void;
  /** Avança/volta `deltaSeconds` (negativo para voltar) a partir da posição atual — usado pelas setinhas do teclado. */
  skip: (deltaSeconds: number) => void;
}

const PLAYBACK_RATES = [0.25,0.5, 0.75, 1, 1.25, 1.5, 2, 4];

interface AudioPlayerProps {
  audioUrl: string | null;
  /** Mensagem de erro ao carregar o áudio, se houver (ex.: URL assinada expirada). */
  loadError?: string | null;
  /** Tempo atual em ms, chamado a cada atualização — usado para acompanhar/marcar o texto durante a reprodução. */
  onTimeUpdate?: (currentMs: number) => void;
  /** Enquanto não for null (trecho selecionado no texto), o botão Tocar e o atalho de espaço tocam só esse intervalo. */
  activeSelection?: { startMs: number; endMs: number } | null;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { audioUrl, loadError, onTimeUpdate, activeSelection },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const endBoundaryRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [previousVolume, setPreviousVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    if (!audioUrl || !containerRef.current) return;

    let destroyed = false;
    let instance: WaveSurfer | null = null;

    import("wavesurfer.js").then(({ default: WaveSurferCtor }) => {
      if (destroyed || !containerRef.current) return;

      instance = WaveSurferCtor.create({
        container: containerRef.current,
        waveColor: "#94a3b8",
        progressColor: "#2563eb",
        cursorColor: "#1e293b",
        height: 64,
        barWidth: 2,
        barGap: 1,
        url: audioUrl,
        // Permite arrastar sobre a forma de onda para avançar/voltar no áudio,
        // não só clicar em um ponto fixo.
        dragToSeek: true,
      });

      instance.setVolume(volume);
      instance.setPlaybackRate(playbackRate);
      waveSurferRef.current = instance;

      instance.on("ready", (totalDuration: number) => {
        setIsReady(true);
        setDuration(totalDuration);
      });
      instance.on("play", () => setIsPlaying(true));
      instance.on("pause", () => setIsPlaying(false));
      instance.on("finish", () => setIsPlaying(false));
      // O evento nativo "timeupdate" do <audio> só dispara ~4x/s — bom o
      // bastante para o contador de tempo e para "seguir" o texto, mas não
      // pra pausar exatamente no fim de uma palavra curta (o áudio já teria
      // avançado bem além dela até o próximo disparo). Por isso o limite de
      // playRange é vigiado por requestAnimationFrame (watchBoundary) e não
      // aqui.
      instance.on("timeupdate", (time: number) => {
        setCurrentTime(time);
        onTimeUpdateRef.current?.(time * 1000);
      });
    });

    return () => {
      destroyed = true;
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      instance?.destroy();
      waveSurferRef.current = null;
      setIsReady(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    };
    // volume é lido só na criação da instância (acima) — não deve recriar o
    // WaveSurfer a cada mudança no slider, só handleVolumeChange cuida disso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  /** Observa currentTime a cada frame enquanto houver um limite ativo (playRange), e
   * pausa exatamente ao alcançá-lo — bem mais preciso que esperar o "timeupdate" nativo. */
  function watchBoundary() {
    const instance = waveSurferRef.current;
    const boundary = endBoundaryRef.current;
    if (!instance || boundary === null) {
      rafIdRef.current = null;
      return;
    }
    if (instance.getCurrentTime() * 1000 >= boundary) {
      endBoundaryRef.current = null;
      rafIdRef.current = null;
      instance.pause();
      instance.setTime(boundary / 1000);
      return;
    }
    rafIdRef.current = requestAnimationFrame(watchBoundary);
  }

  function handleVolumeChange(next: number) {
    setVolume(next);
    waveSurferRef.current?.setVolume(next);
  }

  function toggleMute() {
    if (volume > 0) {
      setPreviousVolume(volume);
      handleVolumeChange(0);
    } else {
      handleVolumeChange(previousVolume > 0 ? previousVolume : 1);
    }
  }

  function handlePlaybackRateChange(next: number) {
    setPlaybackRate(next);
    waveSurferRef.current?.setPlaybackRate(next);
  }

  function startPlayRange(startMs: number, endMs: number) {
    const instance = waveSurferRef.current;
    if (!instance || !isReady) return;
    const duration = instance.getDuration();
    if (duration <= 0) return;
    endBoundaryRef.current = endMs;
    instance.seekTo(startMs / 1000 / duration);
    instance.play();
    if (rafIdRef.current === null) rafIdRef.current = requestAnimationFrame(watchBoundary);
  }

  /** Botão Tocar/Pausar e atalho de espaço: enquanto houver um trecho selecionado
   * no texto (activeSelection), tocar sempre reinicia e se limita a esse trecho —
   * em vez de continuar de onde o cursor do áudio estiver. */
  function handlePlayButtonClick() {
    if (isPlaying) {
      waveSurferRef.current?.pause();
      return;
    }
    if (activeSelection) {
      startPlayRange(activeSelection.startMs, activeSelection.endMs);
    } else {
      waveSurferRef.current?.play();
    }
  }

  useImperativeHandle(ref, () => ({
    playRange(startMs: number, endMs: number) {
      startPlayRange(startMs, endMs);
    },
    playFrom(startMs: number) {
      const instance = waveSurferRef.current;
      if (!instance || !isReady) return;
      const duration = instance.getDuration();
      if (duration <= 0) return;
      endBoundaryRef.current = null;
      instance.seekTo(startMs / 1000 / duration);
      instance.play();
    },
    seekTo(startMs: number) {
      const instance = waveSurferRef.current;
      if (!instance || !isReady) return;
      const duration = instance.getDuration();
      if (duration <= 0) return;
      endBoundaryRef.current = null;
      instance.seekTo(startMs / 1000 / duration);
    },
    togglePlayPause() {
      handlePlayButtonClick();
    },
    skip(deltaSeconds: number) {
      const instance = waveSurferRef.current;
      if (!instance || !isReady) return;
      const total = instance.getDuration();
      if (total <= 0) return;
      endBoundaryRef.current = null;
      const next = Math.min(Math.max(instance.getCurrentTime() + deltaSeconds, 0), total);
      instance.seekTo(next / total);
    },
  }));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {loadError ? (
        <p className="text-sm text-red-700">{loadError}</p>
      ) : (
        <>
          <div ref={containerRef} aria-label="Forma de onda do áudio — clique ou arraste para avançar/voltar" />
          {!isReady && <p className="mt-2 text-xs text-slate-400">Carregando áudio...</p>}
          {isReady && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handlePlayButtonClick}
                title={activeSelection && !isPlaying ? "Toca só o trecho selecionado no texto" : undefined}
                className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                {isPlaying ? "Pausar" : activeSelection ? "Tocar trecho" : "Tocar"}{" "}
                <span className="ml-1 text-xs text-slate-400">(espaço)</span>
              </button>

              <span className="text-xs tabular-nums text-slate-500">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  title={volume > 0 ? "Mudo" : "Ativar som"}
                  aria-label={volume > 0 ? "Mudo" : "Ativar som"}
                  className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  {volume === 0 ? (
                    <VolumeX size={18} />
                  ) : volume < 0.5 ? (
                    <Volume1 size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-24 accent-blue-600"
                />
              </div>

              <PlaybackRateMenu rates={PLAYBACK_RATES} value={playbackRate} onChange={handlePlaybackRateChange} />
            </div>
          )}
        </>
      )}
    </div>
  );
});

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export default AudioPlayer;
