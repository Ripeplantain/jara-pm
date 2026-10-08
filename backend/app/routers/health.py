from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.health import HealthResponse, MetricsResponse
from app.services.metrics import metrics
from app.services.product_analytics import snapshot as product_snapshot

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/metrics", response_model=MetricsResponse)
def operational_metrics(_user: CurrentUser, db: DbSession) -> MetricsResponse:
    return MetricsResponse(**metrics.snapshot(), **product_snapshot(db))
