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


# --- AI assistant (any OpenAI-compatible endpoint; OpenRouter by default) ---------------------

DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_LLM_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
AI_MAX_TOOL_ITERATIONS = 8


def llm_api_key() -> str | None:
    return os.environ.get("LLM_API_KEY") or None


def llm_model() -> str:
    return os.environ.get("LLM_MODEL") or DEFAULT_LLM_MODEL


def llm_base_url() -> str:
    return os.environ.get("LLM_BASE_URL") or DEFAULT_LLM_BASE_URL
