"""Уровень вакансии.

Senior/Lead в заголовке или как явное требование отсекаются.
Упоминание senior только про команду, при junior-вакансии, вакансию не режет.
Опыт 1–3 года сам по себе вакансию не отбрасывает. 5+ лет — отбрасывает.
"""

from __future__ import annotations

import re

from vacancy_bot.textutil import normalize

_TITLE_SENIOR = re.compile(
    r"("
    r"\b(senior|сеньор|sr)\b|"
    r"\b(lead|leader|тимлид|team\s*lead|tech\s*lead)\b|"
    r"\b(principal|staff)\b|"
    r"\b(architect|архитектор)\b|"
    r"\bhead\s+of\b|\bhead\b|"
    r"\b(начальник|директор|руководитель|главный|главная|ведущий|ведущая)\b"
    r")",
    re.IGNORECASE,
)

_TITLE_JUNIOR = re.compile(
    r"("
    r"\b(junior|jr|intern|trainee|entry)\b|junior\+|"
    r"стажер|стажировк|без опыта"
    r")",
    re.IGNORECASE,
)

_JUNIOR_TEXT = re.compile(
    r"("
    r"\b(junior|jr|intern|internship|trainee|entry\s*level)\b|junior\+|"
    r"стажер|стажировк|без опыта|опыт не требуется|опыт не обязател|"
    r"до 1 года|менее года|начинающ"
    r")",
    re.IGNORECASE,
)

_NO_EXPERIENCE = re.compile(
    r"(без опыта|опыт не требуется|опыт не обязател|no experience|не требуется опыт)",
    re.IGNORECASE,
)

_TEAM_CONTEXT = re.compile(
    r"("
    r"(работ\w*|общаться|взаимодейств\w*|вместе)\s+с\s+.{0,40}?"
    r"(senior|сеньор|lead|лид\w*)\s+\w+|"
    r"(в команде|команда|под руководством|наставни\w*|ментор\w*).{0,60}?"
    r"(senior|сеньор|lead|лид\w*)|"
    r"(senior|сеньор)\s+(разработчик\w*|developer\w*|инженер\w*|коллег\w*|команд\w*)"
    r")",
    re.IGNORECASE,
)

_EXPLICIT_SENIOR = re.compile(
    r"("
    r"(senior|сеньор|lead|principal|staff|architect|архитектор)"
    r"[\s-]*(level|уровн\w*|грейд|grade)|"
    r"(ищем|требуется|требуются|нужен|нужна|позиция|роль|уровень|грейд|"
    r"looking for|we need|required).{0,40}"
    r"(senior|сеньор|lead|principal|staff|architect|архитектор)"
    r")",
    re.IGNORECASE,
)

_YEARS_RANGE = re.compile(
    r"(?<![\d.,])(\d+)\s*[-–]\s*(\d+)\s*(?:лет|года|год|years)",
    re.IGNORECASE,
)
_EXPERIENCE_HINT = re.compile(r"(опыт|experience|требуется|requirements)", re.IGNORECASE)
_YEARS_AFTER_EXPERIENCE = re.compile(
    r"(?:опыт\w*|experience).{0,40}?"
    r"(?:от|более|больше|не менее|минимум|minimum|at least)?\s*(?<![\d.,])(\d+)\s*\+?\s*(?:лет|года|год|years)",
    re.IGNORECASE,
)
_YEARS_BEFORE_EXPERIENCE = re.compile(
    r"(?:от|не менее|минимум|minimum|at least)\s+(?<![\d.,])(\d+)\s*\+?\s*(?:лет|года|год|years)"
    r".{0,20}?(?:опыт|experience)",
    re.IGNORECASE,
)
_YEARS_PLUS = re.compile(
    r"(?<![\d.,])(\d+)\s*\+?\s*(?:лет|года|год|years)(?:\s+of)?\s*(?:commercial\s+)?(?:experience|опыт)",
    re.IGNORECASE,
)

_HARD_LEVELS = {"senior", "lead", "principal", "staff", "head", "architect"}


def title_is_junior(title: str) -> bool:
    return bool(_TITLE_JUNIOR.search(normalize(title)))


def title_is_hard_senior(title: str) -> bool:
    sample = normalize(title)
    if not _TITLE_SENIOR.search(sample):
        return False
    if title_is_junior(title):
        return False
    return True


def listed_level_is_hard(listed_level: str, title: str) -> bool:
    level = normalize(listed_level)
    if not level:
        return False
    if title_is_junior(title):
        return False
    return any(token in level for token in _HARD_LEVELS)


def strip_team_context(text: str) -> str:
    return _TEAM_CONTEXT.sub(" ", text or "")


def _experience_window(sample: str, start: int, end: int) -> bool:
    window = sample[max(0, start - 40) : min(len(sample), end + 40)]
    return bool(_EXPERIENCE_HINT.search(window))


def minimum_years(text: str) -> int | None:
    """Нижняя граница требуемого опыта.

    Возраст компании («более 10 лет на рынке») и срок роста («через 1.5–2 года»)
    не считаются требованием к кандидату.
    """
    sample = normalize(strip_team_context(text))
    found: list[int] = []
    for match in _YEARS_AFTER_EXPERIENCE.finditer(sample):
        found.append(int(match.group(1)))
    for match in _YEARS_BEFORE_EXPERIENCE.finditer(sample):
        found.append(int(match.group(1)))
    for match in _YEARS_PLUS.finditer(sample):
        found.append(int(match.group(1)))
    for match in _YEARS_RANGE.finditer(sample):
        if _experience_window(sample, match.start(), match.end()):
            found.append(int(match.group(1)))
    if not found:
        return None
    return min(found)


def years_between_1_and_3(text: str, experience_id: str = "") -> bool:
    if experience_id == "between1And3":
        return True
    sample = normalize(text)
    for match in _YEARS_RANGE.finditer(sample):
        if not _experience_window(sample, match.start(), match.end()):
            continue
        low = int(match.group(1))
        high = int(match.group(2))
        if low <= 3 and high <= 3:
            return True
    return False


def no_experience_required(text: str, experience_id: str = "") -> bool:
    if experience_id == "noExperience":
        return True
    return bool(_NO_EXPERIENCE.search(normalize(text)))


def junior_markers(text: str, experience_id: str = "") -> bool:
    if experience_id == "noExperience":
        return True
    return bool(_JUNIOR_TEXT.search(normalize(text)))


def explicit_senior_requirement(text: str) -> bool:
    cleaned = strip_team_context(text or "")
    return bool(_EXPLICIT_SENIOR.search(normalize(cleaned)))


def hard_reject(title: str, description: str, experience_id: str = "", listed_level: str = "") -> bool:
    if title_is_hard_senior(title) or listed_level_is_hard(listed_level, title):
        return True
    if experience_id == "moreThan6":
        return True
    years = minimum_years(description)
    if years is not None and years >= 5:
        return True
    if explicit_senior_requirement(description):
        return True
    return False


def senior_penalty(title: str, description: str) -> int:
    """Штраф, если senior/lead остались не как описание команды.

    Junior-вакансию этот штраф не трогает: слово senior в тексте команды
    уже вычищено и не должно понижать подходящую позицию.
    """
    if title_is_junior(title) or junior_markers(title):
        return 0
    cleaned = normalize(strip_team_context(description))
    penalty = 0
    if re.search(r"\b(lead|тимлид|team\s*lead|tech\s*lead|principal)\b", cleaned):
        penalty -= 4
    elif re.search(r"\b(senior|сеньор)\b", cleaned):
        penalty -= 3
    return penalty
