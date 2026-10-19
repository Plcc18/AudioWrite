from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel


class ProjectStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    needs_review = "needs_review"
    done = "done"
    failed = "failed"


class ProjectOut(BaseModel):
    id: str
    filename: str
    status: ProjectStatus
    final_text: str | None
    manual_override: bool
    # Preenchido pelo worker ao concluir a transcrição — null até lá, e em
    # projetos antigos que nunca foram reprocessados depois dessa mudança.
    duration_ms: int | None
    error: str | None
    created_at: datetime


class AlternativeOut(BaseModel):
    model: str
    params: dict = {}
    text: str


class DoubtfulSegmentOut(BaseModel):
    id: str
    start_ms: int
    end_ms: int
    reference_text: str
    alternatives: list[AlternativeOut]
    score: float
    status: Literal["pending", "resolved"]
    resolved_text: str | None


class WordTimingOut(BaseModel):
    text: str
    start_ms: int
    end_ms: int


class SpeakerSegmentOut(BaseModel):
    start_ms: int
    end_ms: int
    # None para trechos que não bateram com nenhum turno de diarização
    # detectado (nunca atribuído arbitrariamente — ver app/services/speakers.py).
    speaker: str | None
    text: str


class ProjectDetailOut(ProjectOut):
    doubtful_segments: list[DoubtfulSegmentOut]
    # Vazio quando ainda não há transcrição pronta, ou depois de uma edição
    # livre (manual_override) — a partir daí os tempos originais não
    # correspondem mais ao texto exibido, então o frontend não tenta
    # acompanhar a reprodução palavra a palavra.
    word_timings: list[WordTimingOut]
    # Vazio se a diarização estiver desabilitada ou tiver falhado para este
    # projeto (ver DIARIZATION_ENABLED) — nesse caso o frontend simplesmente
    # não mostra rótulos de falante.
    speaker_segments: list[SpeakerSegmentOut]


class AudioUrlOut(BaseModel):
    url: str
    expires_in: int


class ResolveSegmentIn(BaseModel):
    """Either pick one of the alternatives already found, or supply a free-text correction."""

    action: Literal["accept_alternative", "custom_text"]
    alternative_index: int | None = None
    text: str | None = None


class UpdateFinalTextIn(BaseModel):
    """Free-form rewrite of the whole final transcript, only allowed once the project is done."""

    text: str


class UpdateProjectIn(BaseModel):
    """Renames the project (just the display label — doesn't touch the stored audio file)."""

    filename: str
