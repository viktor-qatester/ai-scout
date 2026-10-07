from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

logger = logging.getLogger("vacancy_bot")


class Notifier:
    def send(self, text: str) -> bool:
        raise NotImplementedError


class MemoryNotifier(Notifier):
    def __init__(self) -> None:
        self.messages: list[str] = []

    def send(self, text: str) -> bool:
        self.messages.append(text)
        return True


class StdoutNotifier(Notifier):
    def send(self, text: str) -> bool:
        print(text)
        return True


class TelegramNotifier(Notifier):
    def __init__(self, token: str, chat_id: str) -> None:
        self._token = token
        self._chat_id = chat_id

    def send(self, text: str) -> bool:
        url = f"https://api.telegram.org/bot{self._token}/sendMessage"
        payload = json.dumps(
            {"chat_id": self._chat_id, "text": text, "disable_web_page_preview": True}
        ).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return 200 <= response.status < 300
        except urllib.error.URLError:
            logger.exception("не удалось отправить сообщение в Telegram")
            return False


def build_notifier(dry_run: bool = False) -> Notifier:
    if dry_run:
        return StdoutNotifier()
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if token and chat_id:
        return TelegramNotifier(token, chat_id)
    logger.warning(
        "TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы, уведомления печатаются в консоль"
    )
    return StdoutNotifier()
