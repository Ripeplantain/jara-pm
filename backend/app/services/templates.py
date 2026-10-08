"""Board templates.

Declarative data, not database rows: a template is a shape, and once a board is made from one
the two have nothing more to do with each other. Adding a template means adding an entry here.
"""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models import Board, User
from app.services import boards as board_svc
from app.services.errors import NotFound


@dataclass(frozen=True)
class Template:
    key: str
    name: str
    description: str
    # (column title, starter card titles). The last column is marked done when it looks like one.
    columns: list[tuple[str, list[str]]] = field(default_factory=list)
    done_column: str | None = None
    labels: list[tuple[str, str]] = field(default_factory=list)


TEMPLATES: tuple[Template, ...] = (
    Template(
        key="kanban",
        name="Kanban",
        description="The classic three columns, with a work-in-progress limit on Doing.",
        columns=[
            ("Backlog", ["Write down everything you are not doing yet"]),
            ("Doing", []),
            ("Done", []),
        ],
        done_column="Done",
        labels=[("bug", "rose"), ("chore", "slate"), ("idea", "cyan")],
    ),
    Template(
        key="scrum",
        name="Scrum",
        description="Backlog to review, ready for sprints and story points.",
        columns=[
            ("Product backlog", ["Groom this before the next sprint"]),
            ("Sprint backlog", []),
            ("In progress", []),
            ("In review", []),
            ("Done", []),
        ],
        done_column="Done",
        labels=[("story", "indigo"), ("bug", "rose"), ("spike", "amber")],
    ),
    Template(
        key="bug-triage",
        name="Bug triage",
        description="Reported bugs from first look to verified fix.",
        columns=[
            ("Reported", ["Triage anything that lands here within a day"]),
            ("Confirmed", []),
            ("Fixing", []),
            ("Needs verification", []),
            ("Closed", []),
        ],
        done_column="Closed",
        labels=[("critical", "rose"), ("regression", "amber"), ("cannot reproduce", "slate")],
    ),
    Template(
        key="content-calendar",
        name="Content calendar",
        description="Ideas through drafting and review to published.",
        columns=[
            ("Ideas", ["Park half-formed ideas here"]),
            ("Drafting", []),
            ("In review", []),
            ("Scheduled", []),
            ("Published", []),
        ],
        done_column="Published",
        labels=[("blog", "cyan"), ("newsletter", "violet"), ("social", "emerald")],
    ),
    Template(
        key="product-roadmap",
        name="Product roadmap",
        description="Now, next and later, with a place for what you decided against.",
        columns=[
            ("Ideas", ["Collect requests here before committing to them"]),
            ("Now", []),
            ("Next", []),
            ("Later", []),
            ("Shipped", []),
            ("Not doing", []),
        ],
        done_column="Shipped",
        labels=[("customer request", "cyan"), ("strategic", "indigo"), ("quick win", "emerald")],
    ),
)

BY_KEY = {t.key: t for t in TEMPLATES}


def list_templates() -> tuple[Template, ...]:
    return TEMPLATES


def create_board_from_template(
    db: Session, user: User, key: str, title: str | None = None, workspace_id: int | None = None
) -> Board:
    """One transaction: the board, its columns, its starter cards, and the done flag."""
    from app.services import labels as label_svc

    template = BY_KEY.get(key)
    if template is None:
        raise NotFound("Template")

    board = board_svc.create_board_with_cards(
        db, user, title or template.name, template.columns, workspace_id
    )
    if template.done_column:
        for column in board.columns:
            if column.title == template.done_column:
                column.is_done = True
    if template.description:
        board.description = template.description
    db.commit()

    # Labels are workspace-wide, so only add the ones that are not there yet.
    existing = {label.name for label in label_svc.list_labels(db, user, board.workspace_id)}
    for name, color in template.labels:
        if name not in existing:
            label_svc.create_label(db, user, board.workspace_id, name, color)
    return board_svc.get_board(db, user, board.id)
