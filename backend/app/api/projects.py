import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response

from app.core.auth import get_current_user_id
from app.core.config import Settings, get_settings
from app.core.db import execute, fetch_all, fetch_one, get_connection
from app.models.schemas import (
    AudioUrlOut,
    DoubtfulSegmentOut,
    ProjectDetailOut,
    ProjectOut,
    ResolveSegmentIn,
    SpeakerSegmentOut,
    UpdateFinalTextIn,
    UpdateProjectIn,
    WordTimingOut,
)
from app.services import export as export_service
from app.services import storage
from app.services.speakers import build_speaker_segments
from app.services.transcript import (
    maybe_complete_project,
    realign_word_timings,
    rebuild_final_text,
    word_timings as compute_word_timings,
)

logger = logging.getLogger("app.api.projects")

router = APIRouter(prefix="/projects", tags=["projects"])


def _get_owned_project(conn, project_id: str, user_id: str) -> dict[str, Any]:
    project = fetch_one(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))
    if project is None or project["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _segments_out(conn, project_id: str) -> list[DoubtfulSegmentOut]:
    rows = fetch_all(
        conn,
        "SELECT * FROM doubtful_segments WHERE project_id = %s ORDER BY start_ms",
        (project_id,),
    )
    return [
        DoubtfulSegmentOut(
            id=row["id"],
            start_ms=row["start_ms"],
            end_ms=row["end_ms"],
            reference_text=row["reference_text"],
            alternatives=row["alternatives"],
            score=row["score"],
            status=row["status"],
            resolved_text=row["resolved_text"],
        )
        for row in rows
    ]


def _word_timings_out(conn, project: dict[str, Any]) -> list[WordTimingOut]:
    if project["status"] not in ("needs_review", "done"):
        return []

    reference_run = fetch_one(
        conn,
        "SELECT segments FROM transcription_runs WHERE project_id = %s AND is_reference = true LIMIT 1",
        (project["id"],),
    )
    if reference_run is None:
        return []

    resolved = fetch_all(
        conn,
        "SELECT start_ms, end_ms, resolved_text FROM doubtful_segments WHERE project_id = %s AND status = 'resolved'",
        (project["id"],),
    )

    if not project["manual_override"]:
        return [WordTimingOut(**w) for w in compute_word_timings(reference_run["segments"], resolved)]

    # Depois de uma edição livre, os tempos originais não correspondem mais ao
    # texto exibido — realinhamos por diff de palavras contra o que o texto
    # seria sem a edição manual (ver realign_word_timings), em vez de
    # simplesmente desistir e desligar busca/seleção/acompanhamento.
    baseline = compute_word_timings(reference_run["segments"], resolved)
    edited_text = project.get("final_text") or ""
    return [WordTimingOut(**w) for w in realign_word_timings(baseline, edited_text)]


def _speaker_segments_out(conn, project_id: str, timings: list[WordTimingOut]) -> list[SpeakerSegmentOut]:
    if not timings:
        return []
    turns = fetch_all(
        conn,
        "SELECT start_ms, end_ms, speaker FROM speaker_turns WHERE project_id = %s ORDER BY start_ms",
        (project_id,),
    )
    word_items = [w.model_dump() for w in timings]
    return [SpeakerSegmentOut(**seg) for seg in build_speaker_segments(word_items, turns)]


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    file: UploadFile,
    user_id: str = Depends(get_current_user_id),
    settings: Settings = Depends(get_settings),
) -> ProjectOut:
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in settings.allowed_extensions_set:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio type '.{ext}'. Allowed: {sorted(settings.allowed_extensions_set)}",
        )

    content = await file.read()
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=400, detail=f"File too large. Max is {settings.max_upload_mb} MB")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    project_id = str(uuid.uuid4())
    audio_path = f"{user_id}/{project_id}.{ext}"

    logger.info("Uploading audio for new project %s (%d bytes)", project_id, len(content))
    storage.upload_audio(audio_path, content, file.content_type or "application/octet-stream")

    with get_connection() as conn:
        execute(
            conn,
            """
            INSERT INTO projects (id, user_id, filename, audio_path, status)
            VALUES (%s, %s, %s, %s, 'queued')
            """,
            (project_id, user_id, file.filename, audio_path),
        )
        execute(
            conn,
            "INSERT INTO jobs (project_id, type, status) VALUES (%s, 'transcribe', 'queued')",
            (project_id,),
        )
        project = fetch_one(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))

    logger.info("Project %s queued for transcription", project_id)
    return ProjectOut(**project)


@router.get("", response_model=list[ProjectOut])
def list_projects(user_id: str = Depends(get_current_user_id)) -> list[ProjectOut]:
    with get_connection() as conn:
        rows = fetch_all(
            conn,
            "SELECT * FROM projects WHERE user_id = %s ORDER BY created_at DESC",
            (user_id,),
        )
    return [ProjectOut(**row) for row in rows]


@router.get("/{project_id}", response_model=ProjectDetailOut)
def get_project(project_id: str, user_id: str = Depends(get_current_user_id)) -> ProjectDetailOut:
    with get_connection() as conn:
        project = _get_owned_project(conn, project_id, user_id)
        segments = _segments_out(conn, project_id)
        timings = _word_timings_out(conn, project)
        speakers = _speaker_segments_out(conn, project_id, timings)
    return ProjectDetailOut(**project, doubtful_segments=segments, word_timings=timings, speaker_segments=speakers)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: str,
    body: UpdateProjectIn,
    user_id: str = Depends(get_current_user_id),
) -> ProjectOut:
    filename = body.filename.strip()
    if not filename:
        raise HTTPException(status_code=400, detail="filename não pode ser vazio")

    with get_connection() as conn:
        _get_owned_project(conn, project_id, user_id)
        execute(conn, "UPDATE projects SET filename = %s WHERE id = %s", (filename, project_id))
        project = fetch_one(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))

    logger.info("Project %s renamed to %r", project_id, filename)
    return ProjectOut(**project)


@router.get("/{project_id}/audio-url", response_model=AudioUrlOut)
def get_audio_url(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
    settings: Settings = Depends(get_settings),
) -> AudioUrlOut:
    with get_connection() as conn:
        project = _get_owned_project(conn, project_id, user_id)
    url = storage.create_signed_url(project["audio_path"], settings.signed_url_expires_seconds)
    return AudioUrlOut(url=url, expires_in=settings.signed_url_expires_seconds)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Response:
    with get_connection() as conn:
        project = _get_owned_project(conn, project_id, user_id)
        execute(conn, "DELETE FROM projects WHERE id = %s", (project_id,))
        # jobs/transcription_runs/doubtful_segments somem via ON DELETE CASCADE (schema.sql)

    try:
        storage.delete_audio(project["audio_path"])
    except Exception:
        logger.warning("Failed to delete audio file %s from storage", project["audio_path"], exc_info=True)

    logger.info("Deleted project %s", project_id)
    return Response(status_code=204)


@router.patch("/{project_id}/segments/{segment_id}", response_model=DoubtfulSegmentOut)
def resolve_segment(
    project_id: str,
    segment_id: str,
    body: ResolveSegmentIn,
    user_id: str = Depends(get_current_user_id),
) -> DoubtfulSegmentOut:
    with get_connection() as conn:
        project = _get_owned_project(conn, project_id, user_id)
        segment = fetch_one(
            conn,
            "SELECT * FROM doubtful_segments WHERE id = %s AND project_id = %s",
            (segment_id, project_id),
        )
        if segment is None:
            raise HTTPException(status_code=404, detail="Segment not found")

        if body.action == "accept_alternative":
            if body.alternative_index is None or not (0 <= body.alternative_index < len(segment["alternatives"])):
                raise HTTPException(status_code=400, detail="Invalid alternative_index")
            resolved_text = segment["alternatives"][body.alternative_index]["text"]
        else:
            if not body.text:
                raise HTTPException(status_code=400, detail="text is required for custom_text")
            resolved_text = body.text

        execute(
            conn,
            """
            UPDATE doubtful_segments
            SET status = 'resolved', resolved_text = %s, resolved_alternative_index = %s
            WHERE id = %s
            """,
            (resolved_text, body.alternative_index, segment_id),
        )

        # Depois de uma edição manual (manual_override), o texto final não é
        # mais reconstruído a partir dos trechos — a edição do usuário é a
        # fonte da verdade. Resolver um trecho aqui ainda fica registrado
        # (para contagem de pendentes / maybe_complete_project), só não altera
        # mais o texto exibido.
        if not project["manual_override"]:
            rebuild_final_text(conn, project_id)
        maybe_complete_project(conn, project_id)

        updated = fetch_one(conn, "SELECT * FROM doubtful_segments WHERE id = %s", (segment_id,))

    logger.info("Resolved segment %s on project %s", segment_id, project_id)
    return DoubtfulSegmentOut(
        id=updated["id"],
        start_ms=updated["start_ms"],
        end_ms=updated["end_ms"],
        reference_text=updated["reference_text"],
        alternatives=updated["alternatives"],
        score=updated["score"],
        status=updated["status"],
        resolved_text=updated["resolved_text"],
    )


@router.patch("/{project_id}/final-text", response_model=ProjectDetailOut)
def update_final_text(
    project_id: str,
    body: UpdateFinalTextIn,
    user_id: str = Depends(get_current_user_id),
) -> ProjectDetailOut:
    """Lets the user rewrite the final transcript freely, at any point once
    there's something to review (needs_review or done). Sets manual_override
    so that resolve_segment stops rebuilding final_text from the doubtful
    segments afterwards — the manual edit becomes the source of truth instead
    of being silently overwritten by the next segment resolution.
    """
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text não pode ser vazio")

    with get_connection() as conn:
        project = _get_owned_project(conn, project_id, user_id)
        if project["status"] not in ("needs_review", "done"):
            raise HTTPException(
                status_code=409,
                detail="A edição livre só está disponível depois que a transcrição estiver pronta para revisão.",
            )

        execute(
            conn,
            "UPDATE projects SET final_text = %s, manual_override = true WHERE id = %s",
            (text, project_id),
        )
        project = fetch_one(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))
        segments = _segments_out(conn, project_id)
        timings = _word_timings_out(conn, project)
        speakers = _speaker_segments_out(conn, project_id, timings)

    logger.info("Final text manually edited for project %s", project_id)
    return ProjectDetailOut(**project, doubtful_segments=segments, word_timings=timings, speaker_segments=speakers)


@router.post("/{project_id}/reset", response_model=ProjectDetailOut)
def reset_project(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
) -> ProjectDetailOut:
    """Discards every edit (segment resolutions and free-text rewrites) and
    goes back to exactly what the worker originally transcribed: every
    doubtful segment back to pending, manual_override off, final_text rebuilt
    straight from the reference run with nothing resolved.
    """
    with get_connection() as conn:
        project = _get_owned_project(conn, project_id, user_id)
        if project["status"] not in ("needs_review", "done"):
            raise HTTPException(
                status_code=409,
                detail="Só é possível resetar depois que a transcrição estiver pronta para revisão.",
            )

        execute(
            conn,
            "UPDATE doubtful_segments SET status = 'pending', resolved_text = NULL, resolved_alternative_index = NULL WHERE project_id = %s",
            (project_id,),
        )
        execute(conn, "UPDATE projects SET manual_override = false WHERE id = %s", (project_id,))
        rebuild_final_text(conn, project_id)

        has_segments = fetch_one(
            conn, "SELECT id FROM doubtful_segments WHERE project_id = %s LIMIT 1", (project_id,)
        )
        new_status = "needs_review" if has_segments else "done"
        execute(conn, "UPDATE projects SET status = %s WHERE id = %s", (new_status, project_id))

        project = fetch_one(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))
        segments = _segments_out(conn, project_id)
        timings = _word_timings_out(conn, project)
        speakers = _speaker_segments_out(conn, project_id, timings)

    logger.info("Project %s reset to original transcription", project_id)
    return ProjectDetailOut(**project, doubtful_segments=segments, word_timings=timings, speaker_segments=speakers)


@router.get("/{project_id}/export")
def export_project(
    project_id: str,
    format: str = "txt",
    user_id: str = Depends(get_current_user_id),
) -> Response:
    if format not in export_service.CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="format must be one of: txt, srt, docx")

    with get_connection() as conn:
        project = _get_owned_project(conn, project_id, user_id)
        reference_run = fetch_one(
            conn,
            "SELECT segments FROM transcription_runs WHERE project_id = %s AND is_reference = true LIMIT 1",
            (project_id,),
        )
        resolved_segments = fetch_all(
            conn,
            "SELECT start_ms, end_ms, resolved_text FROM doubtful_segments WHERE project_id = %s AND status = 'resolved'",
            (project_id,),
        )

    final_text = project.get("final_text") or ""
    reference_segments = reference_run["segments"] if reference_run else []

    if format == "txt":
        content = export_service.build_txt(final_text)
    elif format == "srt":
        content = export_service.build_srt(reference_segments, resolved_segments)
    else:
        content = export_service.build_docx(final_text, title=project["filename"])

    filename = f"{project['filename'].rsplit('.', 1)[0]}.{format}"
    return Response(
        content=content,
        media_type=export_service.CONTENT_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
