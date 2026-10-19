from app.services.transcript import realign_word_timings


def _items(words: list[tuple[str, int, int]]) -> list[dict]:
    return [{"text": t, "start_ms": s, "end_ms": e} for t, s, e in words]


def test_unchanged_text_keeps_original_timestamps():
    baseline = _items([("Hello", 0, 500), ("world", 500, 1000), ("today", 1000, 1500)])

    result = realign_word_timings(baseline, "Hello world today")

    assert result == [
        {"text": "Hello", "start_ms": 0, "end_ms": 500},
        {"text": "world", "start_ms": 500, "end_ms": 1000},
        {"text": "today", "start_ms": 1000, "end_ms": 1500},
    ]


def test_single_word_typo_fix_keeps_neighbors_timestamps():
    baseline = _items([("Hello", 0, 500), ("wrold", 500, 1000), ("today", 1000, 1500)])

    result = realign_word_timings(baseline, "Hello world today")

    assert result[0] == {"text": "Hello", "start_ms": 0, "end_ms": 500}
    assert result[2] == {"text": "today", "start_ms": 1000, "end_ms": 1500}
    # a palavra corrigida não tem timestamp real — fica interpolada entre as vizinhas.
    assert result[1]["text"] == "world"
    assert 500 <= result[1]["start_ms"] <= result[1]["end_ms"] <= 1000


def test_inserted_words_are_interpolated_between_matched_neighbors():
    baseline = _items([("Hello", 0, 500), ("today", 1000, 1500)])

    result = realign_word_timings(baseline, "Hello my dear friend today")

    assert result[0] == {"text": "Hello", "start_ms": 0, "end_ms": 500}
    assert result[-1] == {"text": "today", "start_ms": 1000, "end_ms": 1500}
    inserted = result[1:-1]
    assert [w["text"] for w in inserted] == ["my", "dear", "friend"]
    # os 3 inseridos dividem igualmente o intervalo [500, 1000] entre as vizinhas casadas.
    for w in inserted:
        assert 500 <= w["start_ms"] <= w["end_ms"] <= 1000
    # e não se sobrepõem entre si.
    for a, b in zip(inserted, inserted[1:]):
        assert a["end_ms"] <= b["start_ms"]


def test_completely_different_text_does_not_crash_and_covers_all_words():
    baseline = _items([("one", 0, 100), ("two", 100, 200)])

    result = realign_word_timings(baseline, "completely unrelated sentence here")

    assert [w["text"] for w in result] == ["completely", "unrelated", "sentence", "here"]
    for w in result:
        assert isinstance(w["start_ms"], int)
        assert isinstance(w["end_ms"], int)


def test_no_baseline_returns_zeroed_timestamps_without_crashing():
    result = realign_word_timings([], "texto qualquer aqui")

    assert result == [
        {"text": "texto", "start_ms": 0, "end_ms": 0},
        {"text": "qualquer", "start_ms": 0, "end_ms": 0},
        {"text": "aqui", "start_ms": 0, "end_ms": 0},
    ]


def test_empty_edited_text_returns_empty_list():
    baseline = _items([("one", 0, 100)])

    assert realign_word_timings(baseline, "   ") == []
