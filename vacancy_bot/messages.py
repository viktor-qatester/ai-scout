from __future__ import annotations

from vacancy_bot.models import Evaluation, Vacancy
from vacancy_bot.scoring import TIER_LABELS

_HEADERS = {
    "QA": "🧪 QA",
    "AI": "🤖 AI",
    "AI + QA": "🤖 AI + QA",
    "ML / Data": "🤖 ML / Data",
    "AI Entry Level": "🤖 AI / Начальный уровень",
}


def header_for(evaluation: Evaluation) -> str:
    if evaluation.category == "AI" and evaluation.junior_friendly:
        return "🤖 AI / Junior"
    if evaluation.category == "QA" and evaluation.junior_friendly:
        return "🧪 QA / Junior"
    return _HEADERS.get(evaluation.category or "", "🤖 Вакансия")


def format_notification(vacancy: Vacancy, evaluation: Evaluation) -> str:
    tier = TIER_LABELS.get(evaluation.tier or "", "")
    lines = [
        header_for(evaluation),
        "",
        vacancy.title.strip(),
        f"Компания: {vacancy.company.strip() or 'не указана'}",
        f"Формат: {evaluation.format_display}",
        f"Опыт: {evaluation.experience_display}",
        "",
        tier,
    ]
    if evaluation.reasons:
        lines.append("")
        lines.append("Почему подходит:")
        lines.extend(f"- {reason}" for reason in evaluation.reasons)
    lines.extend(["", "Источник:", vacancy.url.strip()])
    return "\n".join(lines).strip() + "\n"
