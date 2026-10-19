"""Polling worker: claims queued jobs from Postgres, downloads the project's
audio from Supabase Storage, runs it through ffmpeg + multiple faster-whisper
configurations, computes consensus/doubtful segments, and writes the result
back to Postgres.

Can run on a different machine than the API (no GPU required, but a GPU will
speed things up if `WHISPER_DEVICE=cuda`).
"""
import logging
import os
import tempfile
import time

from psycopg2.extras import Json

from worker.audio import to_wav_mono_16k
from worker.config import WorkerSettings, get_settings
from worker.consensus import ConsensusResult, Run, build_consensus
from worker.diarize import Turn, diarize
from worker.db import execute, fetch_one, get_connection
from worker.storage import download_audio
from worker.transcribe import transcribe

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("worker.main")


def claim_job(settings: WorkerSettings) -> dict | None:
    with get_connection(settings) as conn:
        job = fetch_one(
            conn,
            """
            UPDATE jobs
            SET status = 'processing', attempts = attempts + 1, locked_at = now()
            WHERE id = (
                SELECT id FROM jobs
                WHERE status = 'queued'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING *
            """,
        )
        if job is not None:
            execute(conn, "UPDATE projects SET status = 'processing' WHERE id = %s", (job["project_id"],))
        return job


def fail_job(settings: WorkerSettings, job_id: str, project_id: str, error: str) -> None:
    logger.error("Job %s failed: %s", job_id, error)
    with get_connection(settings) as conn:
        execute(conn, "UPDATE jobs SET status = 'failed', error = %s WHERE id = %s", (error, job_id))
        execute(conn, "UPDATE projects SET status = 'failed', error = %s WHERE id = %s", (error, project_id))


def complete_job(
    settings: WorkerSettings,
    job_id: str,
    project_id: str,
    runs_payload: list[dict],
    result: ConsensusResult,
    duration_ms: int | None,
    speaker_turns: list[Turn],
) -> None:
    with get_connection(settings) as conn:
        for run in runs_payload:
            execute(
                conn,
                """
                INSERT INTO transcription_runs (project_id, model, params, segments, is_reference, error)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    project_id,
                    run["model"],
                    Json(run["params"]),
                    Json(run["segments"]),
                    run["is_reference"],
                    run["error"],
                ),
            )

        for segment in result.doubtful_segments:
            execute(
                conn,
                """
                INSERT INTO doubtful_segments
                    (project_id, start_ms, end_ms, reference_text, alternatives, score, status)
                VALUES (%s, %s, %s, %s, %s, %s, 'pending')
                """,
                (
                    project_id,
                    segment.start_ms,
                    segment.end_ms,
                    segment.reference_text,
                    Json(segment.alternatives),
                    segment.score,
                ),
            )

        for turn in speaker_turns:
            execute(
                conn,
                "INSERT INTO speaker_turns (project_id, start_ms, end_ms, speaker) VALUES (%s, %s, %s, %s)",
                (project_id, turn.start_ms, turn.end_ms, turn.speaker),
            )

        status = "needs_review" if result.doubtful_segments else "done"
        execute(
            conn,
            "UPDATE projects SET status = %s, final_text = %s, duration_ms = %s, error = NULL WHERE id = %s",
            (status, result.final_text, duration_ms, project_id),
        )
        execute(conn, "UPDATE jobs SET status = 'done' WHERE id = %s", (job_id,))


def run_pipeline(settings: WorkerSettings, job: dict) -> None:
    project_id = job["project_id"]
    job_id = job["id"]

    with get_connection(settings) as conn:
        project = fetch_one(conn, "SELECT * FROM projects WHERE id = %s", (project_id,))
    if project is None:
        fail_job(settings, job_id, project_id, "Project not found")
        return

    logger.info("Processing job %s for project %s (%s)", job_id, project_id, project["filename"])

    with tempfile.TemporaryDirectory() as tmp_dir:
        ext = project["audio_path"].rsplit(".", 1)[-1]
        input_path = os.path.join(tmp_dir, f"input.{ext}")
        wav_path = os.path.join(tmp_dir, "audio.wav")

        logger.info("Downloading audio from storage: %s", project["audio_path"])
        audio_bytes = download_audio(settings, project["audio_path"])
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        logger.info("Converting audio to 16kHz mono wav")
        to_wav_mono_16k(input_path, wav_path)

        runs: list[Run] = []
        runs_payload: list[dict] = []
        errors: list[str] = []
        duration_ms: int | None = None

        for cfg in settings.whisper_runs:
            model_name = cfg["model"]
            beam_size = cfg.get("beam_size", 5)
            temperature = cfg.get("temperature", 0.0)
            params = {"beam_size": beam_size, "temperature": temperature}
            try:
                run, raw_segments, duration_seconds = transcribe(
                    wav_path,
                    model_name=model_name,
                    beam_size=beam_size,
                    temperature=temperature,
                    device=settings.whisper_device,
                    compute_type=settings.whisper_compute_type,
                    language=settings.whisper_language,
                )
                runs.append(run)
                runs_payload.append(
                    {"model": model_name, "params": params, "segments": raw_segments, "is_reference": False, "error": None}
                )
                if duration_ms is None:
                    # float() por segurança: valores vindos do faster-whisper às
                    # vezes são numpy.float64, que quebra o INSERT no psycopg2
                    # (ver mesmo problema corrigido em consensus.py).
                    duration_ms = round(float(duration_seconds) * 1000)
            except Exception as exc:
                logger.exception("Whisper run failed: model=%s params=%s", model_name, params)
                errors.append(f"{model_name} ({params}): {exc}")
                runs_payload.append(
                    {"model": model_name, "params": params, "segments": [], "is_reference": False, "error": str(exc)}
                )

        if not runs:
            fail_job(settings, job_id, project_id, "; ".join(errors) or "All whisper runs failed")
            return

        result = build_consensus(
            runs,
            agreement_threshold=settings.agreement_threshold,
            confidence_threshold=settings.confidence_threshold,
        )

        # Map the reference run picked among `runs` (successful only) back to its
        # position in `runs_payload` (which also contains the failed attempts).
        successful_indices = [i for i, payload in enumerate(runs_payload) if payload["error"] is None]
        runs_payload[successful_indices[result.reference_index]]["is_reference"] = True

        speaker_turns: list[Turn] = []
        if settings.diarization_enabled:
            try:
                speaker_turns = diarize(wav_path, settings)
                logger.info("Diarization found %d speaker turn(s) for project %s", len(speaker_turns), project_id)
            except Exception:
                logger.exception(
                    "Diarization failed for project %s — continuing without speaker labels", project_id
                )
                speaker_turns = []

        complete_job(settings, job_id, project_id, runs_payload, result, duration_ms, speaker_turns)
        logger.info(
            "Job %s done for project %s: status=%s doubtful_segments=%d",
            job_id,
            project_id,
            "needs_review" if result.doubtful_segments else "done",
            len(result.doubtful_segments),
        )


def main() -> None:
    settings = get_settings()
    logger.info("Worker started. Polling every %.1fs", settings.poll_interval_seconds)
    while True:
        try:
            job = claim_job(settings)
        except Exception:
            # Conexões com o pooler do Supabase caem de vez em quando (ocioso
            # por tempo demais, reinício do pooler, etc.) — sem isso, qualquer
            # falha aqui derrubava o processo inteiro do worker, exigindo
            # reinício manual.
            logger.exception("Failed to claim job (connection issue?) — retrying after poll interval")
            time.sleep(settings.poll_interval_seconds)
            continue

        if job is None:
            time.sleep(settings.poll_interval_seconds)
            continue
        try:
            run_pipeline(settings, job)
        except Exception as exc:
            logger.exception("Unhandled error processing job %s", job["id"])
            try:
                fail_job(settings, job["id"], job["project_id"], f"Unhandled error: {exc}")
            except Exception:
                logger.exception("Failed to mark job %s as failed (connection issue?)", job["id"])


if __name__ == "__main__":
    main()
