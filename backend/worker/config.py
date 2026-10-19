"""Standalone env-based config for the worker.

Deliberately not sharing code with `app.core.config`: the worker is meant to be
installable and runnable on a completely different machine (the user's laptop,
a Colab notebook, ...) without the FastAPI app or its dependencies.
"""
import json
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()

_DEFAULT_WHISPER_RUNS = (
    '[{"model":"small","beam_size":5,"temperature":0.0},'
    '{"model":"small","beam_size":1,"temperature":0.4}]'
)


@dataclass
class WorkerSettings:
    supabase_url: str
    supabase_service_role_key: str
    database_url: str
    supabase_storage_bucket: str = "audio"
    whisper_runs: list[dict] = field(default_factory=list)
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    # Vazio = auto-detecção do faster-whisper (comportamento original). Fixar
    # (ex. "pt") evita que runs diferentes do mesmo áudio detectem idiomas
    # diferentes entre si, o que quebraria sutilmente o alinhamento do consenso.
    whisper_language: str = ""
    poll_interval_seconds: float = 5.0
    agreement_threshold: float = 1.0
    confidence_threshold: float = 0.6
    # Diarização de falantes (pyannote.audio, ver worker/diarize.py) é
    # opcional e best-effort: qualquer falha (sem HF_TOKEN, termos do modelo
    # não aceitos, pyannote/torch não instalado, ...) só deixa o projeto sem
    # rótulos de falante — nunca derruba o job de transcrição.
    diarization_enabled: bool = True
    hf_token: str = ""
    diarization_device: str = "cpu"


def get_settings() -> WorkerSettings:
    whisper_device = os.environ.get("WHISPER_DEVICE", "cpu")
    return WorkerSettings(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        database_url=os.environ["DATABASE_URL"],
        supabase_storage_bucket=os.environ.get("SUPABASE_STORAGE_BUCKET", "audio"),
        whisper_runs=json.loads(os.environ.get("WHISPER_RUNS", _DEFAULT_WHISPER_RUNS)),
        whisper_device=whisper_device,
        whisper_compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
        whisper_language=os.environ.get("WHISPER_LANGUAGE", ""),
        poll_interval_seconds=float(os.environ.get("WORKER_POLL_INTERVAL_SECONDS", "5")),
        agreement_threshold=float(os.environ.get("AGREEMENT_THRESHOLD", "1.0")),
        confidence_threshold=float(os.environ.get("CONFIDENCE_THRESHOLD", "0.6")),
        diarization_enabled=os.environ.get("DIARIZATION_ENABLED", "true").strip().lower() not in ("false", "0"),
        hf_token=os.environ.get("HF_TOKEN", ""),
        diarization_device=os.environ.get("DIARIZATION_DEVICE", whisper_device),
    )
