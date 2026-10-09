/**
 * Решение по вакансиям для n8n-агента.
 * Функции не используют API n8n: их гоняет `node --test n8n/decide.test.js`.
 * В узлы «Подготовка» и «Решение» тот же файл подставляет n8n/build_workflow.py.
 */

// Middle по карточке Хабра по умолчанию не подходит начинающему.
const ALLOW_MIDDLE = false;
const DETAIL_LIMIT = 40;

const WORD = "[\\p{L}\\p{N}_]";
const BOUNDARY = `(?:(?<!${WORD})(?=${WORD})|(?<=${WORD})(?!${WORD}))`;

// JS \b и \w знают только латиницу. Подставляем юникодные аналоги.
function rx(source, flags = "iu") {
  const withUnicode = flags.includes("u") ? flags : `${flags}u`;
  return new RegExp(source.replace(/\\b/g, BOUNDARY).replace(/\\w/g, WORD), withUnicode);
}

function normalize(text) {
  return String(text || "")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .toLowerCase();
}

function has(text, pattern) {
  return rx(pattern).test(normalize(text));
}

const BELARUS_PLACE = "беларус|минск|гомел|гродн|витебск|могилев|брест";
const BELARUS_OR_WORLD =
  `${BELARUS_PLACE}|\\bснг\\b|\\bрб\\b|любой стран|любая стран|из любой|по всему миру|worldwide|anywhere`;
const RUSSIA_ONLY =
  "только\\s+(для\\s+)?(граждан\\s+)?(рф|росси)|гражданств\\w*\\s+(рф|росси)|российск\\w+\\s+гражданств|" +
  "резидент\\w*\\s+рф|граждан\\w*\\s+рф|только\\s+из\\s+(рф|росси)|только\\s+по\\s+рф";

function titleHasTarget(title) {
  return has(
    title,
    "\\bqa\\b|\\baqa\\b|\\bsdet\\b|тестиров|тестирован|\\bai\\b|\\bllm\\b|\\brag\\b|нейросет|искусствен\\w* интеллект|внедрен\\w* ии|\\bии\\b|data annotat|разметк\\w* данн|machine learning|\\bml\\b|data scientist",
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
    "химик|технолог|продаж|\\bsales\\b|representative|support|поддержк|\\bseo\\b|бухгалтер|маркетолог|аудитор|юрист|\\bhr\\b|рекрутер",
  );
}

const AI_TERMS =
  "\\bai\\b|\\bllm\\b|\\brag\\b|genai|generative ai|prompt engineer|chatgpt|нейросет|искусствен\\w* интеллект|\\bии\\b|ии-агент";

function countMatches(text, pattern) {
  const source = rx(pattern).source;
  return [...normalize(text).matchAll(new RegExp(source, "giu"))].length;
}

// Одно упоминание ИИ в списке требований не делает вакансию AI-вакансией.
function mentionsAiEnough(title, description) {
  return has(title, AI_TERMS) || countMatches(description, AI_TERMS) >= 2;
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
      "data annotat|data label|разметк\\w*\\s+данн|специалист по внедрению ии|внедрен\\w*\\s+ии|специалист по ии|специалист по нейросет|специалист по искусствен\\w*\\s+интеллект|ai[\\s-]+специалист|ai\\s+trainer|ai\\s+assistant|ai\\s+ассистент|оператор\\w*\\s+нейросет|асс?ессор\\w*\\s+(ии|ai|нейросет|llm)|prompt\\s+(engineer|инженер)|промпт[\\s-]*инженер",
    );
  const ml =
    !blocksAi &&
    has(
      text,
      "machine learning|\\bml\\s+(engineer|инженер|стажер|intern)|\\bnlp\\b|computer vision|компьютерн\\w*\\s+зрен|data scientist|машинн\\w* обучен",
    );
  const ai =
    !blocksAi &&
    (aiQa || entry || ml || mentionsAiEnough(title, description));
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

function levelIsJunior(level) {
  return has(level, "junior|intern|стаж");
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
    rx(
      "(работ\\w*|общаться|взаимодейств\\w*|вместе)\\s+с\\s+.{0,40}?(senior|сеньор|lead|лид\\w*)\\s+\\w+|(в команде|команда|под руководством|наставни\\w*|ментор\\w*).{0,60}?(senior|сеньор|lead|лид\\w*)|(senior|сеньор)\\s+(разработчик\\w*|developer\\w*|инженер\\w*|коллег\\w*|команд\\w*)",
      "giu",
    ),
    " ",
  );
}

function minimumYears(text) {
  const sample = normalize(stripTeamContext(text));
  const found = [];
  const patterns = [
    rx(
      "(?:опыт\\w*|experience).{0,40}?(?:от|более|больше|не менее|минимум|minimum|at least)?\\s*(?<![\\d.,])(\\d+(?:[.,]\\d+)?)\\s*\\+?\\s*(?:лет|года|год|years)",
      "giu",
    ),
    rx(
      "(?:от|не менее|минимум|minimum|at least)\\s+(?<![\\d.,])(\\d+(?:[.,]\\d+)?)\\s*\\+?\\s*(?:лет|года|год|years).{0,20}?(?:опыт|experience)",
      "giu",
    ),
    rx(
      "(?<![\\d.,])(\\d+(?:[.,]\\d+)?)\\s*\\+?\\s*(?:лет|года|год|years)(?:\\s+of)?\\s*(?:commercial\\s+)?(?:experience|опыт)",
      "giu",
    ),
  ];
  for (const pattern of patterns) {
    for (const match of sample.matchAll(pattern)) found.push(Number(match[1].replace(",", ".")));
  }
  if (!found.length) return null;
  return Math.min(...found);
}

// Карточка Хабра надёжнее слов в названии: «Junior/Mid Sales» с уровнем Senior остаётся Senior.
function levelDropReason(vacancy) {
  const level = normalize(vacancy.level);
  if (!level) return "";
  if (has(level, "lead|senior|principal|staff|head|architect|ведущ")) {
    return `уровень в карточке: ${vacancy.level}`;
  }
  if (!ALLOW_MIDDLE && has(level, "middle|мидл") && !titleIsJunior(vacancy.title)) {
    return `уровень в карточке: ${vacancy.level}, начинающему не подходит`;
  }
  return "";
}

// Уровень в карточке не указан: нужен хоть один признак начинающего.
function hasJuniorSignal(vacancy) {
  const text = `${vacancy.title}\n${vacancy.description || ""}`;
  if (titleIsJunior(vacancy.title) || levelIsJunior(vacancy.level)) return true;
  if (has(text, "junior|intern|trainee|entry level|стажер|стажировк|без опыта|опыт не требуется|начинающ")) {
    return true;
  }
  const years = minimumYears(vacancy.description || "");
  return years !== null && years <= 2;
}

function prefilterReason(vacancy) {
  if (titleIsHardSenior(vacancy.title)) return "в названии роли senior, lead или руководитель";
  return levelDropReason(vacancy);
}

function hardReject(title, description) {
  const years = minimumYears(description);
  if (years !== null && years >= 3) return `в требованиях опыт от ${years} лет`;
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

// confirmed: Беларусь названа в тексте или стоит в локации.
// unconfirmed: удалёнка без указания страны.
// blocked: в тексте прямо сказано «только РФ» или не удалёнка вне Беларуси.
function geoStatus(vacancy) {
  const place = `${vacancy.area || ""} ${vacancy.pageCountry || ""}`;
  if (has(place, BELARUS_PLACE)) return "confirmed";
  const text = `${vacancy.description || ""}`;
  if (has(text, RUSSIA_ONLY)) return "blocked";
  if (has(text, BELARUS_OR_WORLD)) return "confirmed";
  return vacancy.remote ? "unconfirmed" : "blocked";
}

function placeLabel(vacancy, geo) {
  if (has(vacancy.area || "", BELARUS_PLACE)) return vacancy.area;
  if (geo === "confirmed") return "удалённо, Беларусь подходит";
  const office = [vacancy.pageCity, vacancy.pageCountry].filter(Boolean).join(", ");
  const note = "удалённо, Беларусь в тексте не указана: уточните у работодателя";
  return office ? `${note}\nОфис компании: ${office}` : note;
}

function scoreVacancy(vacancy, category, geo) {
  const text = `${vacancy.title}\n${vacancy.description || ""}`;
  let score = 0;
  const reasons = [];
  if (
    titleIsJunior(vacancy.title) ||
    levelIsJunior(vacancy.level) ||
    has(text, "junior|intern|trainee|стажер|стажировк|без опыта|начинающ")
  ) {
    score += 3;
    reasons.push("уровень junior, стажировка или без опыта");
  }
  if (category === "AI + QA") {
    score += 3;
    reasons.push("роль на стыке AI и QA");
  }
  if (geo === "confirmed") {
    score += 2;
    reasons.push(vacancy.remote ? "можно удалённо из Беларуси" : "локация в Беларуси");
  } else {
    reasons.push("удалёнка: Беларусь в тексте не указана");
  }
  if (has(text, "без опыта|опыт не требуется|no experience")) {
    score += 2;
    reasons.push("опыт не требуют");
  }
  const years = minimumYears(vacancy.description || "");
  if (years !== null && years >= 1 && years <= 3) {
    score += 1;
    reasons.push(`опыт от ${years} лет`);
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

function emptyDecision(vacancy) {
  return {
    title: vacancy.title || "",
    company: vacancy.company || "",
    url: vacancy.url || "",
    action: "drop",
    dropReason: "",
    category: null,
    score: 0,
    tier: "",
    geo: "",
    text: "",
  };
}

function decideVacancy(vacancy) {
  const title = vacancy.title || "";
  const description = vacancy.description || "";
  const base = emptyDecision(vacancy);
  const early = prefilterReason(vacancy);
  if (early) return { ...base, dropReason: early };
  const reject = hardReject(title, description);
  if (reject) return { ...base, dropReason: reject };
  const geo = geoStatus(vacancy);
  if (geo === "blocked") {
    return { ...base, geo, dropReason: "в тексте указано «только РФ» или вакансия не в Беларуси" };
  }
  const category = categoryFor(title, description);
  if (!category) return { ...base, geo, dropReason: "роль не QA и не AI" };
  if (!normalize(vacancy.level) && !hasJuniorSignal(vacancy)) {
    return { ...base, category, geo, dropReason: "уровень не указан и признаков junior нет" };
  }
  const { score, reasons } = scoreVacancy(vacancy, category, geo);
  if (score < 1) return { ...base, category, geo, score, dropReason: "слишком слабое совпадение" };
  const tier = score >= 6 ? "высокое совпадение" : score >= 3 ? "стоит посмотреть" : "возможно подходит";
  const junior = titleIsJunior(title) || levelIsJunior(vacancy.level);
  const text = [
    headerFor(category, junior),
    "",
    title,
    `Компания: ${vacancy.company || "не указана"}`,
    `Формат: ${placeLabel(vacancy, geo)}`,
    "",
    tier,
    "",
    "Почему подходит:",
    ...reasons.map((reason) => `- ${reason}`),
    "",
    "Источник:",
    vacancy.url || "",
  ].join("\n");
  return { ...base, action: "send", category, geo, score, tier, text };
}

function decideBatch(vacancies) {
  const seen = new Set();
  return vacancies.map((vacancy) => {
    const decision = decideVacancy(vacancy);
    const key = decision.url || `${decision.company}|${decision.title}`;
    if (decision.action === "send" && seen.has(key)) {
      return { ...decision, action: "drop", dropReason: "эта вакансия уже была в текущем прогоне", text: "" };
    }
    if (decision.action === "send") seen.add(key);
    return decision;
  });
}

function adaptHabr(item) {
  const locations = (item.locations || []).map((place) => place.title || "").filter(Boolean);
  const remote = Boolean(item.remoteWork);
  const area = locations.join(", ");
  const inBelarus = has(area, BELARUS_PLACE);
  if (!inBelarus && !(remote && locations.length === 0)) return null;
  const skills = (item.skills || []).map((skill) => skill.title || "").filter(Boolean);
  const href = item.href || "";
  return {
    title: item.title || "",
    company: (item.company || {}).title || "",
    url: href.startsWith("http") ? href : href ? `https://career.habr.com${href}` : "",
    area,
    remote,
    level: String(item.qualification || ""),
    description: skills.join(", "),
    source: "habr",
  };
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJobPosting(html) {
  const empty = { description: "", country: "", city: "", remote: false };
  const blocks = String(html || "").matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    let doc;
    try {
      doc = JSON.parse(block[1]);
    } catch (error) {
      continue;
    }
    for (const entry of Array.isArray(doc) ? doc : [doc]) {
      if (!entry || entry["@type"] !== "JobPosting") continue;
      const address = ((entry.jobLocation || {}).address) || {};
      const country = address.addressCountry;
      return {
        description: stripHtml(entry.description),
        country: typeof country === "string" ? country : (country || {}).name || "",
        city: address.addressLocality || "",
        remote: entry.jobLocationType === "TELECOMMUTE",
      };
    }
  }
  return empty;
}

function enrichWithPage(vacancy, html) {
  const page = parseJobPosting(html);
  const description = [vacancy.description, page.description].filter(Boolean).join("\n");
  return { ...vacancy, description, pageCountry: page.country, pageCity: page.city };
}

function selectCandidates(rawLists, alreadySent) {
  const sent = new Set(alreadySent || []);
  const seen = new Set();
  const picked = [];
  for (const raw of rawLists) {
    for (const item of raw.list || []) {
      const vacancy = adaptHabr(item);
      if (!vacancy || !vacancy.url) continue;
      if (prefilterReason(vacancy)) continue;
      if (sent.has(vacancy.url) || seen.has(vacancy.url)) continue;
      seen.add(vacancy.url);
      picked.push(vacancy);
    }
  }
  return picked.slice(0, DETAIL_LIMIT);
}

function decideLive(candidates, pageBodies) {
  const enriched = candidates.map((vacancy, index) => enrichWithPage(vacancy, pageBodies[index]));
  return decideBatch(enriched);
}

function examples() {
  return [
    {
      title: "Junior QA Engineer",
      company: "Example",
      url: "https://career.habr.com/vacancies/1",
      area: "Минск",
      remote: false,
      level: "Junior",
      description: "Стажировка. Тестирование API, Python и SQL. Опыт не требуется.",
    },
    {
      title: "Senior AI Engineer",
      company: "Big Co",
      url: "https://career.habr.com/vacancies/2",
      area: "Минск",
      remote: true,
      level: "Senior",
      description: "LLM и RAG. Ищем senior-специалиста.",
    },
    {
      title: "Junior AI Engineer",
      company: "Lab",
      url: "https://career.habr.com/vacancies/3",
      area: "",
      remote: true,
      level: "Junior",
      description: "Работа с senior разработчиками. LLM, prompt и RAG. Можно из любой страны.",
    },
    {
      title: "Data Annotator",
      company: "Markup",
      url: "https://career.habr.com/vacancies/4",
      area: "Гомель",
      remote: false,
      level: "",
      description: "Разметка данных для обучения моделей. Без опыта.",
    },
    {
      title: "Специалист по внедрению ИИ",
      company: "Внедрение",
      url: "https://career.habr.com/vacancies/5",
      area: "Брест",
      remote: false,
      level: "",
      description: "Помогаем компаниям подключить нейросети. Стажировка.",
    },
    {
      title: "AI QA Engineer",
      company: "Quality",
      url: "https://career.habr.com/vacancies/6",
      area: "Минск",
      remote: true,
      level: "Junior",
      description: "LLM evaluation и тестирование ответов модели. Junior.",
    },
    {
      title: "Химик-технолог",
      company: "Завод",
      url: "https://career.habr.com/vacancies/7",
      area: "Минск",
      remote: false,
      level: "",
      description: "На производстве используем ИИ для отчётов.",
    },
    {
      title: "Junior Python Developer",
      company: "Code",
      url: "https://career.habr.com/vacancies/8",
      area: "Минск",
      remote: true,
      level: "Junior",
      description: "В задачах LLM и RAG. В команде есть QA.",
    },
    {
      title: "Junior QA",
      company: "Half",
      url: "https://career.habr.com/vacancies/9",
      area: "Минск",
      remote: false,
      level: "Junior",
      description: "Опыт от 0,5 года. Тестирование веб-приложений.",
    },
    {
      title: "QA Engineer",
      company: "Moscow Bank",
      url: "https://career.habr.com/vacancies/12",
      area: "",
      remote: true,
      level: "Lead",
      description: "Тестирование мобильного приложения. Python.",
    },
    {
      title: "QA Engineer",
      company: "Only RF",
      url: "https://career.habr.com/vacancies/13",
      area: "",
      remote: true,
      level: "Junior",
      description: "Удалённо. Только для граждан РФ. Тестирование API.",
    },
    {
      title: "QA Engineer",
      company: "Remote Co",
      url: "https://career.habr.com/vacancies/14",
      area: "",
      remote: true,
      level: "Junior",
      description: "Удалённо. Ручное тестирование.",
    },
    {
      title: "Junior QA Engineer",
      company: "Example",
      url: "https://career.habr.com/vacancies/1",
      area: "Минск",
      remote: false,
      level: "Junior",
      description: "Повтор той же ссылки.",
    },
  ];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    decideVacancy,
    decideBatch,
    decideLive,
    selectCandidates,
    adaptHabr,
    parseJobPosting,
    enrichWithPage,
    categoryFor,
    geoStatus,
    examples,
    DETAIL_LIMIT,
  };
}
