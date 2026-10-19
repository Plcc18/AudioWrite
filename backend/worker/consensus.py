"""Aligns multiple Whisper transcription runs of the same audio by word timing,
and flags words/spans where the runs disagree or report low confidence.

Pure Python, no dependency on faster-whisper, so it can be unit tested without
downloading any model.
"""
import re
from dataclasses import dataclass, field

DEFAULT_AGREEMENT_THRESHOLD = 1.0
DEFAULT_CONFIDENCE_THRESHOLD = 0.6
DEFAULT_MIN_OVERLAP_RATIO = 0.3
DEFAULT_MATCH_MARGIN_SECONDS = 2.0

_PUNCTUATION_RE = re.compile(r"[^\w\s]", re.UNICODE)


def normalize(text: str) -> str:
    return _PUNCTUATION_RE.sub("", text).strip().lower()


@dataclass
class Word:
    text: str
    start: float
    end: float
    probability: float = 1.0


@dataclass
class Run:
    model: str
    words: list[Word]
    params: dict = field(default_factory=dict)
    # Unique identifier for this run, used internally to key alignment data.
    # Defaults to `model`, but callers running the same model with different
    # params (e.g. two "small" runs with different beam_size) MUST pass a
    # distinct label, or their alternatives would collide and overwrite
    # each other.
    label: str = ""

    def __post_init__(self) -> None:
        if not self.label:
            self.label = self.model

    @property
    def avg_probability(self) -> float:
        if not self.words:
            return 0.0
        return sum(w.probability for w in self.words) / len(self.words)


@dataclass
class ConsensusWord:
    text: str
    start: float
    end: float
    score: float
    confidence: float


@dataclass
class DoubtfulSegment:
    start_ms: int
    end_ms: int
    reference_text: str
    alternatives: list[dict]
    score: float


@dataclass
class ConsensusResult:
    reference_model: str
    reference_index: int
    words: list[ConsensusWord]
    doubtful_segments: list[DoubtfulSegment]
    final_text: str


def _overlap_seconds(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def _find_match(
    ref_word: Word,
    run_words: list[Word],
    pointer: int,
    margin: float = DEFAULT_MATCH_MARGIN_SECONDS,
) -> tuple[int | None, float, int]:
    """Finds the run word with maximum time overlap with `ref_word`, searching
    from `pointer` onward within a time margin. Returns (index, overlap_seconds,
    new_pointer) where new_pointer is where the next search should resume from.
    """
    n = len(run_words)
    idx = pointer
    while idx < n and run_words[idx].end < ref_word.start - margin:
        idx += 1

    best_idx: int | None = None
    best_overlap = 0.0
    scan_idx = idx
    while scan_idx < n and run_words[scan_idx].start < ref_word.end + margin:
        overlap = _overlap_seconds(ref_word.start, ref_word.end, run_words[scan_idx].start, run_words[scan_idx].end)
        if overlap > best_overlap:
            best_overlap = overlap
            best_idx = scan_idx
        scan_idx += 1

    return best_idx, best_overlap, idx


def build_consensus(
    runs: list[Run],
    agreement_threshold: float = DEFAULT_AGREEMENT_THRESHOLD,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    min_overlap_ratio: float = DEFAULT_MIN_OVERLAP_RATIO,
) -> ConsensusResult:
    """Picks the run with the highest average word probability as reference,
    aligns every other run's words to it by time overlap, scores each reference
    word by how many runs agree on its text, and groups consecutive low-score /
    low-confidence words into doubtful segments.
    """
    if not runs:
        raise ValueError("At least one run is required")

    reference = max(runs, key=lambda r: r.avg_probability)
    reference_index = next(i for i, r in enumerate(runs) if r is reference)
    other_runs = [r for r in runs if r is not reference]
    total_runs = len(runs)

    pointers = {id(run): 0 for run in other_runs}
    consensus_words: list[ConsensusWord] = []
    match_texts: list[dict[str, str | None]] = []

    for ref_word in reference.words:
        ref_norm = normalize(ref_word.text)
        agree_count = 1
        confidences = [ref_word.probability]
        row: dict[str, str | None] = {reference.label: ref_word.text}

        for run in other_runs:
            pointer = pointers[id(run)]
            idx, overlap, new_pointer = _find_match(ref_word, run.words, pointer)
            pointers[id(run)] = new_pointer

            duration = max(ref_word.end - ref_word.start, 1e-6)
            if idx is None or (overlap / duration) < min_overlap_ratio:
                row[run.label] = None
                continue

            candidate = run.words[idx]
            row[run.label] = candidate.text
            confidences.append(candidate.probability)
            if normalize(candidate.text) == ref_norm:
                agree_count += 1

        score = agree_count / total_runs
        confidence = sum(confidences) / len(confidences)
        consensus_words.append(
            ConsensusWord(text=ref_word.text, start=ref_word.start, end=ref_word.end, score=score, confidence=confidence)
        )
        match_texts.append(row)

    label_to_run = {run.label: run for run in runs}
    doubtful_segments = _build_doubtful_segments(
        consensus_words, match_texts, agreement_threshold, confidence_threshold, label_to_run
    )
    final_text = " ".join(w.text.strip() for w in consensus_words if w.text.strip())

    return ConsensusResult(
        reference_model=reference.model,
        reference_index=reference_index,
        words=consensus_words,
        doubtful_segments=doubtful_segments,
        final_text=final_text,
    )


def _build_doubtful_segments(
    consensus_words: list[ConsensusWord],
    match_texts: list[dict[str, str | None]],
    agreement_threshold: float,
    confidence_threshold: float,
    label_to_run: dict[str, Run],
) -> list[DoubtfulSegment]:
    segments: list[DoubtfulSegment] = []
    group: list[int] = []

    def flush() -> None:
        if not group:
            return
        start_ms = round(consensus_words[group[0]].start * 1000)
        end_ms = round(consensus_words[group[-1]].end * 1000)
        reference_text = " ".join(consensus_words[i].text.strip() for i in group).strip()

        alternatives = []
        for label in match_texts[group[0]].keys():
            texts = [match_texts[i][label].strip() for i in group if match_texts[i].get(label)]
            if texts:
                run = label_to_run[label]
                alternatives.append({"model": run.model, "params": run.params, "text": " ".join(texts)})

        # min(agreement, confidence) por palavra: um trecho é marcado como
        # duvidoso se as execuções divergem OU se a confiança do modelo é
        # baixa (ver is_doubtful abaixo). Usar só a concordância aqui faria
        # o score exibido mostrar 100% mesmo quando o motivo real foi baixa
        # confiança — min() garante que o número mostrado reflita o motivo.
        # float(...) é necessário porque Word.probability vem do faster-whisper
        # como numpy.float64 — sem isso, o score vaza como numpy.float64 pro
        # INSERT do psycopg2, que no NumPy 2.x usa repr() (vira o texto literal
        # "np.float64(0.61...)" dentro do SQL e quebra a query).
        score = float(sum(min(consensus_words[i].score, consensus_words[i].confidence) for i in group) / len(group))
        segments.append(
            DoubtfulSegment(
                start_ms=start_ms,
                end_ms=end_ms,
                reference_text=reference_text,
                alternatives=alternatives,
                score=score,
            )
        )

    for i, word in enumerate(consensus_words):
        is_doubtful = word.score < agreement_threshold or word.confidence < confidence_threshold
        if is_doubtful:
            group.append(i)
        else:
            flush()
            group = []
    flush()

    return segments
