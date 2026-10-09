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
  assert.equal(workflow.connections["Хабр Карьера"].main[0][0].node, "Другие источники");
  assert.equal(workflow.connections["Другие источники"].main[0][0].node, "Подготовка");
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

const rabotaHtml = `<div data-qa="vacancy-serp__vacancy"><a href="https://rabota.by/vacancy/111?query=x"></a>
<span data-qa="serp-item__title-text">Junior QA</span>
<span data-qa="vacancy-serp__vacancy-employer-text">Alpha</span>
<span data-qa="vacancy-serp__vacancy-address">Минск</span>
<span data-qa="vacancy-serp__vacancy-work-experience-noExperience">Без опыта</span></div>`;

const pracaHtml = `<li class="locationDepended vac-small"><a href="/vacancy/222/?q=1" target="_blank"><h2>QA стажировка</h2></a>
<a href="/organization/1/" class="vac-small__organization">ООО Бета</a>
<div class="vacancy__search-description">Обучение тестированию</div>
<div class="vac-small__experience"><i></i>Опыт работы не имеет значения</div>
<div class="vac-small__city"><i></i>Гомель</div></li>`;

const himalayasJson = JSON.stringify({
  jobs: [
    { title: "Junior QA", companyName: "Gamma", seniority: ["Entry-level"], locationRestrictions: [], guid: "https://himalayas.app/g/1", description: "<p>Manual testing</p>" },
    { title: "QA Intern", companyName: "Delta", seniority: ["Entry-level"], locationRestrictions: ["Brazil"], guid: "https://himalayas.app/g/2", description: "x" },
  ],
});

const hhHtml = `<div data-qa="vacancy-serp__vacancy"><a href="https://hh.ru/vacancy/333?query=1"></a>
<span data-qa="serp-item__title-text">Junior QA</span>
<span data-qa="vacancy-serp__vacancy-employer-text">Ромашка</span>
<span data-qa="vacancy-serp__vacancy-address">Москва</span>
<span data-qa="vacancy-label-work-schedule-remote">Можно удалённо</span>
<span data-qa="vacancy-serp__vacancy-work-experience-noExperience">Без опыта</span></div>
<div data-qa="vacancy-serp__vacancy"><a href="https://hh.ru/vacancy/334"></a>
<span data-qa="serp-item__title-text">Junior QA офис</span>
<span data-qa="vacancy-serp__vacancy-address">Москва</span></div>`;

const wwrXml = `<rss><channel><item><title>Eps: QA Intern</title><region>Anywhere in the World</region><country></country>
<link>https://weworkremotely.com/remote-jobs/eps-qa</link><description><![CDATA[<p>Testing</p>]]></description></item>
<item><title>Zed: QA Engineer</title><region>USA Only</region><country>United States</country><link>https://weworkremotely.com/x</link><description>y</description></item></channel></rss>`;

async function runSources(fetcher) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction("$input", "$", `"use strict";\n${codeOf("Другие источники")}`);
  const input = { all: () => [{ json: { list: [] } }] };
  const lookup = () => ({ all: () => [{ json: { q: "Junior QA" } }] });
  return fn.call({ helpers: { httpRequest: async ({ url }) => fetcher(url) } }, input, lookup);
}

test("Другие источники: четыре источника собираются в единый вид", async () => {
  const out = await runSources((url) => {
    if (url.includes("rabota.by")) return rabotaHtml;
    if (url.includes("praca.by")) return pracaHtml;
    if (url.includes("himalayas")) return himalayasJson;
    if (url.includes("hh.ru")) return hhHtml;
    return wwrXml;
  });
  const batches = Object.fromEntries(
    out.filter((row) => row.json.vacancies).map((row) => [row.json.source, row.json.vacancies]),
  );
  assert.equal(batches["rabota.by"][0].url, "https://rabota.by/vacancy/111");
  assert.equal(batches["rabota.by"][0].level, "Junior");
  assert.equal(batches["praca.by"][0].area, "Гомель");
  assert.deepEqual([...new Set(batches.himalayas.map((v) => v.url))], ["https://himalayas.app/g/1"]);
  assert.deepEqual([...new Set(batches["hh.ru"].map((v) => v.url))], ["https://hh.ru/vacancy/333"]);
  assert.equal(batches["hh.ru"][0].remote, true);
  assert.deepEqual(batches.weworkremotely.map((v) => v.company), ["Eps"]);
  assert.equal(batches.weworkremotely[0].company, "Eps");
});

test("Другие источники: упавший источник не ломает остальные и попадает в отчёт", async () => {
  const out = await runSources((url) => {
    if (url.includes("praca.by")) throw new Error("HTTP 503");
    return url.includes("rabota.by") ? rabotaHtml : url.includes("himalayas") ? himalayasJson : wwrXml;
  });
  const report = out.find((row) => row.json.source === "report").json;
  assert.ok(report.errors.some((line) => line.startsWith("praca.by")));
  assert.ok(out.some((row) => row.json.source === "rabota.by"));
});

test("Подготовка берёт вакансии всех источников и не грузит страницы Himalayas", () => {
  const out = runNode("Подготовка", {
    items: [
      habrList,
      { source: "rabota.by", vacancies: [{ title: "Junior QA", company: "A", url: "https://rabota.by/vacancy/1", area: "Минск", remote: false, level: "Junior", description: "", source: "rabota.by" }] },
      { source: "himalayas", vacancies: [{ title: "QA Intern", company: "B", url: "https://himalayas.app/x", area: "", remote: true, level: "Junior", description: "Remote, worldwide.", source: "himalayas", noPage: true }] },
      { source: "report", errors: [] },
    ],
    previous: { Настройки: [{ chatId: "1" }] },
    memory: { seen: [] },
  });
  const urls = out.map((row) => row.json.url);
  assert.ok(urls.includes("https://rabota.by/vacancy/1"));
  assert.ok(urls.includes("https://himalayas.app/x"));
  assert.equal(out.find((row) => row.json.url === "https://himalayas.app/x").json.noPage, true);
});
