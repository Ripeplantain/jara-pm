from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"]


class MetricsResponse(BaseModel):
    requests: int
    request_errors: int
    auth_failures: int
    rate_limited: int
    email_failures: int
    avg_duration_ms: float
    weekly_active_workspaces: int
    onboarding_completed: int
    board_created: int
    card_created: int
    sprint_created: int
    invitation_sent: int
    ai_used: int
