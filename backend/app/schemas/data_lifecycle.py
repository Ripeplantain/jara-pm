from datetime import datetime
from typing import Any

from pydantic import BaseModel


class WorkspaceExport(BaseModel):
    exported_at: datetime
    workspace: dict[str, Any]
    members: list[dict[str, Any]]
    boards: list[dict[str, Any]]
    labels: list[dict[str, Any]]
    notes: list[dict[str, Any]]
    goals: list[dict[str, Any]]
    # The exporter's own habits only: a habit is personal, so it is not the workspace's to hand
    # out even to an owner.
    habits: list[dict[str, Any]]
    sprints: list[dict[str, Any]]
    activities: list[dict[str, Any]]
    notifications: list[dict[str, Any]]
