import logging
import os
import re
import time
import uuid

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.ai.llm import LLMError, LLMNotConfigured
from app.routers import ai, auth, boards, health, notifications, onboarding, sprints, workspaces
from app.services import errors as service_errors
from app.services.abuse import bucket_for, limit_for, rate_limiter
from app.services.metrics import metrics

logger = logging.getLogger("kobi.http")
_INVITE_TOKEN_PATH = re.compile(r"(/api/auth/invites/)[^/]+")
MAX_REQUEST_BYTES = 256 * 1024

app = FastAPI(title="Kobi API")


def _error(status_code: int):
    def handler(_request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status_code)

    return handler


app.add_exception_handler(service_errors.NotFound, _error(status.HTTP_404_NOT_FOUND))
app.add_exception_handler(service_errors.Forbidden, _error(status.HTTP_403_FORBIDDEN))
app.add_exception_handler(service_errors.Conflict, _error(status.HTTP_409_CONFLICT))
app.add_exception_handler(service_errors.InvalidRequest, _error(422))
app.add_exception_handler(LLMNotConfigured, _error(503))
app.add_exception_handler(LLMError, _error(502))


def _safe_path(path: str) -> str:
    return _INVITE_TOKEN_PATH.sub(r"\1[redacted]", path)


@app.middleware("http")
async def protection_middleware(request: Request, call_next) -> Response:
    started = time.perf_counter()
    request_id = uuid.uuid4().hex
    content_length = request.headers.get("content-length")
    try:
        too_large = content_length is not None and int(content_length) > MAX_REQUEST_BYTES
    except ValueError:
        too_large = True
    if too_large:
        response = JSONResponse({"detail": "Request body is too large"}, status_code=413)
    else:
        bucket = bucket_for(request.method, request.url.path)
        client_key = request.client.host if request.client else "unknown"
        if bucket and not rate_limiter.allowed(bucket, client_key, limit_for(bucket)):
            response = JSONResponse(
                {"detail": "Too many requests. Try again shortly."},
                status_code=429,
                headers={"Retry-After": "60"},
            )
        else:
            response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    logger.info(
        "request method=%s path=%s status=%s duration_ms=%.1f request_id=%s",
        request.method,
        _safe_path(request.url.path),
        response.status_code,
        (time.perf_counter() - started) * 1000,
        request_id,
    )
    metrics.observe_request(response.status_code, (time.perf_counter() - started) * 1000)
    return response

# CORS only for the frontend's origin (browser-side calls).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(onboarding.router, prefix="/api")
app.include_router(boards.router, prefix="/api")
app.include_router(workspaces.router, prefix="/api")
app.include_router(sprints.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
