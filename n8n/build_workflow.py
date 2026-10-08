"""Собрать импортируемый workflow n8n из n8n/decide.js."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DECIDE_PATH = ROOT / "decide.js"
WORKFLOW_PATH = ROOT / "vacancy-agent.workflow.json"

ADAPTER = r"""
const incoming = $input.all();
const rows = [];

function fromHabr(item) {
  const locations = (item.locations || []).map((place) => place.title || "").filter(Boolean);
  const remote = Boolean(item.remoteWork);
  const place = locations.join(", ");
  const inBelarus = /беларус|минск|гомел|гродн|витебск|могилев|брест/i.test(place);
  if (!inBelarus && !(remote && locations.length === 0)) return null;
  const skills = (item.skills || []).map((skill) => skill.title || "").filter(Boolean);
  const href = item.href || "";
  return {
    title: item.title || "",
    company: (item.company || {}).title || "",
    url: href.startsWith("http") ? href : href ? "https://career.habr.com" + href : "",
    area: place,
    remote,
    description: skills.join(", "),
    source: "habr",
  };
}

for (const item of incoming) {
  const raw = item.json || {};
  if (raw.mode === "test") {
    for (const decision of decideBatch(examples())) {
      rows.push({ ...decision, mode: "test" });
    }
    continue;
  }
  let chatId = raw.chatId || "";
  if (!chatId) {
    try {
      chatId = $("Настройки").first().json.chatId || "";
    } catch (error) {
      chatId = "";
    }
  }
  const vacancies = (raw.list || []).map(fromHabr).filter(Boolean);
  for (const decision of decideBatch(vacancies)) {
    rows.push({ ...decision, mode: "live", chatId });
  }
}

let memory = { seen: [] };
try {
  memory = $getWorkflowStaticData("global");
  memory.seen = memory.seen || [];
} catch (error) {
  memory = { seen: [] };
}
const seen = new Set(memory.seen);
const output = [];
for (const row of rows) {
  if (row.action === "send" && row.mode === "live" && row.url && seen.has(row.url)) {
    row.action = "drop";
    row.dropReason = "уже отправляли в прошлом запуске";
    row.text = "";
  }
  if (row.action === "send" && row.mode === "live" && row.url) seen.add(row.url);
  output.push({ json: row });
}
memory.seen = Array.from(seen).slice(-500);
return output.length ? output : [{ json: { action: "drop", dropReason: "в этом прогоне нечего отправлять", mode: rows[0] ? rows[0].mode : "live" } }];
"""


def decide_source() -> str:
    source = DECIDE_PATH.read_text(encoding="utf-8")
    marker = 'if (typeof module !== "undefined"'
    if marker not in source:
        raise SystemExit("в decide.js нет блока module.exports")
    return source.split(marker)[0].rstrip() + "\n"


def node(name: str, type_name: str, type_version: float, position: list[int], parameters: dict, credentials: dict | None = None) -> dict:
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
    return payload


def build() -> dict:
    code = decide_source() + "\n" + ADAPTER
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
                        "2. Зовет инструмент: открытый список вакансий Хабр Карьеры.\n"
                        "3. Сам решает, что отправить, а что выкинуть.\n"
                        "4. Помнит уже отправленные ссылки.\n"
                        "5. Пишет в бота «AI вакансии».\n\n"
                        "Пока workflow выключен, по расписанию ничего не уходит. "
                        "Кнопка теста работает и у выключенного workflow."
                    ),
                    "height": 280,
                    "width": 420,
                    "color": 4,
                },
            ),
            node(
                "Как тестировать",
                "n8n-nodes-base.stickyNote",
                1,
                [480, -40],
                {
                    "content": (
                        "## Три проверки\n\n"
                        "**Тест на примерах** — учебные вакансии. В Telegram ничего не пишет. "
                        "Откройте узел «Решение» и посмотрите action: send или drop.\n\n"
                        "**Боевой прогон сейчас** — живой Хабр и сообщения в бот. "
                        "Сначала создайте credential Telegram с токеном бота и в узле "
                        "«Настройки» проверьте chat id.\n\n"
                        "**Пн и Чт 06:00** — то же самое, но само. Сработает только если "
                        "workflow включен и n8n в этот момент запущен."
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
                "Решение",
                "n8n-nodes-base.code",
                2,
                [1040, 520],
                {"language": "javaScript", "jsCode": code},
            ),
            node(
                "Отправлять",
                "n8n-nodes-base.if",
                2.2,
                [1320, 700],
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
                [1580, 640],
                {
                    "chatId": "={{ $json.chatId }}",
                    "text": "={{ $json.text }}",
                    "additionalFields": {"disable_web_page_preview": True},
                },
                credentials={"telegramApi": {"name": "AI вакансии"}},
            ),
        ],
        "connections": {
            "Тест на примерах": {
                "main": [[{"node": "Режим теста", "type": "main", "index": 0}]]
            },
            "Режим теста": {
                "main": [[{"node": "Решение", "type": "main", "index": 0}]]
            },
            "Пн и Чт 06:00": {
                "main": [[{"node": "Настройки", "type": "main", "index": 0}]]
            },
            "Боевой прогон сейчас": {
                "main": [[{"node": "Настройки", "type": "main", "index": 0}]]
            },
            "Настройки": {
                "main": [[{"node": "Запросы", "type": "main", "index": 0}]]
            },
            "Запросы": {
                "main": [[{"node": "Хабр Карьера", "type": "main", "index": 0}]]
            },
            "Хабр Карьера": {
                "main": [[{"node": "Решение", "type": "main", "index": 0}]]
            },
            "Решение": {
                "main": [[{"node": "Отправлять", "type": "main", "index": 0}]]
            },
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
