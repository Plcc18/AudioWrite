"""Optional speaker diarization step (pyannote.audio), run on the same
16kHz mono WAV already produced for Whisper (see worker/main.py).

Best-effort by design: the caller (worker/main.py) wraps `diarize()` in a
try/except and treats any failure (missing/invalid HF_TOKEN, gated model
terms not accepted yet, pyannote/torch not installed, no internet on first
download, ...) as "no speaker labels for this project" — it must never fail
the transcription pipeline, which works fine without it.
"""
import contextlib
import logging
from dataclasses import dataclass

from worker.config import WorkerSettings

logger = logging.getLogger("worker.diarize")

DIARIZATION_MODEL = "pyannote/speaker-diarization-3.1"

# Cada pipeline carregado é reaproveitado entre jobs (carregar de novo a cada
# áudio custaria vários segundos) — mesma ideia do _model_cache em transcribe.py.
_pipeline_cache: dict[str, object] = {}


@dataclass
class Turn:
    start_ms: int
    end_ms: int
    speaker: str


@contextlib.contextmanager
def _legacy_torch_load():
    """PyTorch 2.6 flipped torch.load's default from weights_only=False to
    True (a security hardening against malicious checkpoints). pyannote.audio
    3.3.2 predates that change and loads its checkpoint (via
    pytorch_lightning) without passing weights_only itself, so it now fails
    with "Weights only load failed... Unsupported global: ...TorchVersion".

    Scoped to just the Pipeline.from_pretrained() call below: the checkpoint
    comes from the official 'pyannote' org on Hugging Face, behind the gated
    terms-of-use the user already accepted — a trusted source, unlike an
    arbitrary user-supplied file — so forcing the legacy behavior only for
    this one load is a reasonable trade-off.
    """
    import torch

    original_load = torch.load

    def _patched_load(*args, **kwargs):
        kwargs["weights_only"] = False
        return original_load(*args, **kwargs)

    torch.load = _patched_load
    try:
        yield
    finally:
        torch.load = original_load


def _get_pipeline(settings: WorkerSettings):
    device = settings.diarization_device
    if device not in _pipeline_cache:
        if not settings.hf_token:
            raise RuntimeError(
                "HF_TOKEN não configurado — sem ele o download do modelo gated "
                f"'{DIARIZATION_MODEL}' falha. Ver backend/README.md, seção "
                "'Identificação de falantes'."
            )

        # Import tardio: pyannote.audio/torch são dependências pesadas e
        # opcionais — não devem impedir o worker de rodar (transcrição pura)
        # numa máquina onde elas não foram instaladas.
        import torch
        from pyannote.audio import Pipeline

        logger.info("Loading diarization pipeline '%s' (device=%s)", DIARIZATION_MODEL, device)
        # pyannote.audio 3.3.2 encaminha este use_auth_token para
        # huggingface_hub.hf_hub_download(...), que removeu esse parâmetro em
        # versões recentes (TypeError: "unexpected keyword argument
        # 'use_auth_token'") — pyannote.audio não fixa um teto
        # ("huggingface_hub>=0.13.0"), então pip instalava por padrão uma
        # versão nova demais. Fixamos huggingface_hub==0.36.2 (última 0.x, que
        # ainda aceita esse kwarg) em worker/requirements.txt — ver comentário lá.
        with _legacy_torch_load():
            pipeline = Pipeline.from_pretrained(DIARIZATION_MODEL, use_auth_token=settings.hf_token)
        if pipeline is None:
            raise RuntimeError(
                f"Failed to load '{DIARIZATION_MODEL}' — confirm HF_TOKEN is valid and that you've accepted "
                "the model's terms of use on huggingface.co (both 'pyannote/segmentation-3.0' and "
                "'pyannote/speaker-diarization-3.1')."
            )
        pipeline.to(torch.device(device))
        _pipeline_cache[device] = pipeline
    return _pipeline_cache[device]


def diarize(wav_path: str, settings: WorkerSettings) -> list[Turn]:
    """Runs speaker diarization over `wav_path` and returns turns with
    speaker labels remapped to stable, human-friendly "Falante N" identifiers,
    numbered by order of first appearance in the audio (pyannote's own labels,
    like "SPEAKER_00", aren't guaranteed to be numbered in that order).
    """
    pipeline = _get_pipeline(settings)
    diarization = pipeline(wav_path)

    raw_turns = sorted(
        ((turn.start, turn.end, label) for turn, _, label in diarization.itertracks(yield_label=True)),
        key=lambda t: t[0],
    )

    label_order: dict[str, int] = {}
    for _, _, label in raw_turns:
        if label not in label_order:
            label_order[label] = len(label_order) + 1

    return [
        Turn(start_ms=round(start * 1000), end_ms=round(end * 1000), speaker=f"Falante {label_order[label]}")
        for start, end, label in raw_turns
    ]
