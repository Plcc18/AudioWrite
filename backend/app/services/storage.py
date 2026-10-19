"""Wrapper around the Supabase Storage API used to keep uploaded audio files."""
from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_supabase_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def upload_audio(path: str, content: bytes, content_type: str) -> None:
    settings = get_settings()
    client = get_supabase_client()
    client.storage.from_(settings.supabase_storage_bucket).upload(
        path,
        content,
        file_options={"content-type": content_type},
    )


def delete_audio(path: str) -> None:
    settings = get_settings()
    client = get_supabase_client()
    client.storage.from_(settings.supabase_storage_bucket).remove([path])


def download_audio(path: str) -> bytes:
    settings = get_settings()
    client = get_supabase_client()
    return client.storage.from_(settings.supabase_storage_bucket).download(path)


def create_signed_url(path: str, expires_in: int) -> str:
    settings = get_settings()
    client = get_supabase_client()
    result = client.storage.from_(settings.supabase_storage_bucket).create_signed_url(path, expires_in)
    return result["signedURL"] if "signedURL" in result else result["signed_url"]
