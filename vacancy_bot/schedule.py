"""Расписание запуска.

Единственное место, где задан график. Раннер читает эти константы и не
подменяет их. Тот же cron стоит в n8n-агенте: понедельник и четверг, 06:00
по Минску.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# Понедельник и четверг, 06:00 по Минску. День недели в cron: 1 = пн, 4 = чт.
SCAN_CRON = "0 6 * * 1,4"
SCAN_TIMEZONE = "Europe/Minsk"


def parse_cron(cron: str) -> tuple[int, list[int], set[int] | None]:
    parts = cron.split()
    if len(parts) != 5:
        raise ValueError(f"ожидалось 5 полей cron, получено: {cron}")
    minute = int(parts[0])
    hours = [int(hour) for hour in parts[1].split(",")]
    weekdays = _cron_weekdays(parts[4])
    return minute, hours, weekdays


def _cron_weekdays(field: str) -> set[int] | None:
    """Дни cron (0 и 7 — воскресенье) в номера datetime.weekday()."""
    if field == "*":
        return None
    days: set[int] = set()
    for part in field.split(","):
        cron_day = int(part)
        if cron_day == 7:
            cron_day = 0
        days.add((cron_day - 1) % 7)
    return days


def next_run(
    now: datetime,
    cron: str = SCAN_CRON,
    timezone_name: str = SCAN_TIMEZONE,
) -> datetime:
    """Ближайший момент запуска строго после `now`."""
    minute, hours, weekdays = parse_cron(cron)
    zone = ZoneInfo(timezone_name)
    local = now.astimezone(zone)
    candidates: list[datetime] = []
    for offset in range(8):
        day = (local + timedelta(days=offset)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        if weekdays is not None and day.weekday() not in weekdays:
            continue
        for hour in hours:
            candidate = day.replace(hour=hour, minute=minute)
            if candidate > local:
                candidates.append(candidate)
    if not candidates:
        raise ValueError(f"нет ближайшего запуска для {cron}")
    return min(candidates)
