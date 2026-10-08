from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.config import ACCESS_TOKEN_MINUTES, jwt_secret

_ALGORITHM = "HS256"


@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: int
    auth_version: int


def create_access_token(user_id: int, auth_version: int = 0) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "ver": auth_version,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, jwt_secret(), algorithm=_ALGORITHM)


def decode_access_token(token: str) -> AccessTokenClaims | None:
    """Return token claims, or None if the token is invalid or expired."""
    try:
        payload = jwt.decode(
            token, jwt_secret(), algorithms=[_ALGORITHM], options={"require": ["sub", "exp"]}
        )
        return AccessTokenClaims(int(payload["sub"]), int(payload.get("ver", 0)))
    except (jwt.PyJWTError, ValueError):
        return None
