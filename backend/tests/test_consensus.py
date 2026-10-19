from worker.consensus import Run, Word, build_consensus


def _run(model: str, words: list[tuple[str, float, float, float]]) -> Run:
    return Run(model=model, words=[Word(text=t, start=s, end=e, probability=p) for t, s, e, p in words])


def test_identical_runs_produce_no_doubtful_segments():
    words = [
        ("Hello", 0.0, 0.5, 0.95),
        ("world", 0.5, 1.0, 0.95),
        ("today", 1.0, 1.5, 0.95),
    ]
    run_a = _run("small", words)
    run_b = _run("small-alt", words)

    result = build_consensus([run_a, run_b])

    assert result.doubtful_segments == []
    assert result.final_text == "Hello world today"


def test_divergent_word_creates_doubtful_segment_with_both_alternatives():
    run_a = _run(
        "small",
        [("The", 0.0, 0.3, 0.95), ("cat", 0.3, 0.7, 0.95), ("sat", 0.7, 1.1, 0.95)],
    )
    run_b = _run(
        "small-alt",
        [("The", 0.0, 0.3, 0.95), ("cap", 0.3, 0.7, 0.9), ("sat", 0.7, 1.1, 0.95)],
    )

    result = build_consensus([run_a, run_b])

    assert len(result.doubtful_segments) == 1
    segment = result.doubtful_segments[0]
    assert segment.reference_text == "cat"
    assert segment.score == 0.5
    alt_texts = {a["model"]: a["text"] for a in segment.alternatives}
    assert alt_texts == {"small": "cat", "small-alt": "cap"}


def test_word_missing_in_shorter_run_is_flagged_doubtful():
    run_a = _run(
        "small",
        [("I", 0.0, 0.2, 0.9), ("really", 0.2, 0.6, 0.9), ("like", 0.6, 1.0, 0.9), ("it", 1.0, 1.2, 0.9)],
    )
    # run_b skips "really" entirely
    run_b = _run(
        "small-alt",
        [("I", 0.0, 0.2, 0.9), ("like", 0.6, 1.0, 0.9), ("it", 1.0, 1.2, 0.9)],
    )

    result = build_consensus([run_a, run_b])

    doubtful_texts = [s.reference_text for s in result.doubtful_segments]
    assert doubtful_texts == ["really"]
    assert result.doubtful_segments[0].score == 0.5
    # the missing run contributes no alternative text for that span
    assert result.doubtful_segments[0].alternatives == [{"model": "small", "params": {}, "text": "really"}]


def test_mismatched_timestamps_beyond_margin_counts_as_no_match():
    run_a = _run("small", [("yes", 0.0, 0.4, 0.9)])
    # same word, same text, but timestamp shifted way outside the matching margin
    run_b = _run("small-alt", [("yes", 50.0, 50.4, 0.9)])

    result = build_consensus([run_a, run_b], )

    assert len(result.doubtful_segments) == 1
    assert result.doubtful_segments[0].score == 0.5
    assert result.doubtful_segments[0].alternatives == [{"model": "small", "params": {}, "text": "yes"}]


def test_low_confidence_is_flagged_even_when_all_runs_agree():
    words = [("maybe", 0.0, 0.5, 0.4)]
    run_a = _run("small", words)
    run_b = _run("small-alt", words)

    result = build_consensus([run_a, run_b], confidence_threshold=0.6)

    assert len(result.doubtful_segments) == 1
    # Concordância (agreement) é 1.0 aqui — as duas execuções bateram no texto.
    # O score exibido precisa refletir o motivo real da dúvida (confiança
    # baixa do modelo, 0.4), senão a UI mostraria "100%" para um trecho ainda
    # pendente de revisão, o que é enganoso.
    assert result.doubtful_segments[0].score == 0.4


def test_consecutive_doubtful_words_are_grouped_into_one_segment():
    run_a = _run(
        "small",
        [("one", 0.0, 0.3, 0.9), ("two", 0.3, 0.6, 0.9), ("three", 0.6, 0.9, 0.9), ("four", 0.9, 1.2, 0.9)],
    )
    run_b = _run(
        "small-alt",
        [("one", 0.0, 0.3, 0.9), ("too", 0.3, 0.6, 0.9), ("tree", 0.6, 0.9, 0.9), ("four", 0.9, 1.2, 0.9)],
    )

    result = build_consensus([run_a, run_b])

    assert len(result.doubtful_segments) == 1
    segment = result.doubtful_segments[0]
    assert segment.reference_text == "two three"
    assert segment.start_ms == 300
    assert segment.end_ms == 900


def test_reference_run_is_the_one_with_highest_average_probability():
    low_conf = _run("small", [("hi", 0.0, 0.3, 0.3)])
    high_conf = _run("medium", [("hi", 0.0, 0.3, 0.95)])

    result = build_consensus([low_conf, high_conf])

    assert result.reference_model == "medium"


def test_same_model_name_with_different_params_keeps_both_alternatives():
    # Regression test: the default worker config runs "small" twice with
    # different beam_size/temperature. If alternatives were keyed by model
    # name alone, the second run's text would silently overwrite the first's.
    run_a = Run(
        model="small",
        label="small[beam_size=5,temperature=0.0]",
        params={"beam_size": 5, "temperature": 0.0},
        words=[Word(text="cat", start=0.0, end=0.4, probability=0.9)],
    )
    run_b = Run(
        model="small",
        label="small[beam_size=1,temperature=0.4]",
        params={"beam_size": 1, "temperature": 0.4},
        words=[Word(text="cap", start=0.0, end=0.4, probability=0.9)],
    )

    result = build_consensus([run_a, run_b])

    assert len(result.doubtful_segments) == 1
    alternatives = result.doubtful_segments[0].alternatives
    assert len(alternatives) == 2
    texts = {a["text"] for a in alternatives}
    assert texts == {"cat", "cap"}
    assert all(a["model"] == "small" for a in alternatives)
    params = {a["params"]["beam_size"] for a in alternatives}
    assert params == {5, 1}
