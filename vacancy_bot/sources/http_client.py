from __future__ import annotations

import time
import urllib.error
import urllib.request


class HttpError(Exception):
    def __init__(self, status: int, body: str = "") -> None:
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


class HttpClient:
    def __init__(self, user_agent: str, delay_seconds: float = 0.35) -> None:
        self.user_agent = user_agent
        self.delay_seconds = delay_seconds
        self._last_request = 0.0

    def get(self, url: str, headers: dict[str, str] | None = None, timeout: float = 25) -> str:
        self._wait()
        request_headers = {"User-Agent": self.user_agent, "Accept-Language": "ru"}
        if headers:
            request_headers.update(headers)
        request = urllib.request.Request(url, headers=request_headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                charset = response.headers.get_content_charset() or "utf-8"
                return raw.decode(charset, errors="replace")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise HttpError(error.code, body) from error

    def _wait(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.delay_seconds:
            time.sleep(self.delay_seconds - elapsed)
        self._last_request = time.monotonic()
