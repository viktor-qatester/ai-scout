from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timezone

from vacancy_bot.dedup import SeenStore
from vacancy_bot.notify import build_notifier
from vacancy_bot.pipeline import DETAIL_FETCH_LIMIT, run_scan
from vacancy_bot.queries import ALL_QUERIES
from vacancy_bot.schedule import SCAN_CRON, SCAN_TIMEZONE, next_run
from vacancy_bot.sources.habr_career import HabrCareerSource
from vacancy_bot.sources.http_client import HttpClient
from vacancy_bot.sources.rabota_by import USER_AGENT, RabotaBySource

logger = logging.getLogger("vacancy_bot")


def configured_schedule() -> str:
    return SCAN_CRON


def build_sources() -> list:
    client = HttpClient(USER_AGENT)
    return [RabotaBySource(client), HabrCareerSource(HttpClient(USER_AGENT))]


def execute(dry_run: bool, detail_limit: int) -> None:
    store = SeenStore("data/seen.sqlite")
    notifier = build_notifier(dry_run=dry_run)
    try:
        stats = run_scan(
            build_sources(),
            store,
            notifier,
            queries=ALL_QUERIES,
            detail_limit=detail_limit,
            persist=not dry_run,
        )
    finally:
        store.close()
    print(stats.summary())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Поиск junior QA и junior AI вакансий")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="показать уведомления и не записывать их как отправленные",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help=f"повторять поиск по расписанию {SCAN_CRON} ({SCAN_TIMEZONE})",
    )
    parser.add_argument("--detail-limit", type=int, default=DETAIL_FETCH_LIMIT)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logger.info("расписание %s (%s)", configured_schedule(), SCAN_TIMEZONE)
    if not args.loop:
        execute(args.dry_run, args.detail_limit)
        return
    while True:
        execute(args.dry_run, args.detail_limit)
        moment = next_run(datetime.now(timezone.utc))
        pause = max(1.0, (moment - datetime.now(timezone.utc)).total_seconds())
        logger.info("следующий запуск %s", moment.isoformat())
        time.sleep(pause)


if __name__ == "__main__":
    main()
