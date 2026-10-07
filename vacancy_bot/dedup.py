"""Защита от повторной отправки.

Совпадение по URL, id вакансии или паре компания + заголовок считается
той же вакансией. Небольшая правка текста работодателем ключ не меняет.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from vacancy_bot.models import Vacancy
from vacancy_bot.textutil import norm_key, norm_url, vacancy_id_from_url


def identity_keys(vacancy: Vacancy) -> list[str]:
    keys: list[str] = []
    url = norm_url(vacancy.url)
    if url:
        keys.append(f"url:{url}")
    vacancy_id = vacancy.vacancy_id or vacancy_id_from_url(vacancy.url)
    if vacancy_id:
        keys.append(f"id:{vacancy.source}:{vacancy_id}")
    company = norm_key(vacancy.company)
    title = norm_key(vacancy.title)
    if company and title:
        keys.append(f"ct:{company}|{title}")
    return keys


class SeenStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self.path)
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS seen (
                key TEXT PRIMARY KEY,
                url TEXT,
                vacancy_id TEXT,
                company_title TEXT,
                content_hash TEXT,
                seen_at TEXT
            )
            """
        )
        self._connection.commit()

    def close(self) -> None:
        self._connection.close()

    def is_duplicate(self, vacancy: Vacancy) -> bool:
        keys = identity_keys(vacancy)
        if not keys:
            return False
        placeholders = ",".join("?" for _ in keys)
        row = self._connection.execute(
            f"SELECT 1 FROM seen WHERE key IN ({placeholders}) LIMIT 1",
            keys,
        ).fetchone()
        return row is not None

    def mark_sent(self, vacancy: Vacancy, content_hash: str = "") -> None:
        keys = identity_keys(vacancy)
        now = datetime.now(timezone.utc).isoformat()
        company_title = f"{norm_key(vacancy.company)}|{norm_key(vacancy.title)}"
        for key in keys:
            self._connection.execute(
                """
                INSERT INTO seen (key, url, vacancy_id, company_title, content_hash, seen_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    seen_at = excluded.seen_at
                """,
                (
                    key,
                    norm_url(vacancy.url),
                    vacancy.vacancy_id,
                    company_title,
                    content_hash,
                    now,
                ),
            )
        self._connection.commit()
