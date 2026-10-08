import json
from pathlib import Path

from n8n.build_workflow import WORKFLOW_PATH, build

ROOT = Path(__file__).resolve().parents[1]


def test_workflow_file_matches_builder():
    saved = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    assert saved == build()


def test_workflow_schedule_and_test_buttons():
    workflow = build()
    names = {node["name"] for node in workflow["nodes"]}
    assert {"Тест на примерах", "Боевой прогон сейчас", "Пн и Чт 06:00", "Решение", "Telegram"} <= names
    assert workflow["settings"]["timezone"] == "Europe/Minsk"
    assert workflow["active"] is False
    schedule = next(node for node in workflow["nodes"] if node["name"] == "Пн и Чт 06:00")
    expression = schedule["parameters"]["rule"]["interval"][0]["expression"]
    assert expression == "0 6 * * 1,4"
    blob = json.dumps(workflow, ensure_ascii=False)
    assert "TELEGRAM_BOT_TOKEN" not in blob
    assert "AAH_" not in blob
    decision = next(node for node in workflow["nodes"] if node["name"] == "Решение")
    source = (ROOT / "n8n" / "decide.js").read_text(encoding="utf-8")
    assert "function decideVacancy" in decision["parameters"]["jsCode"]
    assert source.split('if (typeof module !== "undefined"')[0].strip() in decision["parameters"]["jsCode"]
