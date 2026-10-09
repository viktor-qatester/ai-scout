const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = JSON.parse(
  fs.readFileSync(path.join(__dirname, "vacancy-agent.workflow.json"), "utf-8"),
);

function codeOf(name) {
  const node = workflow.nodes.find((item) => item.name === name);
  assert.ok(node, `нет узла ${name}`);
  return node.parameters.jsCode;
}

function runNode(name, { items, previous = {}, memory = {} }) {
  const fn = new Function(
    "$input",
    "$",
    "$getWorkflowStaticData",
    `"use strict";\n${codeOf(name)}`,
  );
  const input = { all: () => items.map((json) => ({ json })) };
  const lookup = (nodeName) => {
    const rows = previous[nodeName];
    if (!rows) throw new Error(`узел ${nodeName} не запускался`);
    return { all: () => rows.map((json) => ({ json })), first: () => ({ json: rows[0] }) };
  };
  return fn(input, lookup, () => memory);
}

const habrList = {
  list: [
    { id: 1, title: "Junior QA", href: "/vacancies/1", remoteWork: true, locations: null, qualification: "Junior", skills: [{ title: "Python" }], company: { title: "Alpha" } },
    { id: 2, title: "QA Lead", href: "/vacancies/2", remoteWork: true, locations: null, qualification: "Lead", company: { title: "Beta" } },
    { id: 3, title: "QA Engineer", href: "/vacancies/3", remoteWork: false, locations: [{ title: "Минск" }], qualification: "Junior", company: { title: "Gamma" } },
  ],
};

function page(text) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    description: text,
    jobLocation: { address: { addressCountry: { name: "Россия" } } },
  })}</script>`;
}

test("в схеме есть узлы подготовки и загрузки страницы, Telegram без подписи n8n", () => {
  const names = workflow.nodes.map((node) => node.name);
  assert.ok(names.includes("Подготовка"));
  assert.ok(names.includes("Страница вакансии"));
  const telegram = workflow.nodes.find((node) => node.name === "Telegram");
  assert.equal(telegram.parameters.additionalFields.appendAttribution, false);
  assert.deepEqual(
    Object.keys(workflow.connections["Хабр Карьера"]),
    ["main"],
  );
  assert.equal(workflow.connections["Хабр Карьера"].main[0][0].node, "Подготовка");
  assert.equal(workflow.connections["Подготовка"].main[0][0].node, "Страница вакансии");
  assert.equal(workflow.connections["Страница вакансии"].main[0][0].node, "Решение");
});

test("Подготовка отбрасывает Lead и берёт chatId из «Настройки»", () => {
  const out = runNode("Подготовка", {
    items: [habrList],
    previous: { Настройки: [{ chatId: "777" }] },
    memory: { seen: [] },
  });
  assert.deepEqual(
    out.map((row) => row.json.url),
    ["https://career.habr.com/vacancies/1", "https://career.habr.com/vacancies/3"],
  );
  assert.equal(out[0].json.chatId, "777");
  assert.equal(out[0].json.mode, "live");
});

test("Подготовка пропускает уже отправленные ссылки", () => {
  const out = runNode("Подготовка", {
    items: [habrList],
    previous: { Настройки: [{ chatId: "777" }] },
    memory: { seen: ["https://career.habr.com/vacancies/1"] },
  });
  assert.deepEqual(out.map((row) => row.json.url), ["https://career.habr.com/vacancies/3"]);
});

test("Решение в боевом режиме читает страницы по порядку и запоминает отправленное", () => {
  const prepared = runNode("Подготовка", {
    items: [habrList],
    previous: { Настройки: [{ chatId: "777" }] },
    memory: { seen: [] },
  }).map((row) => row.json);
  const memory = { seen: [] };
  const out = runNode("Решение", {
    items: [
      { data: page("Тестирование API. Можно из Беларуси.") },
      { data: page("Тестирование API. Только для граждан РФ.") },
    ],
    previous: { Подготовка: prepared },
    memory,
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].json.action, "send");
  assert.equal(out[0].json.chatId, "777");
  assert.equal(out[0].json.mode, "live");
  assert.equal(out[1].json.action, "send");
  assert.deepEqual(memory.seen.sort(), [
    "https://career.habr.com/vacancies/1",
    "https://career.habr.com/vacancies/3",
  ]);
});

test("Решение в тестовом режиме ничего не запоминает и не требует Подготовку", () => {
  const memory = { seen: [] };
  const out = runNode("Решение", {
    items: [{ mode: "test" }],
    previous: {},
    memory,
  });
  assert.equal(out.length, 13);
  assert.ok(out.every((row) => row.json.mode === "test"));
  assert.ok(out.some((row) => row.json.action === "send"));
  assert.ok(out.some((row) => row.json.action === "drop"));
  assert.deepEqual(memory.seen, []);
});

test("Решение: повторный запуск не шлёт ту же ссылку второй раз", () => {
  const prepared = [
    {
      title: "Junior QA",
      company: "A",
      url: "https://career.habr.com/vacancies/50",
      area: "Минск",
      remote: false,
      level: "Junior",
      description: "Python",
      chatId: "777",
    },
  ];
  const memory = { seen: ["https://career.habr.com/vacancies/50"] };
  const out = runNode("Решение", {
    items: [{ data: page("Тестирование.") }],
    previous: { Подготовка: prepared },
    memory,
  });
  assert.equal(out[0].json.action, "drop");
  assert.match(out[0].json.dropReason, /уже отправляли/);
});
