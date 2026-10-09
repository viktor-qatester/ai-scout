/**
 * Решение по вакансиям для n8n-агента.
 * Функции не используют API n8n: их гоняет `node --test n8n/decide.test.js`.
 * В узлы «Подготовка» и «Решение» тот же файл подставляет n8n/build_workflow.py.
 */

// Middle по карточке Хабра по умолчанию не подходит начинающему.
const ALLOW_MIDDLE = false;
const DETAIL_LIMIT = 80;
const SOURCE_QUOTA = { habr: 20, "hh.ru": 20, default: 12 };

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
  if (has(title, AI_TERMS)) return true;
  const needed = String(description || "").length > 1500 ? 3 : 2;
  return countMatches(description, AI_TERMS) >= needed;
}

const ML_TERMS =
  "machine learning|\\bml\\s+(engineer|инженер|стажер|intern)|\\bnlp\\b|computer vision|компьютерн\\w*\\s+зрен|data scientist|машинн\\w* обучен";

const QA_TERMS =
  "\\bqa\\b|\\baqa\\b|\\bsdet\\b|quality assurance|\\btester\\b|\\btesting\\b|тестиров|тестирован|инженер по тестированию|специалист по тестированию";

// В длинном описании слово «testing» встречается у любой вакансии: без QA в названии нужно три упоминания.
function mentionsQaEnough(title, description) {
  if (has(title, QA_TERMS)) return true;
  const needed = String(description || "").length > 1500 ? 4 : 1;
  return countMatches(description, QA_TERMS) >= needed;
}

function categoryFor(title, description) {
  const long = String(description || "").length > 1500;
  const text = long ? String(title) : `${title}\n${description}`;
  const other = titleIsOtherProfession(title);
  const blocksAi = titleBlocksAi(title);
  const aiQa =
    !other &&
    !blocksAi &&
    has(
      text,
      "ai\\s*qa|qa\\s*ai|ai\\s+tester|ai\\s+testing|llm\\s+qa|llm\\s+evaluation|ai\\s+quality|оценк\\w*\\s+(модел|llm|ии)",
    );
  const qa = !other && mentionsQaEnough(title, description);
  const entry =
    !blocksAi &&
    has(
      text,
      "data annotat|data label|разметк\\w*\\s+данн|специалист по внедрению ии|внедрен\\w*\\s+ии|специалист по ии|специалист по нейросет|специалист по искусствен\\w*\\s+интеллект|ai[\\s-]+специалист|ai\\s+trainer|ai\\s+assistant|ai\\s+ассистент|оператор\\w*\\s+нейросет|асс?ессор\\w*\\s+(ии|ai|нейросет|llm)|prompt\\s+(engineer|инженер)|промпт[\\s-]*инженер",
    );
  const ml =
    !blocksAi &&
    (has(title, ML_TERMS) || countMatches(description, ML_TERMS) >= (String(description || "").length > 1500 ? 3 : 1));
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
  return has(title, "\\bjunior\\b|\\bjr\\b|\\bintern\\b|\\btrainee\\b|\\bentry\\b|стажер|стажировк|без опыта");
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

function yearsWord(years) {
  if (!Number.isInteger(years)) return "года";
  const mod10 = years % 10;
  const mod100 = years % 100;
  if (mod10 === 1 && mod100 !== 11) return "года";
  return "лет";
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
  const words = { одного: 1, двух: 2, трех: 3, "трёх": 3, четырех: 4, "четырёх": 4, пяти: 5, шести: 6 };
  const verbal = rx(
    "(?:опыт\\w*|experience).{0,80}?(?:от|более|больше|не менее|минимум)?\\s*(одного|двух|трех|трёх|четырех|четырёх|пяти|шести)\\s*(?:лет|года|год)",
    "giu",
  );
  for (const match of sample.matchAll(verbal)) found.push(words[match[1]]);
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

// Фраза «опытных и начинающих» описывает компанию, а не эту вакансию.
function roleText(vacancy) {
  const raw = vacancy.noPage ? vacancy.title : `${vacancy.title}\n${vacancy.description || ""}`;
  return String(raw).replace(rx("опытн\\w*\\s+и\\s+начинающ\\w*", "giu"), " ");
}

const JUNIOR_TEXT =
  "\\bjunior\\b|\\bintern\\b|\\btrainee\\b|entry level|стажер|стажировк|без опыта|опыт не требуется|для начинающ";

// Уровень в карточке не указан: нужен junior, стажировка или «без опыта» в названии или тексте роли.
function hasJuniorSignal(vacancy) {
  if (titleIsJunior(vacancy.title) || levelIsJunior(vacancy.level)) return true;
  return has(roleText(vacancy), JUNIOR_TEXT);
}

function prefilterReason(vacancy) {
  if (titleIsHardSenior(vacancy.title)) return "в названии роли senior, lead или руководитель";
  return levelDropReason(vacancy);
}

function hardReject(title, description) {
  const years = minimumYears(description);
  if (years !== null && years >= 3) return `в требованиях опыт от ${years} ${yearsWord(years)}`;
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
// russia: удалёнка с hh.ru, вакансия размещена в России.
// unconfirmed: удалёнка без указания страны.
// blocked: «только РФ», офис вне Беларуси или не удалёнка на hh.ru.
function geoStatus(vacancy) {
  const place = `${vacancy.area || ""} ${vacancy.pageCountry || ""}`;
  if (has(place, BELARUS_PLACE)) return "confirmed";
  const text = `${vacancy.description || ""}`;
  if (has(text, RUSSIA_ONLY)) return "blocked";
  if (has(text, BELARUS_OR_WORLD)) return "confirmed";
  if (vacancy.source === "hh.ru") return vacancy.remote ? "russia" : "blocked";
  return vacancy.remote ? "unconfirmed" : "blocked";
}

function placeLabel(vacancy, geo) {
  if (geo === "russia") {
    const city = vacancy.area || vacancy.pageCity || "город не указан";
    return `удалённо, Россия (${city})`;
  }
  if (has(vacancy.area || "", BELARUS_PLACE)) return vacancy.area;
  if (geo === "confirmed") return "удалённо, Беларусь подходит";
  const office = [vacancy.pageCity, vacancy.pageCountry].filter(Boolean).join(", ");
  const note = "удалённо, Беларусь в тексте не указана: уточните у работодателя";
  return office ? `${note}\nОфис компании: ${office}` : note;
}

function scoreVacancy(vacancy, category, geo) {
  const text = roleText(vacancy);
  let score = 0;
  const reasons = [];
  if (titleIsJunior(vacancy.title) || levelIsJunior(vacancy.level) || has(text, JUNIOR_TEXT)) {
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
  } else if (geo === "russia") {
    score += 1;
    reasons.push("удалённо, вакансия из России");
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
    reasons.push(`опыт от ${years} ${yearsWord(years)}`);
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
  const category = categoryFor(title, vacancy.noPage ? "" : description);
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

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function plain(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Опыт в карточке rabota.by и praca.by переводим в уровень и в фразу, которую понимает minimumYears.
function experienceHints(label) {
  const text = normalize(label);
  if (!text) return { level: "", phrase: "" };
  if (has(text, "без опыта|не имеет значения|не требуется")) return { level: "Junior", phrase: "без опыта" };
  if (has(text, "более 6|свыше 6|6 лет")) return { level: "Senior", phrase: "" };
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)/);
  if (match) {
    const from = Number(match[1].replace(",", "."));
    if (from >= 3) return { level: "Middle", phrase: "" };
    // «1–3 года» на карточке слишком грубо: фраза «от 1 года» прятала настоящие «от 3 лет» в тексте.
    return { level: "", phrase: "" };
  }
  return { level: "", phrase: "" };
}

function parseRabotaHtml(html) {
  const parts = String(html || "").split('data-qa="vacancy-serp__vacancy"').slice(1);
  const found = [];
  for (const chunk of parts) {
    const window = chunk.slice(0, 12000);
    const url = (window.match(/href="(https:\/\/(?:rabota\.by|hh\.ru)\/vacancy\/\d+)[^"]*"/) || [])[1];
    const title = (window.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    if (!url || !title) continue;
    const company = (window.match(/data-qa="vacancy-serp__vacancy-employer(?:-text)?"[^>]*>([\s\S]*?)<\//) || [])[1];
    const address = (window.match(/data-qa="vacancy-serp__vacancy-address"[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    const experience = (window.match(/data-qa="vacancy-serp__vacancy-work-experience-[^"]+"[^>]*>([\s\S]*?)<\//) || [])[1];
    const hints = experienceHints(plain(experience));
    found.push({
      title: plain(title),
      company: plain(company),
      url: url.replace("https://hh.ru/", "https://rabota.by/"),
      area: plain(address),
      remote: window.includes("vacancy-label-work-schedule-remote"),
      level: hints.level,
      description: hints.phrase,
      source: "rabota.by",
    });
  }
  return found;
}

function parseHhHtml(html) {
  return parseRabotaHtml(html)
    .filter((vacancy) => vacancy.remote)
    .map((vacancy) => ({
      ...vacancy,
      url: vacancy.url.replace("https://rabota.by/", "https://hh.ru/"),
      source: "hh.ru",
    }));
}

function parsePracaHtml(html) {
  const parts = String(html || "").split('class="locationDepended vac-small"').slice(1);
  const found = [];
  for (const chunk of parts) {
    const window = chunk.slice(0, 6000);
    const link = window.match(/href="(\/vacancy\/\d+)\/[^"]*"[\s\S]*?<h2>([\s\S]*?)<\/h2>/);
    if (!link) continue;
    const company = (window.match(/class="vac-small__organization"[^>]*>([\s\S]*?)<\/a>/) || [])[1];
    const snippet = (window.match(/class="vacancy__search-description">([\s\S]*?)<\/div>/) || [])[1];
    const experience = (window.match(/class="vac-small__experience">([\s\S]*?)<\/div>/) || [])[1];
    const city = (window.match(/class="vac-small__city">([\s\S]*?)<\/div>/) || [])[1];
    const hints = experienceHints(plain(experience));
    found.push({
      title: plain(link[2]),
      company: plain(company),
      url: `https://praca.by${link[1]}/`,
      area: plain(city) || "Беларусь",
      remote: false,
      level: hints.level,
      description: [plain(snippet), hints.phrase].filter(Boolean).join(". "),
      source: "praca.by",
    });
  }
  return found;
}

function seniorityToLevel(list) {
  const text = normalize((list || []).join(" "));
  if (has(text, "senior|lead|principal|staff|executive|manager")) return "Senior";
  if (has(text, "entry|junior|intern|graduate")) return "Junior";
  if (has(text, "mid")) return "Middle";
  return "";
}

function adaptHimalayas(job) {
  const places = job.locationRestrictions || [];
  const worldwide = places.length === 0;
  if (!worldwide && !has(places.join(" "), "belarus|беларус")) return null;
  const body = plain(job.description || job.excerpt || "").slice(0, 3000);
  return {
    title: job.title || "",
    company: job.companyName || "",
    url: job.guid || job.applicationLink || "",
    area: "",
    remote: true,
    level: seniorityToLevel(job.seniority),
    description: `${worldwide ? "Remote, worldwide. " : "Remote, Belarus. "}${body}`,
    source: "himalayas",
    noPage: true,
  };
}

function parseWwrRss(xml) {
  const found = [];
  for (const block of String(xml || "").split("<item>").slice(1)) {
    const tag = (name) => {
      const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") : "";
    };
    const region = plain(tag("region"));
    const countries = plain(tag("country"));
    const global = has(region, "anywhere|worldwide");
    if (!global && !has(`${region} ${countries}`, "belarus")) continue;
    const full = plain(tag("title"));
    const split = full.indexOf(":");
    found.push({
      title: split > 0 ? full.slice(split + 1).trim() : full,
      company: split > 0 ? full.slice(0, split).trim() : "",
      url: plain(tag("link")),
      area: "",
      remote: true,
      level: "",
      description: `Remote, ${global ? "worldwide" : "Belarus"}. ${plain(tag("description")).slice(0, 3000)}`,
      source: "weworkremotely",
      noPage: true,
    });
  }
  return found;
}

const PRACA_QUERIES = ["тестировщик", "QA", "стажировка ИИ", "искусственный интеллект", "нейросети", "Data Scientist"];
const HIMALAYAS_QUERIES = ["junior qa", "qa intern", "junior ai", "prompt engineer", "llm", "junior machine learning"];

const HH_QUERIES = [
  "junior QA",
  "стажер тестировщик",
  "QA стажировка",
  "junior AI",
  "стажировка ИИ",
  "AI QA",
  "prompt engineer",
  "junior ML",
  "нейросети",
  "data annotator",
];

function hhUrl(query, experience) {
  return (
    "https://hh.ru/search/vacancy?text=" +
    encodeURIComponent(query) +
    "&schedule=remote&area=113&experience=" +
    experience +
    "&items_on_page=20&order_by=publication_time"
  );
}

function rabotaUrl(query) {
  return `https://rabota.by/search/vacancy?text=${encodeURIComponent(query)}&area=16&items_on_page=20`;
}

function pracaUrl(query) {
  return `https://praca.by/search/vacancies/?search%5Bquery%5D=${encodeURIComponent(query)}`;
}

function himalayasUrl(query) {
  return `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(query)}&sort=recent`;
}

const WWR_URL = "https://weworkremotely.com/remote-jobs.rss";

// http(url) возвращает текст ответа. Ошибка одного источника не останавливает остальные.
async function collectOtherSources(http, queries) {
  const batches = [];
  const errors = [];
  const run = async (source, urls, parse) => {
    const vacancies = [];
    for (const url of urls) {
      try {
        vacancies.push(...parse(await http(url, source)));
      } catch (error) {
        errors.push(`${source}: ${error && error.message ? error.message : error}`);
      }
    }
    batches.push({ source, vacancies });
  };
  await run("rabota.by", queries.map(rabotaUrl), parseRabotaHtml);
  await run(
    "hh.ru",
    HH_QUERIES.flatMap((query) => [hhUrl(query, "noExperience"), hhUrl(query, "between1And3")]),
    parseHhHtml,
  );
  await run("praca.by", PRACA_QUERIES.map(pracaUrl), parsePracaHtml);
  await run(
    "himalayas",
    HIMALAYAS_QUERIES.map(himalayasUrl),
    (text) => (JSON.parse(text).jobs || []).map(adaptHimalayas).filter(Boolean),
  );
  await run("weworkremotely", [WWR_URL], parseWwrRss);
  return { batches, errors };
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
  if (vacancy.noPage) return vacancy;
  const page = parseJobPosting(html);
  const description = [vacancy.description, page.description].filter(Boolean).join("\n");
  return { ...vacancy, description, pageCountry: page.country, pageCity: page.city };
}

function selectCandidates(rawLists, alreadySent) {
  const sent = new Set(alreadySent || []);
  const seen = new Set();
  const bySource = {};
  const order = [];
  for (const raw of rawLists) {
    const habr = (raw.list || []).map(adaptHabr);
    const vacancies = raw.vacancies ? raw.vacancies : habr;
    for (const vacancy of vacancies) {
      if (!vacancy || !vacancy.url) continue;
      const source = vacancy.source || "habr";
      if (source !== "habr" && !categoryFor(vacancy.title, vacancy.noPage ? "" : vacancy.description || "")) continue;
      if (prefilterReason(vacancy)) continue;
      const key = (vacancy.url.match(/\/vacancy\/(\d+)/) || [])[1] || vacancy.url;
      if (sent.has(vacancy.url) || seen.has(vacancy.url) || seen.has(key)) continue;
      seen.add(vacancy.url);
      seen.add(key);
      if (!bySource[source]) {
        bySource[source] = [];
        order.push(source);
      }
      bySource[source].push(vacancy);
    }
  }
  const picked = [];
  for (const source of order) {
    const quota = SOURCE_QUOTA[source] || SOURCE_QUOTA.default;
    picked.push(...bySource[source].slice(0, quota));
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
    collectOtherSources,
    parseRabotaHtml,
    parseHhHtml,
    parsePracaHtml,
    parseWwrRss,
    adaptHimalayas,
    experienceHints,
    adaptHabr,
    parseJobPosting,
    enrichWithPage,
    categoryFor,
    geoStatus,
    examples,
    DETAIL_LIMIT,
  };
}
