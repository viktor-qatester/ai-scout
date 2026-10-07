"""Категория вакансии по заголовку и описанию.

Одна вакансия получает ровно одну категорию. Совпадение QA и AI
становится «AI + QA».
"""

from __future__ import annotations

import re

from vacancy_bot.textutil import normalize

_AI_QA = re.compile(
    r"("
    r"\bai\s*qa\b|\bqa\s*ai\b|\bai\s+tester\b|\bai\s+testing\b|"
    r"\bllm\s+qa\b|\bllm\s+tester\b|\bai\s+quality\b|"
    r"\bai\s+evaluation\b|\bllm\s+evaluation\b|\bmodel\s+evaluation\b|"
    r"\bai\s+evaluator\b|\bai\s+trainer\b|\bai\s+data\s+quality\b|"
    r"\bai\s+validation\b|\bai\s+test\s+engineer\b|"
    r"оценк\w+\s+(модел|llm|ии)|валидац\w+\s+(модел|llm|данн\w+\s+для\s+ai)|"
    r"(llm|нейросет\w*|chatgpt|gpt-\d).{0,40}тестирован|"
    r"тестирован\w.{0,40}(llm|нейросет\w*|chatgpt|модел\w+\s+ии)"
    r")",
    re.IGNORECASE,
)

_ENTRY = re.compile(
    r"("
    r"data annotat|разметк\w+\s+данн|ai\s+data\b|\bai\s+contributor\b|"
    r"\bai\s+content\s+reviewer\b|\bai\s+reviewer\b|\bai\s+assistant\b|"
    r"специалист по ии|специалист по нейросет|"
    r"специалист по внедрению ии|внедрени\w+\s+ии|"
    r"работ\w+\s+с\s+нейросет|специалист по искусствен\w+\s+интеллект"
    r")",
    re.IGNORECASE,
)

_ML = re.compile(
    r"("
    r"machine learning|\bml\b|data scientist|дата-?сайентист|"
    r"машинн\w+\s+обучен|\bjunior\s+ml\b|\bml\s+engineer\b|ml-инженер"
    r")",
    re.IGNORECASE,
)

_AI = re.compile(
    r"("
    r"\bai\b|artificial intelligence|\bgenai\b|generative ai|"
    r"\bllm\b|prompt engineer|prompt engineering|\brag\b|"
    r"chatgpt|gpt-\d|openai|нейросет|искусствен\w+\s+интеллект|"
    r"\bии\b|ai agent|ai-агент|applied ai"
    r")",
    re.IGNORECASE,
)

_QA_STRONG = re.compile(
    r"("
    r"\bqa\b|\baqa\b|\bsdet\b|quality assurance|quality engineer|"
    r"\btester\b|\btesting\b|тестиров|тестирован|"
    r"инженер по тестированию|специалист по тестированию|"
    r"software testing|manual qa|automation qa"
    r")",
    re.IGNORECASE,
)

_QA_WEAK = re.compile(
    r"(контроль качества|обеспечени\w+\s+качества|инженер по качеству|валидац\w+\s+данн)",
    re.IGNORECASE,
)

_SOFTWARE = re.compile(
    r"(программ|software|приложен|веб|web|api|баг|тест-кейс|selenium|postman|"
    r"мобильн|backend|frontend|систем\w+\s+управлен|sql|python)",
    re.IGNORECASE,
)

# Чужая профессия в заголовке: слово «тестирование» или «QA» в тексте команды
# не делает из разработчика или поддержки вакансию QA.
_OTHER_ROLE = re.compile(
    r"("
    r"\b(developer|разработчик|android|ios|frontend|backend|devops|sre)\b|"
    r"поддержк|support|seo|маркетолог|бухгалтер|дизайнер|"
    r"\bhr\b|рекрутер|продаж\w*|sales|копирайтер|юрист"
    r")",
    re.IGNORECASE,
)


def has_ai(text: str) -> bool:
    return bool(_AI.search(text) or _ML.search(text) or _AI_QA.search(text) or _ENTRY.search(text))


def has_qa(text: str) -> bool:
    if _QA_STRONG.search(text):
        return True
    if _QA_WEAK.search(text) and (_SOFTWARE.search(text) or has_ai(text)):
        return True
    return False


def _title_has_target(title: str) -> bool:
    return bool(
        _QA_STRONG.search(title)
        or _AI.search(title)
        or _AI_QA.search(title)
        or _ENTRY.search(title)
        or _ML.search(title)
    )


def title_is_other_profession(title: str) -> bool:
    sample = normalize(title)
    if not sample or _title_has_target(sample):
        return False
    return bool(_OTHER_ROLE.search(sample))


# Роль, для которой упоминание «используем ИИ» или «продаём ИИ» не делает вакансию AI.
_AI_NOISE_ROLE = re.compile(
    r"(химик|технолог|продаж|support|поддержк|\bseo\b|бухгалтер|маркетолог|"
    r"аудитор|юрист|\bhr\b|рекрутер)",
    re.IGNORECASE,
)


def title_blocks_ai(title: str) -> bool:
    sample = normalize(title)
    if not sample or _title_has_target(sample):
        return False
    return bool(_AI_NOISE_ROLE.search(sample))


def category_for(text: str, title: str | None = None) -> str | None:
    """Вернуть одну категорию или None, если вакансия не по теме."""
    sample = normalize(text)
    if not sample:
        return None
    role_title = normalize(title) if title is not None else sample.split("\n", 1)[0]
    other_role = title_is_other_profession(role_title)
    blocks_ai = title_blocks_ai(role_title)
    ai_qa = bool(_AI_QA.search(sample)) and not other_role and not blocks_ai
    qa = has_qa(sample) and not other_role
    ai = (not blocks_ai) and bool(
        _AI.search(sample) or _ENTRY.search(sample) or _ML.search(sample) or ai_qa
    )
    if ai_qa or (qa and ai):
        return "AI + QA"
    if not blocks_ai and _ENTRY.search(sample):
        return "AI Entry Level"
    if not blocks_ai and _ML.search(sample):
        return "ML / Data"
    if not blocks_ai and _AI.search(sample):
        return "AI"
    if qa:
        return "QA"
    return None


def has_python_or_sql(text: str) -> bool:
    return bool(re.search(r"\b(python|sql)\b", normalize(text)))


def has_ai_tools(text: str) -> bool:
    return bool(
        re.search(
            r"(\bllm\b|prompt|chatgpt|gpt-\d|\brag\b|нейросет|\bai\b|genai|openai)",
            normalize(text),
        )
    )
