from __future__ import annotations

from vacancy_bot.classify import category_for
from vacancy_bot.models import Evaluation, Vacancy
from vacancy_bot.scoring import (
    experience_display,
    format_display,
    reason_lines,
    score_vacancy,
    tier_for,
)
from vacancy_bot.seniority import hard_reject


def evaluate(vacancy: Vacancy) -> Evaluation:
    category = category_for(vacancy.text_blob(), vacancy.title)
    rejected = hard_reject(
        vacancy.title,
        vacancy.description,
        vacancy.experience_id,
        vacancy.listed_level,
    )
    score, reasons, junior = score_vacancy(vacancy, category)
    tier = None if rejected else tier_for(score)
    return Evaluation(
        category=category,
        score=score,
        tier=tier,
        reasons=reason_lines(reasons),
        rejected_senior=rejected,
        junior_friendly=junior,
        experience_display=experience_display(vacancy, junior),
        format_display=format_display(vacancy),
    )
