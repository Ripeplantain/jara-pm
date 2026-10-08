from datetime import datetime
from typing import Any

from pydantic import BaseModel


class WorkspaceExport(BaseModel):
    exported_at: datetime
    workspace: dict[str, Any]
    members: list[dict[str, Any]]
    boards: list[dict[str, Any]]
    labels: list[dict[str, Any]]
    sprints: list[dict[str, Any]]
    activities: list[dict[str, Any]]
    notifications: list[dict[str, Any]]
