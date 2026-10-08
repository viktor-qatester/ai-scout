const test = require("node:test");
const assert = require("node:assert/strict");
const { decideBatch, examples } = require("./decide.js");

test("учебные вакансии расходятся на отправку и отказ", () => {
  const decisions = decideBatch(examples());
  const byUrl = Object.fromEntries(decisions.slice(0, -1).map((row) => [row.url, row]));

  const juniorQa = byUrl["https://career.habr.com/vacancies/1"];
  assert.equal(juniorQa.action, "send");
  assert.equal(juniorQa.category, "QA");

  const senior = byUrl["https://career.habr.com/vacancies/2"];
  assert.equal(senior.action, "drop");
  assert.match(senior.dropReason, /senior/i);

  const juniorAi = byUrl["https://career.habr.com/vacancies/3"];
  assert.equal(juniorAi.action, "send");
  assert.equal(juniorAi.category, "AI");

  const annotator = byUrl["https://career.habr.com/vacancies/4"];
  assert.equal(annotator.action, "send");
  assert.equal(annotator.category, "AI Entry Level");

  const rollout = byUrl["https://career.habr.com/vacancies/5"];
  assert.equal(rollout.action, "send");
  assert.equal(rollout.category, "AI Entry Level");

  const aiQa = byUrl["https://career.habr.com/vacancies/6"];
  assert.equal(aiQa.action, "send");
  assert.equal(aiQa.category, "AI + QA");

  const chemist = byUrl["https://career.habr.com/vacancies/7"];
  assert.equal(chemist.action, "drop");

  const developer = byUrl["https://career.habr.com/vacancies/8"];
  assert.equal(developer.action, "send");
  assert.equal(developer.category, "AI");

  const halfYear = byUrl["https://career.habr.com/vacancies/9"];
  assert.equal(halfYear.action, "send");
  assert.equal(halfYear.category, "QA");

  const duplicate = decisions[decisions.length - 1];
  assert.equal(duplicate.url, "https://career.habr.com/vacancies/1");
  assert.equal(duplicate.action, "drop");
  assert.match(duplicate.dropReason, /уже была/);
});

test("фраза про команду senior не выкидывает junior QA", () => {
  const [decision] = decideBatch([
    {
      title: "Junior QA Engineer",
      company: "Team",
      url: "https://career.habr.com/vacancies/10",
      area: "Минск",
      remote: false,
      description: "Работа с senior разработчиками. Функциональное тестирование.",
    },
  ]);
  assert.equal(decision.action, "send");
  assert.equal(decision.category, "QA");
});

test("возраст компании не считается стажем кандидата", () => {
  const [decision] = decideBatch([
    {
      title: "Junior AI Engineer",
      company: "Old",
      url: "https://career.habr.com/vacancies/11",
      area: "Минск",
      remote: true,
      description: "Компания на рынке более 10 лет. Нужен LLM и prompt.",
    },
  ]);
  assert.equal(decision.action, "send");
});
