from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

LabelName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
LabelColor = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]


class LabelCreate(BaseModel):
    name: LabelName
    color: LabelColor = "slate"


class LabelUpdate(BaseModel):
    name: LabelName | None = None
    color: LabelColor | None = None


class LabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    name: str
    color: str
