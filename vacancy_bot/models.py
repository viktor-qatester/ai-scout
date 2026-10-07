from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SearchQuery:
    text: str
    track: str
    experiences: tuple[str, ...] = ()


@dataclass
class Vacancy:
    source: str
    vacancy_id: str
    title: str
    company: str
    url: str
    area: str = ""
    description: str = ""
    experience_id: str = ""
    experience_label: str = ""
    remote: bool = False
    skills: list[str] = field(default_factory=list)
    listed_level: str = ""
    needs_geo_confirmation: bool = False

    def text_blob(self) -> str:
        skills = " ".join(self.skills)
        return "\n".join(
            part for part in (self.title, self.description, skills, self.experience_label) if part
        )


@dataclass
class Evaluation:
    category: str | None
    score: int
    tier: str | None
    reasons: list[str]
    rejected_senior: bool
    junior_friendly: bool
    experience_display: str
    format_display: str


@dataclass
class ScanStats:
    found_raw: int = 0
    qa: int = 0
    ai: int = 0
    ai_qa: int = 0
    ml_data: int = 0
    ai_entry: int = 0
    dropped_senior: int = 0
    dropped_duplicate: int = 0
    dropped_irrelevant: int = 0
    dropped_low_score: int = 0
    dropped_geo: int = 0
    sent: int = 0

    def add_category(self, category: str | None) -> None:
        if category == "QA":
            self.qa += 1
        elif category == "AI":
            self.ai += 1
        elif category == "AI + QA":
            self.ai_qa += 1
        elif category == "ML / Data":
            self.ml_data += 1
        elif category == "AI Entry Level":
            self.ai_entry += 1

    def summary(self) -> str:
        return (
            f"найдено всего={self.found_raw} | QA={self.qa} | AI={self.ai} | "
            f"AI+QA={self.ai_qa} | ML/Data={self.ml_data} | AI Entry={self.ai_entry} | "
            f"отброшено Senior/Lead={self.dropped_senior} | "
            f"отброшено дублей={self.dropped_duplicate} | отправлено={self.sent} | "
            f"вне темы={self.dropped_irrelevant} | ниже порога={self.dropped_low_score} | "
            f"вне гео={self.dropped_geo}"
        )
