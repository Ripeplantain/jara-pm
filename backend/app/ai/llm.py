"""Provider-neutral LLM interface plus the OpenAI-compatible adapter (OpenRouter by default).

Messages and tool definitions use the OpenAI chat format, which OpenRouter also speaks. The key is
read from the environment here only, and never logged or returned.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol

from app import config


class LLMError(Exception):
    """The provider failed. The message is safe to show to users (no secrets, no raw provider text)."""


class LLMNotConfigured(LLMError):
    pass


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # raw JSON text from the model; validated by the caller


@dataclass
class AssistantTurn:
    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)


class LLMClient(Protocol):
    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> AssistantTurn: ...


class OpenAICompatClient:
    def __init__(self, api_key: str, model: str, base_url: str):
        from openai import OpenAI

        self._model = model
        self._client = OpenAI(api_key=api_key, base_url=base_url, timeout=60, max_retries=1)

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> AssistantTurn:
        from openai import OpenAIError

        try:
            res = self._client.chat.completions.create(
                model=self._model, messages=messages, tools=tools, tool_choice="auto"
            )
            msg = res.choices[0].message
        except (OpenAIError, IndexError, TypeError):
            raise LLMError("The AI service is unavailable right now. Please try again.") from None
        return AssistantTurn(
            content=msg.content,
            tool_calls=[
                ToolCall(id=tc.id, name=tc.function.name, arguments=tc.function.arguments or "{}")
                for tc in (msg.tool_calls or [])
                if tc.type == "function"
            ],
        )


def get_llm_client() -> LLMClient:
    """FastAPI dependency; tests override it with a fake."""
    key = config.llm_api_key()
    if not key:
        raise LLMNotConfigured("The AI assistant is not configured.")
    return OpenAICompatClient(key, config.llm_model(), config.llm_base_url())
