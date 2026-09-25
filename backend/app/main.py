import os

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.llm import LLMError, LLMNotConfigured
from app.routers import ai, auth, boards, health
from app.services import errors as service_errors

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

# CORS only for the frontend's origin (browser-side calls).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(boards.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
