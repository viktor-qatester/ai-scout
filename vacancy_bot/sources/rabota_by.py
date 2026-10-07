"""rabota.by: официальный API HeadHunter и, если API закрыт, выдача сайта.

Поиск идёт по всей Беларуси (area=16), без ограничения одним Минском.
Описание дочитывается из JSON-LD страницы вакансии: это стабильная
разметка JobPosting, а не вёрстка карточки.
"""

from __future__ import annotations

import json
import logging
import re
from urllib.parse import urlencode

from vacancy_bot.models import SearchQuery, Vacancy
from vacancy_bot.sources.http_client import HttpClient, HttpError
from vacancy_bot.textutil import strip_html, vacancy_id_from_url

logger = logging.getLogger("vacancy_bot")

BELARUS_AREA = "16"
API_URL = "https://api.hh.ru/vacancies"
SEARCH_URL = "https://rabota.by/search/vacancy"
USER_AGENT = "VacancyBot/1.0 (staverviktor17@gmail.com)"


def vacancy_from_api_item(item: dict) -> Vacancy:
    snippet = item.get("snippet") or {}
    description = strip_html(
        f"{snippet.get('requirement') or ''} {snippet.get('responsibility') or ''}"
    )
    schedule = (item.get("schedule") or {}).get("id") or ""
    work_formats = item.get("work_format") or []
    remote = schedule == "remote" or any(
        (fmt or {}).get("id") in {"REMOTE", "remote"} for fmt in work_formats
    )
    url = item.get("alternate_url") or ""
    if url.startswith("https://hh.ru/"):
        url = "https://rabota.by/" + url[len("https://hh.ru/") :]
    experience = item.get("experience") or {}
    return Vacancy(
        source="rabota.by",
        vacancy_id=str(item.get("id") or vacancy_id_from_url(url)),
        title=item.get("name") or "",
        company=(item.get("employer") or {}).get("name") or "",
        url=url.split("?")[0],
        area=(item.get("area") or {}).get("name") or "",
        description=description,
        experience_id=experience.get("id") or "",
        experience_label=experience.get("name") or "",
        remote=remote,
    )


def parse_search_html(html: str) -> list[Vacancy]:
    parts = re.split(r'data-qa="vacancy-serp__vacancy"', html)
    vacancies: list[Vacancy] = []
    for chunk in parts[1:]:
        window = chunk[:12000]
        url_match = re.search(r'href="(https://(?:rabota\.by|hh\.ru)/vacancy/\d+[^"]*)"', window)
        title_match = re.search(
            r'data-qa="serp-item__title-text"[^>]*>(.*?)</span>',
            window,
            re.DOTALL,
        )
        if not url_match or not title_match:
            continue
        url = strip_html(url_match.group(1)).split("?")[0]
        if url.startswith("https://hh.ru/"):
            url = "https://rabota.by/" + url[len("https://hh.ru/") :]
        company_match = re.search(
            r'data-qa="vacancy-serp__vacancy-employer(?:-text)?"[^>]*>(.*?)</',
            window,
            re.DOTALL,
        )
        address_match = re.search(
            r'data-qa="vacancy-serp__vacancy-address"[^>]*>(.*?)</span>',
            window,
            re.DOTALL,
        )
        experience_match = re.search(
            r'data-qa="vacancy-serp__vacancy-work-experience-([^"]+)"[^>]*>(.*?)</',
            window,
            re.DOTALL,
        )
        vacancies.append(
            Vacancy(
                source="rabota.by",
                vacancy_id=vacancy_id_from_url(url),
                title=strip_html(title_match.group(1)),
                company=strip_html(company_match.group(1)) if company_match else "",
                url=url,
                area=strip_html(address_match.group(1)) if address_match else "",
                experience_id=experience_match.group(1) if experience_match else "",
                experience_label=strip_html(experience_match.group(2)) if experience_match else "",
                remote="vacancy-label-work-schedule-remote" in window,
            )
        )
    return vacancies


def parse_job_posting(html: str) -> dict:
    for match in re.finditer(
        r'<script type="application/ld\+json">(.*?)</script>',
        html,
        re.DOTALL,
    ):
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if isinstance(item, dict) and item.get("@type") == "JobPosting":
                return item
    return {}


def apply_job_posting(vacancy: Vacancy, posting: dict) -> Vacancy:
    if not posting:
        return vacancy
    description = strip_html(str(posting.get("description") or ""))
    if description:
        vacancy.description = description
    organization = posting.get("hiringOrganization") or {}
    if isinstance(organization, dict) and organization.get("name") and not vacancy.company:
        vacancy.company = str(organization["name"])
    if posting.get("jobLocationType") == "TELECOMMUTE":
        vacancy.remote = True
    location = posting.get("jobLocation") or {}
    if isinstance(location, dict):
        address = location.get("address") or {}
        if isinstance(address, dict):
            locality = address.get("addressLocality") or ""
            if locality and not vacancy.area:
                vacancy.area = str(locality)
    if posting.get("title") and not vacancy.title:
        vacancy.title = str(posting["title"])
    return vacancy


class RabotaBySource:
    name = "rabota.by"

    def __init__(self, client: HttpClient | None = None) -> None:
        self.client = client or HttpClient(USER_AGENT)
        self._api_blocked = False

    def search(self, query: SearchQuery) -> list[Vacancy]:
        experiences = query.experiences or ("",)
        found: list[Vacancy] = []
        for experience in experiences:
            if self._api_blocked:
                found.extend(self._search_html(query.text, experience))
                continue
            try:
                found.extend(self._search_api(query.text, experience))
            except HttpError as error:
                if error.status in {401, 403}:
                    logger.info(
                        "API rabota.by ответил %s, дальше читаю HTML-выдачу",
                        error.status,
                    )
                    self._api_blocked = True
                    found.extend(self._search_html(query.text, experience))
                else:
                    logger.warning("rabota.by API %s для %s", error.status, query.text)
        return found

    def enrich(self, vacancy: Vacancy) -> Vacancy:
        if not vacancy.url:
            return vacancy
        try:
            html = self.client.get(vacancy.url)
        except HttpError as error:
            logger.warning("страница вакансии %s вернула %s", vacancy.url, error.status)
            return vacancy
        return apply_job_posting(vacancy, parse_job_posting(html))

    def _search_api(self, text: str, experience: str) -> list[Vacancy]:
        params: list[tuple[str, str]] = [
            ("host", "rabota.by"),
            ("area", BELARUS_AREA),
            ("text", text),
            ("search_field", "name"),
            ("search_field", "description"),
            ("per_page", "20"),
            ("page", "0"),
            ("order_by", "publication_time"),
        ]
        if experience:
            params.append(("experience", experience))
        url = f"{API_URL}?{urlencode(params)}"
        payload = self.client.get(
            url,
            headers={"HH-User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        data = json.loads(payload)
        return [vacancy_from_api_item(item) for item in data.get("items") or []]

    def _search_html(self, text: str, experience: str) -> list[Vacancy]:
        params: list[tuple[str, str]] = [
            ("text", text),
            ("area", BELARUS_AREA),
            ("search_field", "name"),
            ("search_field", "description"),
            ("items_on_page", "20"),
            ("order_by", "publication_time"),
        ]
        if experience:
            params.append(("experience", experience))
        url = f"{SEARCH_URL}?{urlencode(params)}"
        html = self.client.get(url)
        return parse_search_html(html)
