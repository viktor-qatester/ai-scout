"""Хабр Карьера: публичный JSON списка и JSON-LD страницы вакансии.

В выдачу попадают только локации Беларуси и удалёнка, в тексте которой
прямо сказано, что можно работать из Беларуси или из любой страны.
"""

from __future__ import annotations

import json
import logging
from urllib.parse import urlencode

from vacancy_bot.models import SearchQuery, Vacancy
from vacancy_bot.sources.http_client import HttpClient, HttpError
from vacancy_bot.sources.rabota_by import apply_job_posting, parse_job_posting
from vacancy_bot.textutil import normalize

logger = logging.getLogger("vacancy_bot")

LIST_URL = "https://career.habr.com/api/frontend/vacancies"
VACANCY_URL = "https://career.habr.com/vacancies/{vacancy_id}"
USER_AGENT = "VacancyBot/1.0 (staverviktor17@gmail.com)"

BELARUS_MARKERS = (
    "беларус",
    "минск",
    "гомель",
    "гродно",
    "витебск",
    "могилев",
    "брест",
)

WORLDWIDE_MARKERS = (
    "беларус",
    "минск",
    "любая стран",
    "любой стран",
    "по всему миру",
    "из любой",
    "любая локац",
    "worldwide",
    "anywhere",
    "снг",
)


def is_belarus_place(name: str) -> bool:
    sample = normalize(name)
    return any(marker in sample for marker in BELARUS_MARKERS)


def description_allows_belarus(text: str) -> bool:
    sample = normalize(text)
    return any(marker in sample for marker in WORLDWIDE_MARKERS)


def vacancy_from_habr_item(item: dict) -> Vacancy | None:
    locations = [place.get("title") or "" for place in item.get("locations") or []]
    remote = bool(item.get("remoteWork"))
    in_belarus = any(is_belarus_place(name) for name in locations)
    if not in_belarus and not (remote and not locations):
        return None
    skills = [skill.get("title") or "" for skill in item.get("skills") or []]
    divisions = [division.get("title") or "" for division in item.get("divisions") or []]
    vacancy_id = str(item.get("id") or "")
    qualification = item.get("qualification") or ""
    area = ", ".join(name for name in locations if name)
    return Vacancy(
        source="habr",
        vacancy_id=vacancy_id,
        title=item.get("title") or "",
        company=(item.get("company") or {}).get("title") or "",
        url=VACANCY_URL.format(vacancy_id=vacancy_id),
        area=area,
        description=" ".join(part for part in skills + divisions if part),
        remote=remote or in_belarus and remote,
        skills=[skill for skill in skills if skill],
        listed_level=str(qualification),
        needs_geo_confirmation=remote and not in_belarus,
    )


class HabrCareerSource:
    name = "habr"

    def __init__(self, client: HttpClient | None = None, pages: int = 1) -> None:
        self.client = client or HttpClient(USER_AGENT)
        self.pages = pages

    def search(self, query: SearchQuery) -> list[Vacancy]:
        found: list[Vacancy] = []
        for page in range(1, self.pages + 1):
            url = f"{LIST_URL}?{urlencode({'q': query.text, 'page': page})}"
            try:
                payload = self.client.get(url, headers={"Accept": "application/json"})
            except HttpError as error:
                logger.warning("Хабр Карьера %s для %s", error.status, query.text)
                break
            data = json.loads(payload)
            for item in data.get("list") or []:
                vacancy = vacancy_from_habr_item(item)
                if vacancy is not None:
                    found.append(vacancy)
            total_pages = int((data.get("meta") or {}).get("totalPages") or 1)
            if page >= total_pages:
                break
        return found

    def enrich(self, vacancy: Vacancy) -> Vacancy:
        if not vacancy.url:
            return vacancy
        try:
            html = self.client.get(vacancy.url)
        except HttpError as error:
            logger.warning("страница Хабр Карьеры %s вернула %s", vacancy.url, error.status)
            return vacancy
        updated = apply_job_posting(vacancy, parse_job_posting(html))
        if updated.needs_geo_confirmation and description_allows_belarus(updated.text_blob()):
            updated.needs_geo_confirmation = False
            if not updated.area:
                updated.area = "Remote"
            updated.remote = True
        return updated
