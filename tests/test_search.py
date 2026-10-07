import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from vacancy_bot import __main__ as entrypoint
from vacancy_bot.classify import category_for
from vacancy_bot.dedup import SeenStore
from vacancy_bot.evaluate import evaluate
from vacancy_bot.messages import format_notification
from vacancy_bot.models import SearchQuery, Vacancy
from vacancy_bot.notify import MemoryNotifier
from vacancy_bot.pipeline import VacancySource, run_scan
from vacancy_bot.queries import AI_QUERIES, QA_QUERIES
from vacancy_bot.schedule import SCAN_CRON, next_run
from vacancy_bot.sources.habr_career import description_allows_belarus, vacancy_from_habr_item
from vacancy_bot.sources.rabota_by import (
    apply_job_posting,
    parse_job_posting,
    parse_search_html,
    vacancy_from_api_item,
)


class ListSource(VacancySource):
    name = "fake"

    def __init__(self, by_track: dict[str, list[Vacancy]]) -> None:
        self.by_track = by_track
        self.tracks: set[str] = set()

    def search(self, query: SearchQuery) -> list[Vacancy]:
        self.tracks.add(query.track)
        return list(self.by_track.get(query.track, []))

    def enrich(self, vacancy: Vacancy) -> Vacancy:
        return vacancy


def vacancy(**kwargs) -> Vacancy:
    payload = dict(
        source="fake",
        vacancy_id="1",
        title="",
        company="Example",
        url="https://rabota.by/vacancy/1",
        area="Минск",
        description="",
        experience_id="",
        remote=False,
    )
    payload.update(kwargs)
    return Vacancy(**payload)


def titles(messages: list[str]) -> str:
    return "\n".join(messages)


def test_existing_qa_search_still_matches():
    item = vacancy(
        vacancy_id="qa-1",
        title="Junior QA Engineer",
        description="Ручное тестирование веб-приложений, SQL, без опыта",
        experience_id="noExperience",
        url="https://rabota.by/vacancy/qa-1",
    )
    evaluation = evaluate(item)
    assert evaluation.category == "QA"
    assert evaluation.rejected_senior is False
    assert evaluation.tier is not None
    assert "Junior QA" in {query.text for query in QA_QUERIES}
    assert "тестировщик" in {query.text for query in QA_QUERIES}


def test_junior_ai_is_found():
    item = vacancy(
        vacancy_id="ai-1",
        title="Junior AI Engineer",
        description="Python, ChatGPT API, удалённо",
        experience_id="noExperience",
        remote=True,
        url="https://rabota.by/vacancy/ai-1",
    )
    evaluation = evaluate(item)
    assert evaluation.category == "AI"
    assert evaluation.junior_friendly is True
    assert evaluation.tier == "high"
    message = format_notification(item, evaluation)
    assert "🤖 AI / Junior" in message
    assert "Junior AI Engineer" in message
    assert "🔥 Высокое совпадение" in message


def test_ai_qa_is_found():
    item = vacancy(
        vacancy_id="aiqa-1",
        title="AI Quality Engineer",
        company="Example",
        description="Тестирование LLM и оценка качества ответов. Junior, удалённо из Беларуси",
        experience_id="noExperience",
        remote=True,
        area="",
        url="https://rabota.by/vacancy/aiqa-1",
    )
    evaluation = evaluate(item)
    assert evaluation.category == "AI + QA"
    message = format_notification(item, evaluation)
    assert "🤖 AI + QA" in message
    assert "Компания: Example" in message
    assert "Формат: Remote / Беларусь" in message
    assert "⭐ Стоит посмотреть" in message or "🔥 Высокое совпадение" in message
    assert "Почему подходит:" in message
    assert "- AI/LLM" in message
    assert "- тестирование" in message
    assert "https://rabota.by/vacancy/aiqa-1" in message


def test_russian_ai_adoption_title_is_found():
    item = vacancy(
        title="Специалист по внедрению ИИ",
        description="Помогать бизнесу запускать сценарии на базе нейросетей. Стажировка.",
        url="https://rabota.by/vacancy/ai-ru",
        vacancy_id="ai-ru",
    )
    evaluation = evaluate(item)
    assert evaluation.category == "AI Entry Level"
    assert evaluation.rejected_senior is False
    assert evaluation.tier is not None


def test_data_annotator_is_found():
    item = vacancy(
        title="Data Annotator",
        description="Разметка данных для моделей. Опыт не требуется.",
        experience_id="noExperience",
        url="https://rabota.by/vacancy/annotator",
        vacancy_id="annotator",
    )
    evaluation = evaluate(item)
    assert evaluation.category == "AI Entry Level"
    assert evaluation.tier is not None


def test_senior_ai_engineer_is_not_sent(tmp_path):
    item = vacancy(
        title="Senior AI Engineer",
        description="5+ years, deep ML research, senior-level knowledge of production LLM systems",
        url="https://rabota.by/vacancy/senior-ai",
        vacancy_id="senior-ai",
        experience_id="moreThan6",
    )
    evaluation = evaluate(item)
    assert evaluation.rejected_senior is True
    source = ListSource({"ai": [item], "qa": []})
    notifier = MemoryNotifier()
    stats = run_scan(
        [source],
        SeenStore(tmp_path / "seen.sqlite"),
        notifier,
        queries=AI_QUERIES[:1],
    )
    assert notifier.messages == []
    assert stats.sent == 0
    assert stats.dropped_senior == 1


def test_junior_with_senior_teammates_is_kept():
    item = vacancy(
        title="Junior AI Engineer",
        description="Будет работа с Senior разработчиками и ревью от наставника. Python, LLM.",
        experience_id="noExperience",
        url="https://rabota.by/vacancy/junior-team",
        vacancy_id="junior-team",
    )
    evaluation = evaluate(item)
    assert evaluation.rejected_senior is False
    assert evaluation.category == "AI"
    assert evaluation.tier is not None


def test_ai_only_in_description_is_classified_as_ai():
    item = vacancy(
        title="Специалист по автоматизации",
        description="Нужна работа с LLM, ChatGPT API, AI-агентами и RAG. Опыт 1-3 года.",
        experience_id="between1And3",
        url="https://rabota.by/vacancy/automation",
        vacancy_id="automation",
    )
    assert category_for(item.text_blob()) == "AI"
    evaluation = evaluate(item)
    assert evaluation.category == "AI"
    assert evaluation.rejected_senior is False
    assert evaluation.tier is not None


def test_duplicates_are_not_sent_again(tmp_path):
    original = vacancy(
        title="Junior QA Engineer",
        company="Example",
        description="Тестирование API, SQL, без опыта",
        experience_id="noExperience",
        url="https://rabota.by/vacancy/77?from=search",
        vacancy_id="77",
    )
    store = SeenStore(tmp_path / "seen.sqlite")
    notifier = MemoryNotifier()
    queries = (SearchQuery("Junior QA", "qa"),)
    first = run_scan([ListSource({"qa": [original]})], store, notifier, queries=queries)
    assert first.sent == 1

    edited = vacancy(
        title="Junior QA Engineer",
        company="Example",
        description="Тестирование API, SQL, без опыта. Добавили абзац про команду.",
        experience_id="noExperience",
        url="https://rabota.by/vacancy/77?from=updated",
        vacancy_id="77",
    )
    second = run_scan([ListSource({"qa": [edited]})], store, MemoryNotifier(), queries=queries)
    assert second.sent == 0
    assert second.dropped_duplicate == 1

    same_title_other_url = vacancy(
        title="Junior QA Engineer",
        company="Example",
        description="Тестирование API",
        url="https://career.habr.com/vacancies/999",
        vacancy_id="999",
        source="habr",
    )
    third = run_scan(
        [ListSource({"qa": [same_title_other_url]})],
        store,
        MemoryNotifier(),
        queries=queries,
    )
    assert third.sent == 0
    assert third.dropped_duplicate == 1


def test_schedule_stays_wired_and_unchanged():
    assert SCAN_CRON == "0 9,15,21 * * *"
    assert entrypoint.configured_schedule() == SCAN_CRON
    morning = datetime(2026, 10, 7, 8, 30, tzinfo=ZoneInfo("Europe/Minsk"))
    assert next_run(morning).hour == 9
    evening = datetime(2026, 10, 7, 22, 0, tzinfo=ZoneInfo("Europe/Minsk"))
    following = next_run(evening)
    assert following.day == 8
    assert following.hour == 9


def test_both_tracks_are_searched(tmp_path):
    source = ListSource({"qa": [], "ai": []})
    run_scan([source], SeenStore(tmp_path / "seen.sqlite"), MemoryNotifier())
    assert source.tracks == {"qa", "ai"}
    assert AI_QUERIES
    assert QA_QUERIES


def test_log_line_has_required_counters(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    qa = vacancy(
        title="QA Junior",
        description="Тестирование, без опыта",
        experience_id="noExperience",
        url="https://rabota.by/vacancy/10",
        vacancy_id="10",
    )
    senior = vacancy(
        title="Lead QA",
        description="Руководство тестированием",
        url="https://rabota.by/vacancy/11",
        vacancy_id="11",
    )
    run_scan(
        [ListSource({"qa": [qa, senior, qa], "ai": []})],
        SeenStore(tmp_path / "seen.sqlite"),
        MemoryNotifier(),
        queries=(SearchQuery("Junior QA", "qa"),),
    )
    assert "найдено всего=" in caplog.text
    assert "QA=" in caplog.text
    assert "AI=" in caplog.text
    assert "AI+QA=" in caplog.text
    assert "отброшено Senior/Lead=" in caplog.text
    assert "отброшено дублей=" in caplog.text
    assert "отправлено=" in caplog.text


def test_one_to_three_years_is_not_dropped_by_itself():
    item = vacancy(
        title="AI Engineer",
        description="Опыт 1-3 года. Базовый Python и SQL, LLM-инструменты.",
        experience_id="between1And3",
        url="https://rabota.by/vacancy/mid-junior",
        vacancy_id="mid-junior",
    )
    evaluation = evaluate(item)
    assert evaluation.rejected_senior is False
    assert evaluation.category == "AI"
    assert evaluation.tier is not None


def test_company_age_and_growth_period_are_not_required_experience():
    company = vacancy(
        title="Специалист по внедрению ИИ",
        description=(
            "Наша компания на рынке уже более 10 лет. "
            "Ищем человека без опыта: разрабатывать, тестировать и внедрять AI-агентов."
        ),
        experience_id="noExperience",
        url="https://rabota.by/vacancy/vibe",
        vacancy_id="vibe",
    )
    evaluation = evaluate(company)
    assert evaluation.rejected_senior is False
    assert evaluation.category == "AI + QA"

    growth = vacancy(
        title="Junior Customer Support Specialist",
        description="Можно вырасти в менеджмент и другие роли через 1.5–2 года. Общаться с QA командой.",
        experience_id="noExperience",
        url="https://rabota.by/vacancy/support",
        vacancy_id="support",
    )
    assert evaluate(growth).rejected_senior is False
    assert evaluate(growth).category is None


def test_unrelated_profession_does_not_become_ai_from_a_side_mention():
    chemist = vacancy(
        title="Химик-технолог / Инженер-технолог",
        description="Мы активно используем ИИ в работе для поиска литературы.",
        url="https://rabota.by/vacancy/chem",
        vacancy_id="chem",
    )
    sales = vacancy(
        title="Менеджер по продажам серверного оборудования",
        description="Нужно продавать СХД, сети и ИИ-системы.",
        url="https://rabota.by/vacancy/sales",
        vacancy_id="sales",
    )
    developer = vacancy(
        title="Python Developer",
        description="В задачах LLM, ChatGPT API, AI-агенты и RAG. Опыт 1-3 года.",
        experience_id="between1And3",
        url="https://rabota.by/vacancy/py",
        vacancy_id="py",
    )
    assert evaluate(chemist).category is None
    assert evaluate(sales).category is None
    assert evaluate(developer).category == "AI"
    assert evaluate(developer).rejected_senior is False


def test_developer_mentioning_qa_team_is_not_qa():
    item = vacancy(
        title="Junior Android Developer",
        description="Collaborating with backend, QA, and product teams. Writing unit tests and UI testing.",
        experience_id="between1And3",
        url="https://rabota.by/vacancy/android",
        vacancy_id="android",
    )
    assert evaluate(item).category is None


def test_half_year_is_not_five_years():
    item = vacancy(
        title="QA engineer Тестировщик",
        description="Опыт работы на позиции QA-инженера от 0,5 года. Тестирование API.",
        experience_id="between1And3",
        url="https://rabota.by/vacancy/half",
        vacancy_id="half",
    )
    evaluation = evaluate(item)
    assert evaluation.rejected_senior is False
    assert evaluation.category == "QA"


def test_five_years_without_senior_in_title_is_rejected():
    item = vacancy(
        title="AI Engineer",
        description="Ищем инженера с опытом от 5 лет и глубоким ML research.",
        url="https://rabota.by/vacancy/five",
        vacancy_id="five",
    )
    assert evaluate(item).rejected_senior is True


def test_manufacturing_quality_is_not_software_qa():
    assert category_for("Инженер по качеству на производстве") is None
    assert category_for("Инженер по тестированию веб-приложений") == "QA"


def test_rabota_html_and_api_parsers():
    html = """
    <div data-qa="vacancy-serp__vacancy" class="card">
      <a data-qa="serp-item__title" href="https://rabota.by/vacancy/111?query=Junior+QA">
        <span data-qa="serp-item__title-text">QA Junior</span>
      </a>
      <data data-qa="vacancy-serp__vacancy-work-experience-noExperience">Без опыта</data>
      <a data-qa="vacancy-serp__vacancy-employer">Визутех</a>
      <span data-qa="vacancy-serp__vacancy-address">Минск</span>
      <span data-qa="vacancy-label-work-schedule-remote">Можно удалённо</span>
    </div>
    """
    parsed = parse_search_html(html)
    assert len(parsed) == 1
    assert parsed[0].title == "QA Junior"
    assert parsed[0].company == "Визутех"
    assert parsed[0].vacancy_id == "111"
    assert parsed[0].remote is True
    assert parsed[0].experience_id == "noExperience"
    assert parsed[0].url == "https://rabota.by/vacancy/111"

    api_item = vacancy_from_api_item(
        {
            "id": "222",
            "name": "Junior AI Engineer",
            "alternate_url": "https://hh.ru/vacancy/222",
            "area": {"name": "Гомель"},
            "experience": {"id": "between1And3", "name": "От 1 года до 3 лет"},
            "schedule": {"id": "remote"},
            "employer": {"name": "Example"},
            "snippet": {
                "requirement": "Python, LLM",
                "responsibility": "<highlighttext>RAG</highlighttext>",
            },
        }
    )
    assert api_item.url == "https://rabota.by/vacancy/222"
    assert api_item.area == "Гомель"
    assert api_item.remote is True
    assert "RAG" in api_item.description

    page = """
    <script type="application/ld+json">
    {"@type": "JobPosting", "title": "QA Junior",
     "description": "<p>Тестирование API и работа с LLM</p>",
     "jobLocationType": "TELECOMMUTE",
     "hiringOrganization": {"name": "Example"}}
    </script>
    """
    posting = parse_job_posting(page)
    enriched = apply_job_posting(parsed[0], posting)
    assert "LLM" in enriched.description
    assert enriched.remote is True


def test_habr_keeps_belarus_and_drops_other_cities():
    belarus = vacancy_from_habr_item(
        {
            "id": 5,
            "title": "Junior QA",
            "remoteWork": True,
            "qualification": "Junior",
            "company": {"title": "Local"},
            "locations": [{"title": "Минск"}],
            "skills": [{"title": "Python"}],
            "divisions": [],
        }
    )
    assert belarus is not None
    assert belarus.needs_geo_confirmation is False
    assert belarus.area == "Минск"

    moscow = vacancy_from_habr_item(
        {
            "id": 6,
            "title": "Junior QA",
            "remoteWork": True,
            "qualification": "Junior",
            "company": {"title": "Far"},
            "locations": [{"title": "Москва"}],
            "skills": [],
            "divisions": [],
        }
    )
    assert moscow is None
    assert description_allows_belarus("удалённо из любой страны, в том числе Беларусь")
    assert not description_allows_belarus("удалённо по России")
