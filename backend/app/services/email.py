import logging
from dataclasses import dataclass
from html import escape
from typing import Protocol

from app import config
from app.services.metrics import metrics

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """A safe application-level email delivery failure."""


class EmailSender(Protocol):
    def send(self, *, to: str, subject: str, html: str, text: str) -> None: ...


@dataclass
class ResendEmailSender:
    """The only production email adapter; the API key never leaves the backend."""

    api_key: str
    from_email: str
    reply_to: str | None = None

    def send(self, *, to: str, subject: str, html: str, text: str) -> None:
        try:
            import resend

            resend.api_key = self.api_key
            params = {"from": self.from_email, "to": [to], "subject": subject, "html": html, "text": text}
            if self.reply_to:
                params["reply_to"] = self.reply_to
            resend.Emails.send(params)
        except Exception:
            metrics.increment("email_failures")
            logger.exception("transactional email delivery failed")
            raise EmailDeliveryError("Email could not be delivered") from None


@dataclass
class DisabledEmailSender:
    """Local/test sink. It intentionally does not expose lifecycle tokens in responses or logs."""

    def send(self, *, to: str, subject: str, html: str, text: str) -> None:
        return None


def get_email_sender() -> EmailSender:
    key = config.resend_api_key()
    sender = config.resend_from_email()
    if not key or not sender:
        return DisabledEmailSender()
    return ResendEmailSender(key, sender, config.resend_reply_to())


def send_verification(email: str, token: str) -> None:
    url = f"{config.app_url()}/verify-email?token={token}"
    get_email_sender().send(
        to=email,
        subject="Verify your Kobi email",
        html=f"<p>Verify your Kobi email address.</p><p><a href=\"{url}\">Verify email</a></p>",
        text=f"Verify your Kobi email: {url}",
    )


def send_password_reset(email: str, token: str) -> None:
    url = f"{config.app_url()}/reset-password?token={token}"
    get_email_sender().send(
        to=email,
        subject="Reset your Kobi password",
        html=f"<p>Reset your Kobi password.</p><p><a href=\"{url}\">Reset password</a></p>",
        text=f"Reset your Kobi password: {url}",
    )


def send_invitation(
    email: str, workspace_name: str, inviter_name: str, role: str, token: str
) -> None:
    url = f"{config.app_url()}/invite?token={token}"
    safe_workspace = escape(workspace_name)
    safe_inviter = escape(inviter_name)
    safe_role = escape(role)
    get_email_sender().send(
        to=email,
        subject=f"You have been invited to {workspace_name} on Kobi",
        html=(
            f"<p>{safe_inviter} invited you to join <strong>{safe_workspace}</strong> "
            f"as a {safe_role}.</p><p><a href=\"{url}\">Accept invitation</a></p>"
        ),
        text=(
            f"{inviter_name} invited you to join {workspace_name} on Kobi as a {role}. "
            f"Accept the invitation: {url}"
        ),
    )
