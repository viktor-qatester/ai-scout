"""Расписание запуска.

Единственное место, где задан график. Раннер читает эти константы и не
подменяет их. Внешний cron может вызывать `python -m vacancy_bot` с тем же
выражением.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# Три раза в день по минскому времени: утро, день, вечер.
SCAN_CRON = "0 9,15,21 * * *"
SCAN_TIMEZONE = "Europe/Minsk"


def parse_cron(cron: str) -> tuple[int, list[int]]:
    parts = cron.split()
    if len(parts) != 5:
        raise ValueError(f"ожидалось 5 полей cron, получено: {cron}")
    minute = int(parts[0])
    hours = [int(hour) for hour in parts[1].split(",")]
    return minute, hours


def next_run(
    now: datetime,
    cron: str = SCAN_CRON,
    timezone_name: str = SCAN_TIMEZONE,
) -> datetime:
    """Ближайший момент запуска строго после `now`."""
    minute, hours = parse_cron(cron)
    zone = ZoneInfo(timezone_name)
    local = now.astimezone(zone)
    candidates: list[datetime] = []
    for hour in hours:
        candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= local:
            candidate += timedelta(days=1)
        candidates.append(candidate)
    return min(candidates)
