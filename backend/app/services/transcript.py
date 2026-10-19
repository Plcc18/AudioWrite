"""Builds the final transcript text from the reference run + resolved doubtful segments.

The reference run's words (with their timestamps) are the backbone of the final
text. Whenever a doubtful segment has been resolved by a human, the reference
words that fall inside that segment's time range are replaced by the resolved
text instead.
"""
import difflib
import re
from typing import Any

_PUNCTUATION_RE = re.compile(r"[^\w]", re.UNICODE)


def _normalize_token(token: str) -> str:
    return _PUNCTUATION_RE.sub("", token).lower()


def _flatten_words(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in segments:
        words.extend(segment.get("words", []))
    return sorted(words, key=lambda w: w["start"])


def merge_resolved(reference_segments: list[dict[str, Any]], resolved_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flattens the reference run's words and splices in resolved doubtful
    segments, collapsing each resolved span into a single {text, start, end}
    item (start/end in seconds). Used to build both the plain-text transcript
    and the SRT export, so corrections made during review show up in both.
    """
    words = _flatten_words(reference_segments)
    resolved_segments = sorted(resolved_segments, key=lambda s: s["start_ms"])

    items: list[dict[str, Any]] = []
    seg_idx = 0
    i = 0
    n = len(words)
    while i < n:
        word_start_ms = words[i]["start"] * 1000
        while seg_idx < len(resolved_segments) and resolved_segments[seg_idx]["end_ms"] <= word_start_ms:
            seg_idx += 1

        if seg_idx < len(resolved_segments) and resolved_segments[seg_idx]["start_ms"] <= word_start_ms:
            seg = resolved_segments[seg_idx]
            text = (seg.get("resolved_text") or "").strip()
            if text:
                items.append({"text": text, "start": seg["start_ms"] / 1000, "end": seg["end_ms"] / 1000})
            while i < n and words[i]["start"] * 1000 < seg["end_ms"]:
                i += 1
            continue

        text = words[i]["text"].strip()
        if text:
            items.append({"text": text, "start": words[i]["start"], "end": words[i]["end"]})
        i += 1

    return items


def build_final_text(reference_segments: list[dict[str, Any]], resolved_segments: list[dict[str, Any]]) -> str:
    items = merge_resolved(reference_segments, resolved_segments)
    return " ".join(item["text"] for item in items)


def word_timings(reference_segments: list[dict[str, Any]], resolved_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Same spans as build_final_text, but as {text, start_ms, end_ms} — lets the
    frontend highlight/follow the transcript in sync with audio playback.
    """
    items = merge_resolved(reference_segments, resolved_segments)
    return [
        {"text": item["text"], "start_ms": round(item["start"] * 1000), "end_ms": round(item["end"] * 1000)}
        for item in items
    ]


def realign_word_timings(baseline_items: list[dict[str, Any]], edited_text: str) -> list[dict[str, Any]]:
    """Best-effort re-timing of a freely-edited transcript (manual_override)
    against the last known-good word timings — the merge that would exist if
    the user hadn't rewritten the text (ver word_timings/merge_resolved).

    Words that still match (diffed by normalized text, in order) keep their
    original timestamp. Words that were added/changed by the manual edit have
    no real timestamp to recover, so each run of unmatched words has the gap
    between its matched neighbors split evenly across them — not exact, but
    good enough for "follow along"/search/select-to-play to keep working
    instead of going dark after a manual edit.
    """
    new_tokens = edited_text.split()
    n = len(new_tokens)
    if n == 0:
        return []

    if not baseline_items:
        return [{"text": t, "start_ms": 0, "end_ms": 0} for t in new_tokens]

    baseline_norm = [_normalize_token(item["text"]) for item in baseline_items]
    new_norm = [_normalize_token(t) for t in new_tokens]

    matcher = difflib.SequenceMatcher(None, baseline_norm, new_norm, autojunk=False)
    start_ms: list[int | None] = [None] * n
    end_ms: list[int | None] = [None] * n

    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            start_ms[block.b + k] = baseline_items[block.a + k]["start_ms"]
            end_ms[block.b + k] = baseline_items[block.a + k]["end_ms"]

    i = 0
    while i < n:
        if start_ms[i] is not None:
            i += 1
            continue
        j = i
        while j < n and start_ms[j] is None:
            j += 1

        prev_ms = end_ms[i - 1] if i > 0 else 0
        next_ms = start_ms[j] if j < n else prev_ms
        if next_ms < prev_ms:
            next_ms = prev_ms

        count = j - i
        step = (next_ms - prev_ms) / count
        for k in range(count):
            start_ms[i + k] = round(prev_ms + step * k)
            end_ms[i + k] = round(prev_ms + step * (k + 1))
        i = j

    return [{"text": new_tokens[k], "start_ms": start_ms[k], "end_ms": end_ms[k]} for k in range(n)]


def rebuild_final_text(conn, project_id: str) -> str:
    from app.core.db import execute, fetch_all, fetch_one

    reference_run = fetch_one(
        conn,
        "SELECT segments FROM transcription_runs WHERE project_id = %s AND is_reference = true LIMIT 1",
        (project_id,),
    )
    if reference_run is None:
        return ""

    resolved = fetch_all(
        conn,
        "SELECT start_ms, end_ms, resolved_text FROM doubtful_segments WHERE project_id = %s AND status = 'resolved'",
        (project_id,),
    )
    final_text = build_final_text(reference_run["segments"], resolved)
    execute(conn, "UPDATE projects SET final_text = %s WHERE id = %s", (final_text, project_id))
    return final_text


def maybe_complete_project(conn, project_id: str) -> None:
    from app.core.db import execute, fetch_one

    pending = fetch_one(
        conn,
        "SELECT id FROM doubtful_segments WHERE project_id = %s AND status = 'pending' LIMIT 1",
        (project_id,),
    )
    if pending is None:
        execute(conn, "UPDATE projects SET status = 'done' WHERE id = %s", (project_id,))
