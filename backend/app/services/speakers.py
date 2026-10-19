"""Groups word-level transcript items into speaker-labeled segments, using
the raw diarization turns the worker persisted in `speaker_turns`
(worker/diarize.py). Pure/testable: no DB access.

Mirrors the layering already used for corrections (app/services/transcript.py):
the worker only stores raw model output; the API combines it with the
already-computed word timings on every request.
"""
from typing import Any


def _overlap_ms(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def _best_speaker(word_start_ms: int, word_end_ms: int, turns: list[dict[str, Any]]) -> str | None:
    best_speaker: str | None = None
    best_overlap = 0
    for turn in turns:
        overlap = _overlap_ms(word_start_ms, word_end_ms, turn["start_ms"], turn["end_ms"])
        if overlap > best_overlap:
            best_overlap = overlap
            best_speaker = turn["speaker"]
    return best_speaker


def build_speaker_segments(word_items: list[dict[str, Any]], turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """word_items: [{text, start_ms, end_ms}, ...] — the same list already
    computed for word_timings (see app/services/transcript.py), in order.
    turns: raw diarization turns [{start_ms, end_ms, speaker}, ...], any order.

    Returns consecutive-same-speaker groups: [{start_ms, end_ms, speaker, text}].
    `speaker` is None for stretches that don't overlap any detected turn —
    never guessed/assigned arbitrarily (ver tarefa: falante desconhecido em
    vez de atribuição arbitrária).
    """
    if not turns or not word_items:
        return []

    segments: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for word in word_items:
        speaker = _best_speaker(word["start_ms"], word["end_ms"], turns)
        if current is not None and current["speaker"] == speaker:
            current["end_ms"] = word["end_ms"]
            current["text"] += " " + word["text"]
        else:
            if current is not None:
                segments.append(current)
            current = {"start_ms": word["start_ms"], "end_ms": word["end_ms"], "speaker": speaker, "text": word["text"]}

    if current is not None:
        segments.append(current)

    return segments
