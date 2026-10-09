const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decideBatch,
  decideLive,
  selectCandidates,
  adaptHabr,
  parseJobPosting,
  categoryFor,
  examples,
} = require("./decide.js");

function byUrl(decisions) {
  return Object.fromEntries(decisions.slice(0, -1).map((row) => [row.url, row]));
}

test("учебные вакансии расходятся на отправку и отказ", () => {
  const decisions = decideBatch(examples());
  const rows = byUrl(decisions);
  const url = (n) => `https://career.habr.com/vacancies/${n}`;

  assert.equal(rows[url(1)].action, "send");
  assert.equal(rows[url(1)].category, "QA");

  assert.equal(rows[url(2)].action, "drop");
  assert.match(rows[url(2)].dropReason, /senior|уровень/i);

  assert.equal(rows[url(3)].action, "send");
  assert.equal(rows[url(3)].category, "AI");
  assert.equal(rows[url(3)].geo, "confirmed");

  assert.equal(rows[url(4)].action, "send");
  assert.equal(rows[url(4)].category, "AI Entry Level");

  assert.equal(rows[url(5)].action, "send");
  assert.equal(rows[url(5)].category, "AI Entry Level");

  assert.equal(rows[url(6)].action, "send");
  assert.equal(rows[url(6)].category, "AI + QA");

  assert.equal(rows[url(7)].action, "drop");

  assert.equal(rows[url(8)].action, "send");
  assert.equal(rows[url(8)].category, "AI");

  assert.equal(rows[url(9)].action, "send");
  assert.equal(rows[url(9)].category, "QA");

  const duplicate = decisions[decisions.length - 1];
  assert.equal(duplicate.url, url(1));
  assert.equal(duplicate.action, "drop");
  assert.match(duplicate.dropReason, /уже была/);
});

test("уровень Lead из карточки Хабра отбрасывает вакансию без слова в названии", () => {
  const row = byUrl(decideBatch(examples()))["https://career.habr.com/vacancies/12"];
  assert.equal(row.action, "drop");
  assert.match(row.dropReason, /Lead/);
});

test("«только для граждан РФ» отбрасывается, удалёнка без страны уходит с пометкой", () => {
  const rows = byUrl(decideBatch(examples()));
  const russia = rows["https://career.habr.com/vacancies/13"];
  assert.equal(russia.action, "drop");
  assert.match(russia.dropReason, /РФ|не в Беларуси/);

  const unsure = rows["https://career.habr.com/vacancies/14"];
  assert.equal(unsure.action, "send");
  assert.equal(unsure.geo, "unconfirmed");
  assert.match(unsure.text, /уточните у работодателя/);
});

test("Middle в карточке не отправляется начинающему", () => {
  const [row] = decideBatch([
    {
      title: "QA Engineer",
      company: "Mid",
      url: "https://career.habr.com/vacancies/20",
      area: "Минск",
      remote: false,
      level: "Middle",
      description: "Тестирование веб-приложений.",
    },
  ]);
  assert.equal(row.action, "drop");
  assert.match(row.dropReason, /Middle/);
});

test("фраза про команду senior не выкидывает junior QA", () => {
  const [row] = decideBatch([
    {
      title: "Junior QA Engineer",
      company: "Team",
      url: "https://career.habr.com/vacancies/10",
      area: "Минск",
      remote: false,
      level: "Junior",
      description: "Работа с senior разработчиками. Функциональное тестирование.",
    },
  ]);
  assert.equal(row.action, "send");
  assert.equal(row.category, "QA");
});

test("возраст компании не считается стажем кандидата", () => {
  const [row] = decideBatch([
    {
      title: "Junior AI Engineer",
      company: "Old",
      url: "https://career.habr.com/vacancies/11",
      area: "Минск",
      remote: true,
      level: "Junior",
      description: "Компания на рынке более 10 лет. Нужен LLM и prompt.",
    },
  ]);
  assert.equal(row.action, "send");
});

test("кириллица в правилах работает: искусственный интеллект и ИИ", () => {
  assert.equal(
    categoryFor("Специалист по искусственному интеллекту", "Работа с нейросетями"),
    "AI Entry Level",
  );
  assert.equal(categoryFor("Стажёр по ИИ", "Помогаем внедрять ИИ в бизнес"), "AI");
});

test("карточка Хабра: удалёнка без страны проходит, чужой город нет, уровень сохраняется", () => {
  const remote = adaptHabr({
    id: 1,
    title: "QA",
    href: "/vacancies/1",
    remoteWork: true,
    locations: null,
    qualification: "Junior",
    skills: [{ title: "Python" }],
    company: { title: "Co" },
  });
  assert.equal(remote.level, "Junior");
  assert.equal(remote.url, "https://career.habr.com/vacancies/1");

  const elsewhere = adaptHabr({
    id: 2,
    title: "QA",
    href: "/vacancies/2",
    remoteWork: false,
    locations: [{ title: "Москва" }],
    qualification: "Junior",
  });
  assert.equal(elsewhere, null);

  const minsk = adaptHabr({
    id: 3,
    title: "QA",
    href: "/vacancies/3",
    remoteWork: false,
    locations: [{ title: "Минск" }],
    qualification: "Junior",
  });
  assert.equal(minsk.area, "Минск");
});

test("страница вакансии: описание и страна берутся из JSON-LD", () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    description: "<p>Ищем тестировщика. Можно работать из Беларуси.</p>",
    jobLocationType: "TELECOMMUTE",
    jobLocation: {
      address: { addressLocality: "Москва", addressCountry: { name: "Россия" } },
    },
  })}</script></html>`;
  const page = parseJobPosting(html);
  assert.equal(page.country, "Россия");
  assert.equal(page.remote, true);
  assert.match(page.description, /из Беларуси/);
});

test("боевой путь: описание страницы подтверждает Беларусь и сохраняет порядок", () => {
  const candidates = [
    {
      title: "QA Engineer",
      company: "A",
      url: "https://career.habr.com/vacancies/31",
      area: "",
      remote: true,
      level: "Junior",
      description: "Python",
    },
    {
      title: "QA Engineer",
      company: "B",
      url: "https://career.habr.com/vacancies/32",
      area: "",
      remote: true,
      level: "Junior",
      description: "Python",
    },
  ];
  const page = (text) =>
    `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      description: text,
      jobLocation: { address: { addressCountry: { name: "Россия" } } },
    })}</script>`;
  const rows = decideLive(candidates, [
    page("Тестирование API. Принимаем кандидатов из Беларуси."),
    page("Тестирование API. Только для граждан РФ."),
  ]);
  assert.equal(rows[0].url, candidates[0].url);
  assert.equal(rows[0].action, "send");
  assert.equal(rows[0].geo, "confirmed");
  assert.equal(rows[1].action, "drop");
});

test("боевой путь: ошибка страницы не ломает прогон", () => {
  const rows = decideLive(
    [
      {
        title: "Junior QA Engineer",
        company: "A",
        url: "https://career.habr.com/vacancies/41",
        area: "",
        remote: true,
        level: "Junior",
        description: "Python",
      },
    ],
    [undefined],
  );
  assert.equal(rows[0].action, "send");
  assert.equal(rows[0].geo, "unconfirmed");
});

test("подготовка: Lead и Middle не загружают страницу, уже отправленное пропускается", () => {
  const list = {
    list: [
      { id: 1, title: "QA", href: "/vacancies/1", remoteWork: true, locations: null, qualification: "Lead" },
      { id: 2, title: "QA", href: "/vacancies/2", remoteWork: true, locations: null, qualification: "Middle" },
      { id: 3, title: "QA", href: "/vacancies/3", remoteWork: true, locations: null, qualification: "Junior" },
      { id: 4, title: "QA", href: "/vacancies/4", remoteWork: true, locations: null, qualification: "Intern" },
      { id: 3, title: "QA", href: "/vacancies/3", remoteWork: true, locations: null, qualification: "Junior" },
    ],
  };
  const picked = selectCandidates([list], ["https://career.habr.com/vacancies/4"]);
  assert.deepEqual(
    picked.map((row) => row.url),
    ["https://career.habr.com/vacancies/3"],
  );
});

test("карточка важнее названия: «Junior/Mid Sales» с уровнем Senior отбрасывается", () => {
  const [row] = decideBatch([
    {
      title: "Junior/Mid Sales Representative (Remote)",
      company: "Keepgo",
      url: "https://career.habr.com/vacancies/60",
      area: "",
      remote: true,
      level: "Senior",
      description: "Продажи мобильного интернета. Используем AI.",
    },
  ]);
  assert.equal(row.action, "drop");
  assert.match(row.dropReason, /Senior/);
});

test("уровень не указан и нет признаков junior: вакансия не отправляется", () => {
  const [row] = decideBatch([
    {
      title: "Data Scientist / AI Engineer (LLM)",
      company: "Staff",
      url: "https://career.habr.com/vacancies/61",
      area: "",
      remote: true,
      level: "",
      description: "Python, PyTorch, LLM, NLP. Удалённо.",
    },
  ]);
  assert.equal(row.action, "drop");
  assert.match(row.dropReason, /признаков junior нет/);
});

test("уровень не указан, но в тексте стажировка: вакансия отправляется", () => {
  const [row] = decideBatch([
    {
      title: "Специалист по ИИ",
      company: "Lab",
      url: "https://career.habr.com/vacancies/62",
      area: "Минск",
      remote: false,
      level: "",
      description: "Стажировка. Работа с нейросетями.",
    },
  ]);
  assert.equal(row.action, "send");
});

test("продавец с упоминанием ИИ в тексте не становится AI-вакансией", () => {
  assert.equal(
    categoryFor("Sales Representative", "Продаём решения на базе искусственного интеллекта и AI"),
    null,
  );
});

test("опыт «от 3 лет» без уровня и без признаков junior не отправляется", () => {
  const [row] = decideBatch([
    {
      title: "Data Scientist / AI Engineer (LLM, AI-агенты)",
      company: "BGStaff",
      url: "https://career.habr.com/vacancies/70",
      area: "",
      remote: true,
      level: "",
      description: "Ищем Data Scientist с коммерческим опытом от 3 лет. Python, PyTorch, LLM.",
    },
  ]);
  assert.equal(row.action, "drop");
});

test("одно упоминание ИИ-агентов в требованиях не делает QA вакансией AI + QA", () => {
  const description =
    "Опыт работы в роли QA Automation Engineer (Java) от 1,6 года. Уверенные знания SQL. Опыт работы с ИИ-агентами.";
  assert.equal(categoryFor("QA Automation Engineer (Java)", description), "QA");
  assert.equal(
    categoryFor("QA Engineer", "Тестируем LLM-ассистента. Prompt-инженерия, оценка ответов нейросети."),
    "AI + QA",
  );
});

test("для удалёнки без страны в сообщении указан город офиса компании", () => {
  const [row] = decideBatch([
    {
      title: "QA Automation Engineer (Java)",
      company: "Aston",
      url: "https://career.habr.com/vacancies/71",
      area: "",
      remote: true,
      level: "Junior",
      pageCity: "Москва",
      pageCountry: "Россия",
      description: "Опыт от 1,6 года. Тестирование микросервисов.",
    },
  ]);
  assert.equal(row.action, "send");
  assert.match(row.text, /Офис компании: Москва, Россия/);
  assert.match(row.text, /^🧪 QA \/ Junior/);
});

test("опыт от 3 лет отбрасывается даже при уровне Junior в карточке", () => {
  const [row] = decideBatch([
    {
      title: "QA Engineer",
      company: "Co",
      url: "https://career.habr.com/vacancies/72",
      area: "Минск",
      remote: false,
      level: "Junior",
      description: "Требуется опыт работы от 3 лет в тестировании.",
    },
  ]);
  assert.equal(row.action, "drop");
  assert.match(row.dropReason, /опыт от 3/);
});

test("новые AI-специальности распознаются", () => {
  assert.equal(categoryFor("Prompt Engineer (стажёр)", ""), "AI Entry Level");
  assert.equal(categoryFor("Оператор нейросетей", "Работа с ChatGPT"), "AI Entry Level");
  assert.equal(categoryFor("AI-тренер", "Обучение моделей, ai trainer"), "AI Entry Level");
  assert.equal(categoryFor("Junior ML Engineer", "NLP, Python"), "ML / Data");
});
