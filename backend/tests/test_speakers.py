from app.services.speakers import build_speaker_segments


def _words(items: list[tuple[str, int, int]]) -> list[dict]:
    return [{"text": t, "start_ms": s, "end_ms": e} for t, s, e in items]


def _turns(items: list[tuple[int, int, str]]) -> list[dict]:
    return [{"start_ms": s, "end_ms": e, "speaker": sp} for s, e, sp in items]


def test_no_turns_returns_empty_list():
    words = _words([("Hello", 0, 500)])
    assert build_speaker_segments(words, []) == []


def test_no_words_returns_empty_list():
    turns = _turns([(0, 500, "Falante 1")])
    assert build_speaker_segments([], turns) == []


def test_single_speaker_groups_all_words_into_one_segment():
    words = _words([("Hello", 0, 500), ("world", 500, 1000), ("today", 1000, 1500)])
    turns = _turns([(0, 1500, "Falante 1")])

    result = build_speaker_segments(words, turns)

    assert result == [{"start_ms": 0, "end_ms": 1500, "speaker": "Falante 1", "text": "Hello world today"}]


def test_speaker_change_splits_into_separate_segments():
    words = _words([("Oi", 0, 300), ("pessoal", 300, 800), ("Claro", 1000, 1300), ("podemos", 1300, 1800)])
    turns = _turns([(0, 900, "Falante 1"), (900, 2000, "Falante 2")])

    result = build_speaker_segments(words, turns)

    assert result == [
        {"start_ms": 0, "end_ms": 800, "speaker": "Falante 1", "text": "Oi pessoal"},
        {"start_ms": 1000, "end_ms": 1800, "speaker": "Falante 2", "text": "Claro podemos"},
    ]


def test_words_with_no_overlapping_turn_get_unknown_speaker():
    words = _words([("Oi", 0, 300), ("silencio", 5000, 5300)])
    turns = _turns([(0, 400, "Falante 1")])

    result = build_speaker_segments(words, turns)

    assert result == [
        {"start_ms": 0, "end_ms": 300, "speaker": "Falante 1", "text": "Oi"},
        {"start_ms": 5000, "end_ms": 5300, "speaker": None, "text": "silencio"},
    ]


def test_word_picks_turn_with_most_overlap():
    # palavra cruza a fronteira entre dois turnos; a maior parte dela (0.6s de
    # 0.8s) está no segundo turno, então ela deve ser atribuída a ele.
    words = _words([("palavra", 700, 1500)])
    turns = _turns([(0, 900, "Falante 1"), (900, 2000, "Falante 2")])

    result = build_speaker_segments(words, turns)

    assert result == [{"start_ms": 700, "end_ms": 1500, "speaker": "Falante 2", "text": "palavra"}]
