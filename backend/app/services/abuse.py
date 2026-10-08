"""Small, process-local abuse controls for the single-replica beta deployment."""

import os
import threading
import time
from collections import defaultdict, deque

WINDOW_SECONDS = 60.0


class RateLimiter:
    def __init__(self) -> None:
        self._events: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allowed(self, bucket: str, key: str, limit: int) -> bool:
        now = time.monotonic()
        cutoff = now - WINDOW_SECONDS
        with self._lock:
            events = self._events[(bucket, key)]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                return False
            events.append(now)
            return True

    def clear(self) -> None:
        with self._lock:
            self._events.clear()


rate_limiter = RateLimiter()


def limit_for(bucket: str) -> int:
    defaults = {
        "register": 8,
        "login": 20,
        "password_reset": 8,
        "verification_email": 8,
        "invitation": 20,
        "ai": 30,
    }
    return max(1, int(os.environ.get(f"RATE_LIMIT_{bucket.upper()}", defaults[bucket])))


def bucket_for(method: str, path: str) -> str | None:
    if method == "POST" and path == "/api/auth/register":
        return "register"
    if method == "POST" and path == "/api/auth/login":
        return "login"
    if method == "POST" and path == "/api/auth/password-reset/request":
        return "password_reset"
    if method == "POST" and path == "/api/auth/verification-email":
        return "verification_email"
    if method == "POST" and "/invites" in path:
        return "invitation"
    if method == "POST" and path.endswith("/ai"):
        return "ai"
    return None


__all__ = ["WINDOW_SECONDS", "bucket_for", "limit_for", "rate_limiter"]
