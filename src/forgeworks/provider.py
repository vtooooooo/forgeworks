"""Optional OpenAI-compatible tool selector. Only the planner's question is sent."""

import json
import os
from urllib.error import URLError
from urllib.request import Request, urlopen

from .copilot import Query


class OpenAICompatibleSelector:
    def __init__(self, endpoint: str, model: str, key: str):
        self.endpoint = endpoint
        self.model = model
        self.key = key

    def select(self, question: str, tools: tuple[str, ...]) -> dict:
        fields = Query.model_json_schema()["properties"]
        parameters = {
            "type": "object",
            "properties": {
                name: fields[name] for name in ("order", "machine", "other_schedule", "stage")
            },
            "additionalProperties": False,
        }
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": "Select at most one provided read-only planning tool. "
                    "If unsupported, do not select a tool.",
                },
                {"role": "user", "content": question},
            ],
            "tools": [
                {"type": "function", "function": {"name": name, "parameters": parameters}}
                for name in tools
            ],
            "tool_choice": "auto",
        }
        request = Request(
            self.endpoint,
            data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=10) as response:
                result = json.loads(response.read(65536))
            calls = result["choices"][0]["message"].get("tool_calls") or []
            if len(calls) != 1:
                return {}
            function = calls[0]["function"]
            args = json.loads(function["arguments"])
            if not isinstance(args, dict) or set(args) - {"order", "machine", "other_schedule", "stage"}:
                return {}
            return {**args, "tool": function["name"]}
        except (URLError, OSError, ValueError, TypeError, KeyError, IndexError):
            return {}


def configured_provider():
    endpoint = os.getenv("FORGEWORKS_LLM_ENDPOINT")
    model = os.getenv("FORGEWORKS_LLM_MODEL")
    key = os.getenv("FORGEWORKS_LLM_API_KEY")
    return OpenAICompatibleSelector(endpoint, model, key) if endpoint and model and key else None
