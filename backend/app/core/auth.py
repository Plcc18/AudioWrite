"""Validates Supabase Auth JWTs locally (no network round-trip per request).

Supabase projects now sign user access tokens with an asymmetric key (ES256 by
default) and publish the public key at the project's JWKS endpoint
(`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`). We fetch and cache that key
with PyJWT's `PyJWKClient` and use it to verify tokens — no shared secret
needed. (Older Supabase projects that still sign with the legacy HS256 secret
are also supported via `SUPABASE_JWT_SECRET`, if set.)
"""
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings

_bearer_scheme = HTTPBearer(auto_error=False)


@lru_cache
def _get_jwk_client() -> jwt.PyJWKClient:
    settings = get_settings()
    jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return jwt.PyJWKClient(jwks_url)


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header")

    settings = get_settings()
    token = credentials.credentials

    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") == "HS256" and settings.supabase_jwt_secret:
            # Legacy Supabase projects still signing with the shared secret.
            payload = jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        else:
            signing_key = _get_jwk_client().get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
            )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {exc}") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")
    return user_id
