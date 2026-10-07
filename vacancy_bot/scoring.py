from __future__ import annotations

import re

from vacancy_bot.classify import has_ai_tools, has_python_or_sql
from vacancy_bot.models import Vacancy
from vacancy_bot.seniority import (
    junior_markers,
    no_experience_required,
    senior_penalty,
    years_between_1_and_3,
)
from vacancy_bot.textutil import normalize

HIGH_SCORE = 6
MEDIUM_SCORE = 3
MIN_SCORE = 1

TIER_LABELS = {
    "high": "🔥 Высокое совпадение",
    "medium": "⭐ Стоит посмотреть",
    "low": "ℹ️ Возможно подходит",
}


def tier_for(score: int) -> str | None:
    if score >= HIGH_SCORE:
        return "high"
    if score >= MEDIUM_SCORE:
        return "medium"
    if score >= MIN_SCORE:
        return "low"
    return None


def score_vacancy(vacancy: Vacancy, category: str | None) -> tuple[int, list[str], bool]:
    text = vacancy.text_blob()
    reasons: list[str] = []
    score = 0
    junior = junior_markers(text, vacancy.experience_id) or category == "AI Entry Level"
    if junior:
        score += 3
        reasons.append("junior-friendly")
    if category == "AI + QA":
        score += 3
    if vacancy.remote:
        score += 2
        reasons.append("удалённо")
    if no_experience_required(text, vacancy.experience_id):
        score += 2
        reasons.append("без опыта")
    if years_between_1_and_3(text, vacancy.experience_id) and not no_experience_required(
        text, vacancy.experience_id
    ):
        score += 1
        reasons.append("опыт 1–3 года")
    if has_python_or_sql(text):
        score += 1
        reasons.append("Python/SQL")
    if has_ai_tools(text):
        score += 1
        reasons.append("AI/LLM")
    if category in {"QA", "AI + QA"} and "тестирование" not in reasons:
        reasons.append("тестирование")
    if vacancy.experience_id == "between3And6" and not junior:
        score -= 2
    score += senior_penalty(vacancy.title, vacancy.description)
    return score, reasons, junior


def experience_display(vacancy: Vacancy, junior: bool) -> str:
    text = vacancy.text_blob()
    if no_experience_required(text, vacancy.experience_id):
        return "без опыта"
    if re_intern(text):
        return "Стажировка"
    if years_between_1_and_3(text, vacancy.experience_id):
        if junior:
            return "Junior / 1–3 года"
        return "1–3 года"
    if junior and vacancy.experience_label:
        return vacancy.experience_label
    if junior:
        return "Junior"
    if vacancy.experience_label:
        return vacancy.experience_label
    return "не указан"


def re_intern(text: str) -> bool:
    return bool(re.search(r"(стажировк|\bintern\b|\btrainee\b)", normalize(text)))


def format_display(vacancy: Vacancy) -> str:
    area = (vacancy.area or "").strip()
    if vacancy.remote and area:
        return f"{area} / Remote"
    if vacancy.remote:
        return "Remote / Беларусь"
    if area:
        return area
    return "Беларусь"


def reason_lines(reasons: list[str]) -> list[str]:
    order = [
        "AI/LLM",
        "тестирование",
        "junior-friendly",
        "удалённо",
        "без опыта",
        "опыт 1–3 года",
        "Python/SQL",
    ]
    return [reason for reason in order if reason in reasons]
