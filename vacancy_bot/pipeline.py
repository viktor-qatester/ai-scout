from __future__ import annotations

import hashlib
import logging
from collections.abc import Sequence

from vacancy_bot.dedup import SeenStore, identity_keys
from vacancy_bot.evaluate import evaluate
from vacancy_bot.messages import format_notification
from vacancy_bot.models import ScanStats, SearchQuery, Vacancy
from vacancy_bot.notify import Notifier
from vacancy_bot.queries import ALL_QUERIES
from vacancy_bot.seniority import listed_level_is_hard, title_is_hard_senior

logger = logging.getLogger("vacancy_bot")

DETAIL_FETCH_LIMIT = 40


class VacancySource:
    name = "source"

    def search(self, query: SearchQuery) -> list[Vacancy]:
        raise NotImplementedError

    def enrich(self, vacancy: Vacancy) -> Vacancy:
        return vacancy


def _content_hash(vacancy: Vacancy) -> str:
    payload = f"{vacancy.title}\n{vacancy.description}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def _needs_description(vacancy: Vacancy) -> bool:
    return len((vacancy.description or "").strip()) < 180


def run_scan(
    sources: Sequence[VacancySource],
    store: SeenStore,
    notifier: Notifier,
    queries: Sequence[SearchQuery] = ALL_QUERIES,
    detail_limit: int = DETAIL_FETCH_LIMIT,
    persist: bool = True,
) -> ScanStats:
    stats = ScanStats()
    found: list[Vacancy] = []
    for source in sources:
        for query in queries:
            try:
                batch = source.search(query)
            except Exception:
                logger.exception("источник %s не ответил на запрос %s", source.name, query.text)
                continue
            found.extend(batch)
    stats.found_raw = len(found)

    unique: list[Vacancy] = []
    seen_in_run: set[str] = set()
    for vacancy in found:
        keys = identity_keys(vacancy)
        if any(key in seen_in_run for key in keys) or store.is_duplicate(vacancy):
            stats.dropped_duplicate += 1
            continue
        seen_in_run.update(keys)
        unique.append(vacancy)

    priority = sorted(unique, key=lambda item: (0 if _needs_description(item) else 1, item.title))
    fetches = 0
    source_by_name = {source.name: source for source in sources}
    for vacancy in priority:
        if title_is_hard_senior(vacancy.title) or listed_level_is_hard(
            vacancy.listed_level, vacancy.title
        ):
            continue
        if not _needs_description(vacancy) or fetches >= detail_limit:
            continue
        source = source_by_name.get(vacancy.source)
        if source is None:
            continue
        try:
            updated = source.enrich(vacancy)
        except Exception:
            logger.exception("не удалось дочитать вакансию %s", vacancy.url)
            continue
        fetches += 1
        vacancy.description = updated.description or vacancy.description
        vacancy.remote = vacancy.remote or updated.remote
        vacancy.area = vacancy.area or updated.area
        vacancy.company = vacancy.company or updated.company
        if updated.needs_geo_confirmation:
            vacancy.needs_geo_confirmation = True
        if updated.experience_id and not vacancy.experience_id:
            vacancy.experience_id = updated.experience_id

    for vacancy in unique:
        if vacancy.needs_geo_confirmation and not _geo_confirmed(vacancy):
            stats.dropped_geo += 1
            continue
        evaluation = evaluate(vacancy)
        stats.add_category(evaluation.category)
        if evaluation.rejected_senior:
            stats.dropped_senior += 1
            continue
        if evaluation.category is None:
            stats.dropped_irrelevant += 1
            continue
        if evaluation.tier is None:
            stats.dropped_low_score += 1
            continue
        message = format_notification(vacancy, evaluation)
        if notifier.send(message) and persist:
            store.mark_sent(vacancy, _content_hash(vacancy))
            stats.sent += 1
        elif not persist:
            stats.sent += 1

    logger.info(stats.summary())
    return stats


def _geo_confirmed(vacancy: Vacancy) -> bool:
    from vacancy_bot.sources.habr_career import description_allows_belarus

    return description_allows_belarus(vacancy.text_blob())
