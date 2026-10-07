"""Поисковые запросы.

QA-направление хранится отдельно от AI и всегда выполняется вместе с ним.
География задаётся источником: вся Беларусь, не только Минск.
"""

from __future__ import annotations

from vacancy_bot.models import SearchQuery

# Исходный QA-поиск. Эти формулировки должны оставаться в прогоне.
QA_QUERIES: tuple[SearchQuery, ...] = (
    SearchQuery("Junior QA", "qa"),
    SearchQuery("стажировка тестировщик", "qa"),
    SearchQuery("QA инженер", "qa", ("noExperience", "between1And3")),
    SearchQuery("тестировщик", "qa", ("noExperience", "between1And3")),
    SearchQuery("инженер по тестированию", "qa", ("noExperience", "between1And3")),
)

AI_QUERIES: tuple[SearchQuery, ...] = (
    SearchQuery("Junior AI", "ai"),
    SearchQuery("AI Engineer", "ai", ("noExperience", "between1And3")),
    SearchQuery("AI Specialist", "ai", ("noExperience", "between1And3")),
    SearchQuery("AI Intern", "ai"),
    SearchQuery("Prompt Engineer", "ai", ("noExperience", "between1And3")),
    SearchQuery("LLM", "ai", ("noExperience", "between1And3")),
    SearchQuery("Generative AI", "ai", ("noExperience", "between1And3")),
    SearchQuery("искусственный интеллект", "ai", ("noExperience", "between1And3")),
    SearchQuery("нейросети", "ai", ("noExperience", "between1And3")),
    SearchQuery("внедрение ИИ", "ai"),
    SearchQuery("AI QA", "ai"),
    SearchQuery("AI Tester", "ai"),
    SearchQuery("AI Quality", "ai"),
    SearchQuery("LLM Evaluation", "ai"),
    SearchQuery("Data Annotator", "ai"),
    SearchQuery("AI Trainer", "ai"),
    SearchQuery("Machine Learning", "ai", ("noExperience", "between1And3")),
    SearchQuery("Data Scientist", "ai", ("noExperience", "between1And3")),
    SearchQuery("RAG", "ai", ("noExperience", "between1And3")),
)

ALL_QUERIES: tuple[SearchQuery, ...] = QA_QUERIES + AI_QUERIES
