"""Converts/normalizes audio to 16kHz mono WAV using the ffmpeg CLI via subprocess."""
import logging
import subprocess

logger = logging.getLogger("worker.audio")


def to_wav_mono_16k(input_path: str, output_path: str) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-ac", "1",
        "-ar", "16000",
        "-vn",
        output_path,
    ]
    logger.info("Running ffmpeg: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({result.returncode}): {result.stderr.strip()}")
