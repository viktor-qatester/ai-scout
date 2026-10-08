/**
 * Решение по одной вакансии для n8n-агента.
 * Функции без API n8n: их гоняет `node --test n8n/decide.test.js`.
 * В узел «Решение» тот же файл подставляет n8n/build_workflow.py.
 */

function normalize(text) {
  return String(text || "")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .toLowerCase();
}

function has(text, pattern) {
  return new RegExp(pattern, "i").test(normalize(text));
}

function titleHasTarget(title) {
  return has(
    title,
    "\\bqa\\b|\\baqa\\b|\\bsdet\\b|тестиров|тестирован|\\bai\\b|\\bllm\\b|\\brag\\b|нейросет|искусствен\\w* интеллект|внедрен\\w* ии|data annotat|разметк\\w* данн|machine learning|\\bml\\b|data scientist",
  );
}

function titleIsOtherProfession(title) {
  if (!title || titleHasTarget(title)) return false;
  return has(
    title,
    "developer|разработчик|android|\\bios\\b|frontend|backend|devops|поддержк|support|\\bseo\\b|маркетолог|бухгалтер|дизайнер|\\bhr\\b|рекрутер|продаж|sales|копирайтер|юрист",
  );
}

function titleBlocksAi(title) {
  if (!title || titleHasTarget(title)) return false;
  return has(
    title,
    "химик|технолог|продаж|support|поддержк|\\bseo\\b|бухгалтер|маркетолог|аудитор|юрист|\\bhr\\b|рекрутер",
  );
}

function categoryFor(title, description) {
  const text = `${title}\n${description}`;
  const other = titleIsOtherProfession(title);
  const blocksAi = titleBlocksAi(title);
  const aiQa =
    !other &&
    !blocksAi &&
    has(
      text,
      "ai\\s*qa|qa\\s*ai|ai\\s+tester|ai\\s+testing|llm\\s+qa|llm\\s+evaluation|ai\\s+quality|оценк\\w*\\s+(модел|llm|ии)",
    );
  const qa =
    !other &&
    has(
      text,
      "\\bqa\\b|\\baqa\\b|\\bsdet\\b|quality assurance|\\btester\\b|\\btesting\\b|тестиров|тестирован|инженер по тестированию|специалист по тестированию",
    );
  const entry =
    !blocksAi &&
    has(
      text,
      "data annotat|разметк\\w*\\s+данн|специалист по внедрению ии|внедрен\\w*\\s+ии|специалист по ии|ai\\s+trainer|ai\\s+assistant",
    );
  const ml =
    !blocksAi &&
    has(text, "machine learning|\\bml engineer\\b|data scientist|машинн\\w* обучен");
  const ai =
    !blocksAi &&
    (aiQa ||
      entry ||
      ml ||
      has(
        text,
        "\\bai\\b|\\bllm\\b|\\brag\\b|genai|generative ai|prompt engineer|chatgpt|нейросет|искусствен\\w* интеллект|\\bии\\b",
      ));
  if (aiQa || (qa && ai)) return "AI + QA";
  if (entry) return "AI Entry Level";
  if (ml) return "ML / Data";
  if (ai) return "AI";
  if (qa) return "QA";
  return null;
}

function titleIsJunior(title) {
  return has(title, "junior|\\bjr\\b|intern|trainee|entry|стажер|стажировк|без опыта");
}

function titleIsHardSenior(title) {
  if (titleIsJunior(title)) return false;
  return has(
    title,
    "\\bsenior\\b|сеньор|\\bsr\\b|\\blead\\b|\\bleader\\b|тимлид|team\\s*lead|tech\\s*lead|principal|\\bstaff\\b|architect|архитектор|\\bhead\\b|начальник|директор|руководитель|главн(ый|ая)|ведущ(ий|ая)",
  );
}

function stripTeamContext(text) {
  return String(text || "").replace(
    /(работ\w*|общаться|взаимодейств\w*|вместе)\s+с\s+.{0,40}?(senior|сеньор|lead|лид\w*)\s+\w+|(в команде|команда|под руководством|наставни\w*|ментор\w*).{0,60}?(senior|сеньор|lead|лид\w*)|(senior|сеньор)\s+(разработчик\w*|developer\w*|инженер\w*|коллег\w*|команд\w*)/gi,
    " ",
  );
}

function minimumYears(text) {
  const sample = normalize(stripTeamContext(text));
  const found = [];
  const patterns = [
    /(?:опыт\w*|experience).{0,40}?(?:от|более|больше|не менее|минимум|minimum|at least)?\s*(?<![\d.,])(\d+)\s*\+?\s*(?:лет|года|год|years)/gi,
    /(?:от|не менее|минимум|minimum|at least)\s+(?<![\d.,])(\d+)\s*\+?\s*(?:лет|года|год|years).{0,20}?(?:опыт|experience)/gi,
    /(?<![\d.,])(\d+)\s*\+?\s*(?:лет|года|год|years)(?:\s+of)?\s*(?:commercial\s+)?(?:experience|опыт)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of sample.matchAll(pattern)) found.push(Number(match[1]));
  }
  if (!found.length) return null;
  return Math.min(...found);
}

function hardReject(title, description) {
  if (titleIsHardSenior(title)) return "в названии роли senior, lead или руководитель";
  const years = minimumYears(description);
  if (years !== null && years >= 5) return `в требованиях опыт от ${years} лет`;
  const cleaned = normalize(stripTeamContext(description));
  if (
    has(
      cleaned,
      "(ищем|требуется|нужен|нужна|позиция|роль|уровень).{0,40}(senior|сеньор|lead|principal|staff|architect|архитектор)",
    )
  ) {
    return "в тексте прямо требуют senior или lead";
  }
  return "";
}

function allowsBelarus(vacancy) {
  const place = normalize(`${vacancy.area || ""} ${vacancy.description || ""}`);
  if (/беларус|минск|гомел|гродн|витебск|могилев|брест/.test(place)) return true;
  if (vacancy.remote && /любая стран|любой стран|по всему миру|из любой|worldwide|anywhere|снг/.test(place)) {
    return true;
  }
  if (vacancy.remote && !normalize(vacancy.area || "")) return true;
  return false;
}

function scoreVacancy(vacancy, category) {
  const text = `${vacancy.title}\n${vacancy.description || ""}`;
  let score = 0;
  const reasons = [];
  if (titleIsJunior(vacancy.title) || has(text, "junior|intern|trainee|стажер|стажировк|без опыта|начинающ")) {
    score += 3;
    reasons.push("уровень junior, стажировка или без опыта");
  }
  if (category === "AI + QA") {
    score += 3;
    reasons.push("роль на стыке AI и QA");
  }
  if (vacancy.remote || /беларус|минск|гомел|гродн|витебск|могилев|брест/.test(normalize(vacancy.area || ""))) {
    score += 2;
    reasons.push(vacancy.remote ? "можно удалённо" : "локация в Беларуси");
  }
  if (has(text, "без опыта|опыт не требуется|no experience")) {
    score += 2;
    reasons.push("опыт не требуют");
  }
  if (has(text, "python|\\bsql\\b")) {
    score += 1;
    reasons.push("в тексте есть Python или SQL");
  }
  if (has(text, "\\bllm\\b|prompt|chatgpt|\\brag\\b|нейросет")) {
    score += 1;
    reasons.push("в тексте есть LLM, prompt или нейросети");
  }
  return { score, reasons };
}

function headerFor(category, junior) {
  if (category === "AI + QA") return "🤖 AI + QA";
  if (category === "AI" && junior) return "🤖 AI / Junior";
  if (category === "QA" && junior) return "🧪 QA / Junior";
  if (category === "ML / Data") return "🤖 ML / Data";
  if (category === "AI Entry Level") return "🤖 AI / Начальный уровень";
  if (category === "AI") return "🤖 AI";
  if (category === "QA") return "🧪 QA";
  return "Вакансия";
}

function decideVacancy(vacancy) {
  const title = vacancy.title || "";
  const description = vacancy.description || "";
  const base = {
    title,
    company: vacancy.company || "",
    url: vacancy.url || "",
    action: "drop",
    dropReason: "",
    category: null,
    score: 0,
    tier: "",
    text: "",
  };
  const reject = hardReject(title, description);
  if (reject) return { ...base, dropReason: reject };
  if (!allowsBelarus(vacancy)) {
    return { ...base, dropReason: "локация не Беларусь и удалёнка из Беларуси не подтверждена" };
  }
  const category = categoryFor(title, description);
  if (!category) return { ...base, dropReason: "роль не QA и не AI" };
  const { score, reasons } = scoreVacancy(vacancy, category);
  if (score < 1) return { ...base, category, score, dropReason: "слишком слабое совпадение" };
  const tier = score >= 6 ? "высокое совпадение" : score >= 3 ? "стоит посмотреть" : "возможно подходит";
  const junior = titleIsJunior(title);
  const format = vacancy.remote ? "удалённо" : vacancy.area || "не указан";
  const text = [
    headerFor(category, junior),
    "",
    title,
    `Компания: ${vacancy.company || "не указана"}`,
    `Формат: ${format}`,
    "",
    tier,
    "",
    "Почему подходит:",
    ...reasons.map((reason) => `- ${reason}`),
    "",
    "Источник:",
    vacancy.url || "",
  ].join("\n");
  return { ...base, action: "send", category, score, tier, text };
}

function decideBatch(vacancies) {
  const seen = new Set();
  return vacancies.map((vacancy) => {
    const decision = decideVacancy(vacancy);
    const key = decision.url || `${decision.company}|${decision.title}`;
    if (decision.action === "send" && seen.has(key)) {
      return { ...decision, action: "drop", dropReason: "эта вакансия уже была в текущем прогоне" };
    }
    if (decision.action === "send") seen.add(key);
    return decision;
  });
}

function examples() {
  return [
    {
      title: "Junior QA Engineer",
      company: "Example",
      url: "https://career.habr.com/vacancies/1",
      area: "Минск",
      remote: false,
      description: "Стажировка. Тестирование API, Python и SQL. Опыт не требуется.",
    },
    {
      title: "Senior AI Engineer",
      company: "Big Co",
      url: "https://career.habr.com/vacancies/2",
      area: "Минск",
      remote: true,
      description: "LLM и RAG. Ищем senior-специалиста.",
    },
    {
      title: "Junior AI Engineer",
      company: "Lab",
      url: "https://career.habr.com/vacancies/3",
      area: "",
      remote: true,
      description: "Работа с senior разработчиками. LLM, prompt и RAG. Можно из любой страны.",
    },
    {
      title: "Data Annotator",
      company: "Markup",
      url: "https://career.habr.com/vacancies/4",
      area: "Гомель",
      remote: false,
      description: "Разметка данных для обучения моделей. Без опыта.",
    },
    {
      title: "Специалист по внедрению ИИ",
      company: "Внедрение",
      url: "https://career.habr.com/vacancies/5",
      area: "Брест",
      remote: false,
      description: "Помогаем компаниям подключить нейросети. Стажировка.",
    },
    {
      title: "AI QA Engineer",
      company: "Quality",
      url: "https://career.habr.com/vacancies/6",
      area: "Минск",
      remote: true,
      description: "LLM evaluation и тестирование ответов модели. Junior.",
    },
    {
      title: "Химик-технолог",
      company: "Завод",
      url: "https://career.habr.com/vacancies/7",
      area: "Минск",
      remote: false,
      description: "На производстве используем ИИ для отчётов.",
    },
    {
      title: "Junior Python Developer",
      company: "Code",
      url: "https://career.habr.com/vacancies/8",
      area: "Минск",
      remote: true,
      description: "В задачах LLM и RAG. В команде есть QA.",
    },
    {
      title: "Junior QA",
      company: "Half",
      url: "https://career.habr.com/vacancies/9",
      area: "Минск",
      remote: false,
      description: "Опыт от 0,5 года. Тестирование веб-приложений.",
    },
    {
      title: "Junior QA Engineer",
      company: "Example",
      url: "https://career.habr.com/vacancies/1",
      area: "Минск",
      remote: false,
      description: "Повтор той же ссылки.",
    },
  ];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { decideVacancy, decideBatch, examples };
}
