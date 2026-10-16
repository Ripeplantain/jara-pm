import os


def database_path() -> str:
    return os.environ.get("DATABASE_PATH", "/data/app.db")


def jwt_secret() -> str:
    """Token-signing secret. Must differ from the frontend's AUTH_SECRET."""
    secret = os.environ.get("BACKEND_JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("BACKEND_JWT_SECRET must be set to at least 32 characters")
    return secret


ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "60"))


def require_email_verification() -> bool:
    return os.environ.get("REQUIRE_EMAIL_VERIFICATION", "false").lower() in {"1", "true", "yes"}


def app_url() -> str:
    return (os.environ.get("AUTH_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:3000").rstrip("/")


def resend_api_key() -> str | None:
    return os.environ.get("RESEND_API_KEY") or None


def resend_from_email() -> str | None:
    return os.environ.get("RESEND_FROM_EMAIL") or None


def resend_reply_to() -> str | None:
    return os.environ.get("RESEND_REPLY_TO") or None


# --- AI assistant (any OpenAI-compatible endpoint; OpenRouter by default) ---------------------

DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_LLM_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
AI_MAX_TOOL_ITERATIONS = 8
AI_MAX_DRAFT_ITERATIONS = 3


def ai_monthly_action_limit() -> int:
    return max(1, int(os.environ.get("AI_MONTHLY_ACTION_LIMIT", "500")))


def llm_api_key() -> str | None:
    return os.environ.get("LLM_API_KEY") or None


def llm_model() -> str:
    return os.environ.get("LLM_MODEL") or DEFAULT_LLM_MODEL


def llm_base_url() -> str:
    return os.environ.get("LLM_BASE_URL") or DEFAULT_LLM_BASE_URL


# --- Observability (PostHog) ------------------------------------------------------------------

DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"


def posthog_project_token() -> str | None:
    """The project's write-only ingestion token. A personal API key is never read here."""
    return os.environ.get("POSTHOG_PROJECT_TOKEN") or None


def posthog_host() -> str:
    """Region-specific ingestion host; EU and US projects are not interchangeable."""
    return (os.environ.get("POSTHOG_HOST") or DEFAULT_POSTHOG_HOST).rstrip("/")


def app_environment() -> str:
    """development, staging or production. Reported with every event and exception."""
    return os.environ.get("APP_ENV") or "development"


def app_release() -> str | None:
    """Release identifier (a git sha or version), when the deployment supplies one."""
    return os.environ.get("APP_RELEASE") or None
