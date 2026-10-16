"""Server-side PostHog capture for product events and unhandled exceptions.

Three rules shape this module.

Analytics never break a request. Every provider call is wrapped, and a failure is counted in
`metrics` and logged rather than raised, so a PostHog outage cannot fail a board write.

An event never outlives the change it describes. `capture` queues onto the SQLAlchemy session
and only reaches the provider once that session commits, which gives product events the same
guarantee `services/activity.py` gets from running inside the transaction: a rolled-back change
leaves no trace. `capture_now` exists for the handful of events that write nothing (a sign-in)
and for exceptions, which have no transaction left to ride on.

Nothing identifying goes out. Callers pass an opaque `distinct_id` built from an internal row id
by `user_distinct_id`; emails, password hashes, tokens, card text and LLM prompts are never
properties. The only credential this module reads is the project's write-only ingestion token.
"""

import logging
from collections import deque
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Protocol

from sqlalchemy import event
from sqlalchemy.orm import Session

from app import config
from app.services.metrics import metrics

logger = logging.getLogger(__name__)

# Key under which queued events wait on `Session.info` until the session commits.
_PENDING = "posthog_pending"


def user_distinct_id(user_id: int) -> str:
    """The person key for one account. The frontend builds the same string from the same id,
    so a server event and a browser event land on one person; changing the shape splits them."""
    return f"user:{user_id}"


def workspace_distinct_id(workspace_id: int) -> str:
    """For workspace-scoped events with no acting user. Paired with `person=False` so these do
    not create person profiles for things that are not people."""
    return f"workspace:{workspace_id}"


class AnalyticsSink(Protocol):
    def capture(self, event_name: str, *, distinct_id: str, properties: dict[str, Any]) -> None: ...

    def capture_exception(self, exc: BaseException, *, properties: dict[str, Any]) -> None: ...

    def shutdown(self) -> None: ...


@dataclass
class PostHogSink:
    """The only production adapter. It holds one client for the whole process: the SDK batches
    on a background thread, so building a client per call would leak threads."""

    client: Any

    def capture(self, event_name: str, *, distinct_id: str, properties: dict[str, Any]) -> None:
        try:
            self.client.capture(event_name, distinct_id=distinct_id, properties=properties)
        except Exception:
            metrics.increment("analytics_failures")
            logger.warning("posthog capture failed for %s", event_name, exc_info=True)

    def capture_exception(self, exc: BaseException, *, properties: dict[str, Any]) -> None:
        try:
            self.client.capture_exception(exc, properties=properties)
        except Exception:
            metrics.increment("analytics_failures")
            logger.warning("posthog exception capture failed", exc_info=True)

    def shutdown(self) -> None:
        """Flush the batch queue. Without this a stopping container drops whatever the
        background thread had not sent yet."""
        try:
            self.client.shutdown()
        except Exception:
            logger.warning("posthog shutdown failed", exc_info=True)


@dataclass
class DisabledSink:
    """Local and test sink, used whenever no project token is configured. It keeps the last few
    events in memory so `POSTHOG_PROJECT_TOKEN` stays genuinely optional while a developer can
    still see what would have been sent. Bounded, so it cannot grow into a leak."""

    captured: deque[tuple[str, str, dict[str, Any]]] = field(
        default_factory=lambda: deque(maxlen=50)
    )

    def capture(self, event_name: str, *, distinct_id: str, properties: dict[str, Any]) -> None:
        self.captured.append((event_name, distinct_id, properties))

    def capture_exception(self, exc: BaseException, *, properties: dict[str, Any]) -> None:
        self.captured.append(("$exception", type(exc).__name__, properties))

    def shutdown(self) -> None:
        return None


@lru_cache
def get_sink() -> AnalyticsSink:
    """One sink per process. Cached because constructing the real client starts a thread."""
    token = config.posthog_project_token()
    if not token:
        return DisabledSink()
    super_properties: dict[str, Any] = {"environment": config.app_environment()}
    release = config.app_release()
    if release:
        super_properties["$app_version"] = release
    try:
        from posthog import Posthog

        return PostHogSink(
            Posthog(
                token,
                host=config.posthog_host(),
                # Every event and exception carries the environment, so staging traffic is
                # never mistaken for production.
                super_properties=super_properties,
                # Exceptions are captured explicitly in app/main.py, where the request's
                # method, redacted path and request id are known.
                enable_exception_autocapture=False,
                # Keeps local variables out of captured stack traces; frames can hold a
                # password or a token.
                capture_exception_code_variables=False,
            )
        )
    except Exception:
        metrics.increment("analytics_failures")
        logger.warning("posthog client unavailable; analytics disabled", exc_info=True)
        return DisabledSink()


def shutdown() -> None:
    """Flush anything still queued, on application shutdown."""
    get_sink().shutdown()


def reset_sink() -> None:
    """Drop the cached sink so a changed environment takes effect. Used by tests."""
    get_sink.cache_clear()


def capture(
    db: Session,
    event_name: str,
    *,
    distinct_id: str,
    properties: dict[str, Any] | None = None,
    person: bool = True,
) -> None:
    """Queue a product event. It is sent when `db` commits and dropped if `db` rolls back."""
    # The queue only has the rollback guarantee while a transaction is there to carry it: on an
    # idle session, `rollback()` emits no event, and a stale queue would ride out on the next
    # unrelated commit. Every real caller has already written something, so this mostly just
    # makes the guarantee true for all of them rather than most.
    if not db.in_transaction():
        db.begin()
    payload = dict(properties or {})
    if not person:
        payload["$process_person_profile"] = False
    db.info.setdefault(_PENDING, []).append((event_name, distinct_id, payload))


def capture_now(
    event_name: str,
    *,
    distinct_id: str,
    properties: dict[str, Any] | None = None,
) -> None:
    """Send an event that no transaction covers, such as a successful sign-in."""
    get_sink().capture(event_name, distinct_id=distinct_id, properties=dict(properties or {}))


def capture_exception(exc: BaseException, *, properties: dict[str, Any] | None = None) -> None:
    """Report an unhandled exception. Sent immediately: the request is already failing."""
    get_sink().capture_exception(exc, properties=dict(properties or {}))


@event.listens_for(Session, "after_commit")
def _send_pending(session: Session) -> None:
    sink = get_sink()
    for event_name, distinct_id, properties in session.info.pop(_PENDING, []):
        sink.capture(event_name, distinct_id=distinct_id, properties=properties)


@event.listens_for(Session, "after_soft_rollback")
def _drop_pending(session: Session, _previous_transaction: Any) -> None:
    """The change did not happen, so neither did the event."""
    session.info.pop(_PENDING, None)
