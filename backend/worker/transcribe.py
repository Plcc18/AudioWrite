"""Runs faster-whisper over a WAV file and returns both a worker.consensus.Run
(for alignment) and the raw JSON-serializable segments (for storage).
"""
import logging
from typing import Any

from faster_whisper import WhisperModel

from worker.consensus import Run, Word

logger = logging.getLogger("worker.transcribe")

_model_cache: dict[tuple[str, str, str], WhisperModel] = {}


def _get_model(model_name: str, device: str, compute_type: str) -> WhisperModel:
    key = (model_name, device, compute_type)
    if key not in _model_cache:
        logger.info("Loading Whisper model '%s' (device=%s, compute_type=%s)", model_name, device, compute_type)
        _model_cache[key] = WhisperModel(model_name, device=device, compute_type=compute_type)
    return _model_cache[key]


def transcribe(
    wav_path: str,
    model_name: str,
    beam_size: int = 5,
    temperature: float = 0.0,
    device: str = "cpu",
    compute_type: str = "int8",
    language: str = "",
) -> tuple[Run, list[dict[str, Any]], float]:
    model = _get_model(model_name, device, compute_type)

    logger.info("Transcribing %s with model=%s beam_size=%s temperature=%s", wav_path, model_name, beam_size, temperature)
    segments_iter, info = model.transcribe(
        wav_path,
        beam_size=beam_size,
        temperature=temperature,
        word_timestamps=True,
        language=language or None,
    )

    words: list[Word] = []
    raw_segments: list[dict[str, Any]] = []
    for segment in segments_iter:
        segment_words = [
            {
                "text": w.word,
                "start": w.start,
                "end": w.end,
                "probability": w.probability,
            }
            for w in (segment.words or [])
        ]
        raw_segments.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
                "words": segment_words,
            }
        )
        words.extend(Word(text=w["text"], start=w["start"], end=w["end"], probability=w["probability"]) for w in segment_words)

    logger.info("Transcription done: model=%s words=%d language=%s", model_name, len(words), info.language)
    params = {"beam_size": beam_size, "temperature": temperature}
    # Distinct label even when two runs share the same model name but different
    # params (e.g. the default config: "small" run twice) — see worker.consensus.Run.
    label = f"{model_name}[beam_size={beam_size},temperature={temperature}]"
    run = Run(model=model_name, words=words, params=params, label=label)
    return run, raw_segments, info.duration
