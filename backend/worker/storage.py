from supabase import Client, create_client

from worker.config import WorkerSettings


def get_client(settings: WorkerSettings) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def download_audio(settings: WorkerSettings, path: str) -> bytes:
    client = get_client(settings)
    return client.storage.from_(settings.supabase_storage_bucket).download(path)
