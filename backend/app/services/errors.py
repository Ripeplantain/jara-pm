"""Service-layer errors, mapped to HTTP status codes in app/main.py.

Kept in one module so services can raise them without importing each other.
"""


class NotFound(Exception):
    """The resource does not exist, or the caller may not know that it does."""

    def __init__(self, what: str = "Resource"):
        super().__init__(f"{what} not found")


class Forbidden(Exception):
    """The caller can see the resource but their role is too weak for this action."""


class Conflict(Exception):
    """The request clashes with the current state (e.g. the last owner)."""


class InvalidRequest(Exception):
    """The arguments do not make sense together."""
