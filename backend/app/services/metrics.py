"""Small process-local operational counters for the single-replica beta."""

from threading import Lock


class Metrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._values = {
            "requests": 0,
            "request_errors": 0,
            "auth_failures": 0,
            "rate_limited": 0,
            "email_failures": 0,
            "duration_ms_total": 0.0,
        }

    def observe_request(self, status: int, duration_ms: float) -> None:
        with self._lock:
            self._values["requests"] += 1
            self._values["duration_ms_total"] += duration_ms
            if status >= 500:
                self._values["request_errors"] += 1
            if status == 401:
                self._values["auth_failures"] += 1
            if status == 429:
                self._values["rate_limited"] += 1

    def increment(self, name: str) -> None:
        with self._lock:
            if name in self._values:
                self._values[name] += 1

    def snapshot(self) -> dict[str, float | int]:
        with self._lock:
            result = dict(self._values)
        result["avg_duration_ms"] = (
            round(float(result["duration_ms_total"]) / int(result["requests"]), 1)
            if result["requests"]
            else 0.0
        )
        del result["duration_ms_total"]
        return result


metrics = Metrics()
