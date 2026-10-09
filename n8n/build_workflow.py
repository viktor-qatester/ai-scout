"""Собрать импортируемый workflow n8n из n8n/decide.js."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DECIDE_PATH = ROOT / "decide.js"
WORKFLOW_PATH = ROOT / "vacancy-agent.workflow.json"

PREPARE_TAIL = r"""
const memory = $getWorkflowStaticData("global");
const alreadySent = memory.seen || [];
let chatId = "";
try {
  chatId = $("Настройки").first().json.chatId || "";
} catch (error) {
  chatId = "";
}
const lists = $input.all().map((item) => item.json || {});
const candidates = selectCandidates(lists, alreadySent);
return candidates.map((vacancy) => ({ json: { ...vacancy, chatId, mode: "live" } }));
"""

DECIDE_TAIL = r"""
const items = $input.all();
const head = items[0] ? items[0].json || {} : {};
let rows;
if (head.mode === "test") {
  rows = decideBatch(examples()).map((row) => ({ ...row, mode: "test", chatId: "" }));
} else {
  const prepared = $("Подготовка").all().map((item) => item.json);
  const bodies = items.map((item) =>
    item.json && typeof item.json.data === "string" ? item.json.data : "",
  );
  const decisions = decideLive(prepared, bodies);
  rows = decisions.map((row, index) => ({
    ...row,
    mode: "live",
    chatId: prepared[index].chatId,
  }));
}

const memory = $getWorkflowStaticData("global");
const seen = new Set(memory.seen || []);
const output = [];
for (const row of rows) {
  if (row.mode === "live" && row.action === "send" && row.url && seen.has(row.url)) {
    row.action = "drop";
    row.dropReason = "уже отправляли в прошлом запуске";
    row.text = "";
  }
  if (row.mode === "live" && row.action === "send" && row.url) seen.add(row.url);
  output.push({ json: row });
}
memory.seen = Array.from(seen).slice(-500);
return output;
"""


def decide_source() -> str:
    source = DECIDE_PATH.read_text(encoding="utf-8")
    marker = 'if (typeof module !== "undefined"'
    if marker not in source:
        raise SystemExit("в decide.js нет блока module.exports")
    return source.split(marker)[0].rstrip() + "\n"


def node(
    name: str,
    type_name: str,
    type_version: float,
    position: list[int],
    parameters: dict,
    credentials: dict | None = None,
    extra: dict | None = None,
) -> dict:
    payload = {
        "id": name,
        "name": name,
        "type": type_name,
        "typeVersion": type_version,
        "position": position,
        "parameters": parameters,
    }
    if credentials:
        payload["credentials"] = credentials
    if extra:
        payload.update(extra)
    return payload


def link(target: str) -> list[list[dict]]:
    return [[{"node": target, "type": "main", "index": 0}]]


def build() -> dict:
    shared = decide_source()
    return {
        "name": "AI вакансии",
        "active": False,
        "settings": {
            "executionOrder": "v1",
            "timezone": "Europe/Minsk",
        },
        "nodes": [
            node(
                "Как устроен агент",
                "n8n-nodes-base.stickyNote",
                1,
                [-80, -40],
                {
                    "content": (
                        "## Агент, не разовый скрипт\n\n"
                        "1. Просыпается сам: понедельник и четверг в 06:00 по Минску.\n"
                        "2. Зовёт инструмент: открытый список вакансий Хабр Карьеры.\n"
                        "3. Отсекает Lead, Senior и Middle по карточке, потом читает страницу вакансии.\n"
                        "4. Решает: отправить или выкинуть. Смотрит страну и текст.\n"
                        "5. Помнит уже отправленные ссылки.\n"
                        "6. Пишет в бота «AI вакансии».\n\n"
                        "Пока workflow выключен, по расписанию ничего не уходит. "
                        "Кнопка теста работает и у выключенного workflow."
                    ),
                    "height": 300,
                    "width": 440,
                    "color": 4,
                },
            ),
            node(
                "Как тестировать",
                "n8n-nodes-base.stickyNote",
                1,
                [500, -40],
                {
                    "content": (
                        "## Три проверки\n\n"
                        "**Тест на примерах** — учебные вакансии. В Telegram ничего не пишет. "
                        "Откройте узел «Решение» и посмотрите action: send или drop.\n\n"
                        "**Боевой прогон сейчас** — живой Хабр и сообщения в бот. "
                        "В узле Telegram должен быть доступ с токеном бота.\n\n"
                        "**Пн и Чт 06:00** — то же самое, но само. Сработает только если "
                        "workflow опубликован."
                    ),
                    "height": 300,
                    "width": 460,
                    "color": 5,
                },
            ),
            node("Тест на примерах", "n8n-nodes-base.manualTrigger", 1, [0, 360], {}),
            node(
                "Режим теста",
                "n8n-nodes-base.set",
                3.4,
                [260, 360],
                {
                    "assignments": {
                        "assignments": [
                            {
                                "id": "mode",
                                "name": "mode",
                                "value": "test",
                                "type": "string",
                            }
                        ]
                    },
                    "options": {},
                },
            ),
            node(
                "Пн и Чт 06:00",
                "n8n-nodes-base.scheduleTrigger",
                1.2,
                [0, 620],
                {
                    "rule": {
                        "interval": [
                            {
                                "field": "cronExpression",
                                "expression": "0 6 * * 1,4",
                            }
                        ]
                    }
                },
            ),
            node("Боевой прогон сейчас", "n8n-nodes-base.manualTrigger", 1, [0, 860], {}),
            node(
                "Настройки",
                "n8n-nodes-base.set",
                3.4,
                [280, 740],
                {
                    "assignments": {
                        "assignments": [
                            {
                                "id": "chat-id",
                                "name": "chatId",
                                "value": "7332843350",
                                "type": "string",
                            }
                        ]
                    },
                    "options": {},
                },
            ),
            node(
                "Запросы",
                "n8n-nodes-base.code",
                2,
                [520, 740],
                {
                    "language": "javaScript",
                    "jsCode": (
                        "const queries = [\n"
                        "  'Junior QA',\n"
                        "  'стажировка тестировщик',\n"
                        "  'Junior AI',\n"
                        "  'AI QA',\n"
                        "  'внедрение ИИ',\n"
                        "  'Data Annotator',\n"
                        "];\n"
                        "const chatId = $json.chatId || '';\n"
                        "return queries.map((q) => ({ json: { q, chatId } }));\n"
                    ),
                },
            ),
            node(
                "Хабр Карьера",
                "n8n-nodes-base.httpRequest",
                4.2,
                [760, 740],
                {
                    "method": "GET",
                    "url": "https://career.habr.com/api/frontend/vacancies",
                    "sendQuery": True,
                    "queryParameters": {
                        "parameters": [
                            {"name": "q", "value": "={{ $json.q }}"},
                            {"name": "page", "value": "1"},
                        ]
                    },
                    "sendHeaders": True,
                    "headerParameters": {
                        "parameters": [
                            {"name": "Accept", "value": "application/json"},
                            {
                                "name": "User-Agent",
                                "value": "VacancyBot/1.0 (staverviktor17@gmail.com)",
                            },
                        ]
                    },
                    "options": {},
                },
            ),
            node(
                "Подготовка",
                "n8n-nodes-base.code",
                2,
                [1000, 740],
                {"language": "javaScript", "jsCode": shared + "\n" + PREPARE_TAIL},
            ),
            node(
                "Страница вакансии",
                "n8n-nodes-base.httpRequest",
                4.2,
                [1240, 740],
                {
                    "method": "GET",
                    "url": "={{ $json.url }}",
                    "sendHeaders": True,
                    "headerParameters": {
                        "parameters": [
                            {"name": "Accept", "value": "text/html"},
                            {
                                "name": "User-Agent",
                                "value": "VacancyBot/1.0 (staverviktor17@gmail.com)",
                            },
                        ]
                    },
                    "options": {
                        "batching": {"batch": {"batchSize": 1, "batchInterval": 700}},
                        "response": {
                            "response": {
                                "responseFormat": "text",
                                "outputPropertyName": "data",
                            }
                        },
                        "timeout": 20000,
                    },
                },
                extra={"onError": "continueRegularOutput"},
            ),
            node(
                "Решение",
                "n8n-nodes-base.code",
                2,
                [1500, 520],
                {"language": "javaScript", "jsCode": shared + "\n" + DECIDE_TAIL},
            ),
            node(
                "Отправлять",
                "n8n-nodes-base.if",
                2.2,
                [1760, 700],
                {
                    "conditions": {
                        "options": {
                            "caseSensitive": True,
                            "leftValue": "",
                            "typeValidation": "strict",
                            "version": 2,
                        },
                        "conditions": [
                            {
                                "id": "action-send",
                                "leftValue": "={{ $json.action }}",
                                "rightValue": "send",
                                "operator": {"type": "string", "operation": "equals"},
                            },
                            {
                                "id": "mode-live",
                                "leftValue": "={{ $json.mode }}",
                                "rightValue": "live",
                                "operator": {"type": "string", "operation": "equals"},
                            },
                        ],
                        "combinator": "and",
                    },
                    "options": {},
                },
            ),
            node(
                "Telegram",
                "n8n-nodes-base.telegram",
                1.2,
                [2020, 640],
                {
                    "chatId": "={{ $json.chatId }}",
                    "text": "={{ $json.text }}",
                    "additionalFields": {
                        "disable_web_page_preview": True,
                        "appendAttribution": False,
                    },
                },
                credentials={"telegramApi": {"name": "AI вакансии"}},
            ),
        ],
        "connections": {
            "Тест на примерах": {"main": link("Режим теста")},
            "Режим теста": {"main": link("Решение")},
            "Пн и Чт 06:00": {"main": link("Настройки")},
            "Боевой прогон сейчас": {"main": link("Настройки")},
            "Настройки": {"main": link("Запросы")},
            "Запросы": {"main": link("Хабр Карьера")},
            "Хабр Карьера": {"main": link("Подготовка")},
            "Подготовка": {"main": link("Страница вакансии")},
            "Страница вакансии": {"main": link("Решение")},
            "Решение": {"main": link("Отправлять")},
            "Отправлять": {
                "main": [
                    [{"node": "Telegram", "type": "main", "index": 0}],
                    [],
                ]
            },
        },
        "pinData": {},
        "meta": {"templateCredsSetupCompleted": False},
    }


def main() -> None:
    WORKFLOW_PATH.write_text(
        json.dumps(build(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
