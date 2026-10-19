from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    database_url: str
    # Only needed for older Supabase projects still signing user JWTs with the
    # legacy shared HS256 secret. New projects sign with an asymmetric key
    # verified via JWKS (see app/core/auth.py) and don't need this.
    supabase_jwt_secret: str = ""
    supabase_storage_bucket: str = "audio"

    max_upload_mb: int = 50
    allowed_audio_extensions: str = "mp3,m4a,wav,ogg,opus"
    signed_url_expires_seconds: int = 3600

    # Origens do frontend autorizadas a chamar a API via navegador (CORS).
    # Lista separada por vírgula, ex.: "http://localhost:3000,https://meu-app.vercel.app".
    frontend_origins: str = "http://localhost:3000"

    @property
    def allowed_extensions_set(self) -> set[str]:
        return {ext.strip().lower().lstrip(".") for ext in self.allowed_audio_extensions.split(",") if ext.strip()}

    @property
    def frontend_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origins.split(",") if origin.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
