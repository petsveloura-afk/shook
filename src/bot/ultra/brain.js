'use strict';

/**
 * ULTRA — "המוח": הבנת טקסט חופשי, חלופות חכמות כשאין תוצאות,
 * סטטיסטיקת מחירי שוק וציון איכות למודעה.
 *
 * הפונקציות הטהורות (parseQuery, scoreListing, priceStats, regionIndexFromText) לא תלויות ב-DB.
 * שאילתות DB נטענות בעצלנות בתוך הפונקציות שזקוקות להן.
 */

/* ------------------------------ מילות מפתח ------------------------------ */

const FREE_WORDS = /(בחינם|חינם|למסירה|מתנה|free of charge|\bfree\b|gratis|gratuit|gratuito|مجان|бесплат|безкоштов|даром)/i;

const MAX_WORDS =
  '(?:עד|מתחת ל|מתחת|פחות מ|לא יותר מ|under|below|less than|max|up to|upto|до|менше|не більше|jusqu\'?\\s?à|moins de|hasta|menos de|أقل من|حتى|<=|<)';
const MIN_WORDS =
  '(?:מעל|יותר מ|לפחות|over|above|more than|from|min|at least|от|більше|вище|plus de|à partir de|desde|más de|أكثر من|>=|>)';
const CUR = '(?:₪|ש"ח|שח|שקל(?:ים)?|nis|ils|shekels?|шекел\\w*|шекелів|sheqels?|شيكل)?';
const NUMBER = '(\\d[\\d,.]*)';

const RE_MAX = new RegExp(`${MAX_WORDS}\\s*${CUR}\\s*${NUMBER}\\s*${CUR}`, 'i');
const RE_MIN = new RegExp(`${MIN_WORDS}\\s*${CUR}\\s*${NUMBER}\\s*${CUR}`, 'i');
const RE_BETWEEN = new RegExp(
  `(?:בין|between|entre|между|між|entre|بين)\\s*${CUR}\\s*${NUMBER}\\s*${CUR}\\s*(?:ל-?|ו-?|and|et|y|и|та|و|-|–|—|to)\\s*${CUR}\\s*${NUMBER}`,
  'i'
);
const RE_RANGE = new RegExp(`${NUMBER}\\s*(?:-|–|—)\\s*${NUMBER}\\s*${CUR}`);
const RE_PLAIN_PRICE = new RegExp(`${NUMBER}\\s*(?:₪|ש"ח|שח|שקל(?:ים)?|nis|ils|shekels?|шекел\\w*|شيكل)`, 'i');

/** מילות מפתח לכל אזור (אינדקס זהה ל-kb.REGIONS). */
const REGION_KEYWORDS = [
  ['צפון', 'גליל', 'north', 'galilee', 'север', 'північ', 'nord', 'norte', 'الشمال', 'الجليل'],
  ['חיפה', 'קריות', 'haifa', 'хайфа', 'haïfa', 'حيفا'],
  ['שרון', 'נתניה', 'כפר סבא', 'רעננה', 'הרצליה', 'sharon', 'netanya', 'шарон', 'الشارون'],
  ['גוש דן', 'תל אביב', 'רמת גן', 'פתח תקווה', 'בני ברק', 'חולון', 'בת ים', 'גבעתיים', 'tel aviv', 'gush dan', 'тель-авив', 'тель авив', 'тель-авів', 'تل أبيب'],
  ['ירושלים', 'jerusalem', 'иерусалим', 'єрусалим', 'jérusalem', 'jerusalén', 'القدس'],
  ['שפלה', 'רחובות', 'אשדוד', 'לוד', 'רמלה', 'shfela', 'rehovot', 'ashdod', 'الشفيلا'],
  ['באר שבע', 'דרום', 'beer sheva', 'beersheba', 'south', 'юг', 'південь', 'sud ', 'السبع', 'الجنوب'],
  ['אילת', 'ערבה', 'eilat', 'эйлат', 'ейлат', 'إيلات'],
  ['יהודה', 'שומרון', 'אריאל', 'מעלה אדומים', 'judea', 'samaria', 'иудея', 'юдея'],
  ['משלוח', 'כל הארץ', 'nationwide', 'shipping', 'livraison', 'доставк', 'envío', 'شحن'],
];

/** מילים נרדפות לקטגוריות לפי slug (נבדקות מול הקטגוריות שב-DB). */
const CATEGORY_KEYWORDS = {
  vehicles: ['רכב', 'אופנוע', 'קטנוע', 'אופניים חשמליים', 'טויוטה', 'מאזדה', 'car ', 'motorcycle', 'scooter', 'авто', 'мото', 'voiture', 'coche', 'سيارة'],
  realestate: ['דירה', 'דירות', 'נדלן', 'להשכרה', 'apartment', 'flat', 'rent', 'квартир', 'appartement', 'apartamento', 'شقة'],
  furniture: ['ספה', 'שולחן', 'כיסא', 'מיטה', 'ארון', 'מזרן', 'sofa', 'couch', 'table', 'chair', 'bed', 'wardrobe', 'диван', 'стол', 'кровать', 'canapé', 'mesa', 'cama', 'أريكة'],
  electronics: ['אייפון', 'iphone', 'סמארטפון', 'טלפון', 'סלולרי', 'מחשב', 'לפטופ', 'מחשב נייד', 'טאבלט', 'אייפד', 'מסך', 'מצלמה', 'פלייסטיישן', 'phone', 'laptop', 'tablet', 'ipad', 'samsung', 'playstation', 'телефон', 'ноутбук', 'планшет', 'téléphone', 'ordinateur', 'teléfono', 'portátil', 'هاتف', 'لابتوب'],
  appliances: ['מקרר', 'מכונת כביסה', 'מייבש', 'מדיח', 'תנור', 'מיקרוגל', 'מזגן', 'שואב', 'fridge', 'refrigerator', 'washing machine', 'dishwasher', 'oven', 'microwave', 'air conditioner', 'холодильник', 'стиральн', 'réfrigérateur', 'lave', 'nevera', 'lavadora'],
  fashion: ['שמלה', 'חולצה', 'מעיל', 'נעלים', 'תיק', 'שעון', 'dress', 'shirt', 'jacket', 'shoes', 'bag', 'watch', 'платье', 'куртка', 'обувь', 'robe', 'veste', 'chaussures', 'zapatos'],
  kids: ['עגלה', 'תינוק', 'ילדים', 'צעצוע', 'לגו', 'כסא בטיחות', 'stroller', 'baby', 'kids', 'toy', 'lego', 'car seat', 'коляск', 'детск', 'игрушк', 'poussette', 'bébé', 'jouet', 'cochecito', 'juguete'],
  sport: ['אופניים', 'כושר', 'משקולות', 'הליכון', 'גיטרה', 'קמפינג', 'bike', 'bicycle', 'gym', 'treadmill', 'guitar', 'camping', 'велосипед', 'гитара', 'vélo', 'guitare', 'bicicleta', 'guitarra'],
  pets: ['כלב', 'חתול', 'כלוב', 'אקווריום', 'תוכי', 'dog', 'cat', 'puppy', 'kitten', 'aquarium', 'parrot', 'собака', 'кот', 'chien', 'chat', 'perro', 'gato'],
  tools: ['מקדחה', 'מסור', 'כלי עבודה', 'דשא', 'גינה', 'drill', 'saw', 'tools', 'garden', 'lawn', 'дрель', 'пила', 'инструмент', 'perceuse', 'jardin', 'taladro'],
  jobs: ['עבודה', 'דרושים', 'משרה', 'job', 'hiring', 'vacancy', 'работа', 'вакансия', 'emploi', 'empleo'],
};

/* -------------------------------- עזרים -------------------------------- */

function toNumber(raw) {
  if (raw === undefined || raw === null) return NaN;
  const cleaned = String(raw).replace(/,/g, '').replace(/\.(?=\d{3}\b)/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

function normalizeText(text) {
  return String(text || '')
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .split(/[\s,.;:!?()"/]+/)
    .filter(Boolean);
}

/**
 * התאמת מילת מפתח לטקסט: מילה בודדת מותאמת לטוקן שלם (כולל קידומת עברית ב/ל/מ/ה/ו/ש
 * וסיומות קצרות בשפות אחרות), וביטוי של כמה מילים — כתת-מחרוזת עם גבול.
 * כך "לוד" לא מתאים בטעות ל"מלודי", ו-"cat" לא מתאים ל-"catalog".
 */
function matchesKeyword(tokens, joined, rawWord) {
  const word = String(rawWord || '').trim().toLowerCase();
  if (!word) return false;

  if (word.includes(' ') || word.includes('-')) {
    let from = 0;
    let at = joined.indexOf(word, from);
    while (at !== -1) {
      const before = joined.slice(Math.max(0, at - 3), at);
      if (at === 0 || /(^|\s|[בלמהוש]-?)$/.test(before)) return true;
      from = at + 1;
      at = joined.indexOf(word, from);
    }
    return false;
  }

  return tokens.some((token) => {
    if (token === word) return true;
    const prefixLength = token.length - word.length;
    if (token.endsWith(word) && prefixLength > 0 && prefixLength <= 2 && /^[בלמהוש'-]+$/.test(token.slice(0, prefixLength))) {
      return true;
    }
    return word.length >= 4 && token.startsWith(word) && token.length - word.length <= 3;
  });
}

/** אינדקס אזור (0-9) לפי טקסט חופשי, או -1. */
function regionIndexFromText(text) {
  const joined = normalizeText(text).toLowerCase();
  const tokens = tokenize(text);
  for (let index = 0; index < REGION_KEYWORDS.length; index += 1) {
    if (REGION_KEYWORDS[index].some((word) => matchesKeyword(tokens, joined, word))) return index;
  }
  return -1;
}

/** מסיר מהטקסט את מילות האזור שזוהו (כדי שלא ייכנסו למילת החיפוש). */
function stripRegionWords(text, regionIndex) {
  let out = normalizeText(text);
  const words = REGION_KEYWORDS[regionIndex] || [];

  words
    .filter((word) => word.trim().includes(' ') || word.includes('-'))
    .forEach((word) => {
      const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`(^|\\s)[בלמהוש]?-?${escaped}(?=\\s|$)`, 'i'), ' ');
    });

  const singles = words.filter((word) => !(word.trim().includes(' ') || word.includes('-')));
  out = out
    .split(' ')
    .filter((token) => !singles.some((word) => matchesKeyword([token.toLowerCase()], token.toLowerCase(), word)))
    .join(' ');
  return out;
}

/** מוצא קטגוריה מתאימה מתוך רשימת קטגוריות מה-DB (לפי שם או מילות מפתח). */
function categoryFromText(text, categories = []) {
  const joined = normalizeText(text).toLowerCase();
  if (!joined) return null;
  const tokens = tokenize(text);

  for (const category of categories) {
    const name = String(category.name_he || '').toLowerCase();
    if (name && name.length > 3 && joined.includes(name)) return category;
  }

  for (const category of categories) {
    const words = CATEGORY_KEYWORDS[category.slug] || [];
    if (words.some((word) => matchesKeyword(tokens, joined, word))) return category;
  }
  return null;
}

/* ------------------------------ הבנת טקסט חופשי ------------------------------ */

/**
 * מפרק משפט חופשי למסננים.
 * דוגמה: "אייפון עד 1500 בגוש דן" → { q:'אייפון', maxPrice:1500, regionIndex:3 }
 *
 * @returns {{ q:string, minPrice?:number, maxPrice?:number, freeOnly?:boolean,
 *             regionIndex:number, signals:string[] }}
 */
function parseQuery(input) {
  let text = normalizeText(input);
  const result = { q: '', regionIndex: -1, signals: [] };

  if (FREE_WORDS.test(text)) {
    result.freeOnly = true;
    result.signals.push('free');
    text = text.replace(FREE_WORDS, ' ');
  }

  let match = text.match(RE_BETWEEN);
  if (match) {
    const a = toNumber(match[1]);
    const b = toNumber(match[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      result.minPrice = Math.min(a, b);
      result.maxPrice = Math.max(a, b);
      result.signals.push('price');
      text = text.replace(match[0], ' ');
    }
  }

  if (!result.signals.includes('price')) {
    match = text.match(RE_RANGE);
    if (match) {
      const a = toNumber(match[1]);
      const b = toNumber(match[2]);
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
        result.minPrice = Math.min(a, b);
        result.maxPrice = Math.max(a, b);
        result.signals.push('price');
        text = text.replace(match[0], ' ');
      }
    }
  }

  if (!result.signals.includes('price')) {
    match = text.match(RE_MAX);
    if (match && Number.isFinite(toNumber(match[1]))) {
      result.maxPrice = toNumber(match[1]);
      result.minPrice = 0;
      result.signals.push('price');
      text = text.replace(match[0], ' ');
    }
    match = text.match(RE_MIN);
    if (match && Number.isFinite(toNumber(match[1]))) {
      result.minPrice = toNumber(match[1]);
      if (!result.signals.includes('price')) result.signals.push('price');
      text = text.replace(match[0], ' ');
    }
  }

  if (!result.signals.includes('price')) {
    match = text.match(RE_PLAIN_PRICE);
    if (match && Number.isFinite(toNumber(match[1]))) {
      result.maxPrice = toNumber(match[1]);
      result.minPrice = 0;
      result.signals.push('price');
      text = text.replace(match[0], ' ');
    }
  }

  const regionIndex = regionIndexFromText(text);
  if (regionIndex !== -1) {
    result.regionIndex = regionIndex;
    result.signals.push('region');
    text = stripRegionWords(text, regionIndex);
  }

  // מנקים מילות קישור שנשארו
  text = text
    .replace(/(^|\s)(ב|ל|עם|את|של|in|for|the|a|an|in|в|на|dans|en)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  result.q = text;
  return result;
}

/** הופך את התוצאה של parseQuery למסננים של db.searchListings (+ קטגוריה אם נמצאה). */
function toFilters(parsed, { category = null, regionValues = [] } = {}) {
  const filters = {};
  if (parsed.q) filters.q = parsed.q;
  if (Number.isFinite(parsed.minPrice)) filters.minPrice = parsed.minPrice;
  if (Number.isFinite(parsed.maxPrice)) filters.maxPrice = parsed.maxPrice;
  if (parsed.freeOnly) filters.freeOnly = true;
  if (parsed.regionIndex !== -1 && regionValues[parsed.regionIndex]) {
    filters.location = regionValues[parsed.regionIndex];
  }
  if (category) {
    filters.categoryId = category.id;
    filters.categoryName = `${category.name_he} ${category.emoji}`;
  }
  return filters;
}

/* ----------------------------- חלופות חכמות ----------------------------- */

/**
 * כשאין תוצאות: בודק אילו הקלות על הסינון יחזירו תוצאות.
 * @returns {Promise<Array<{ key:string, total:number, filters:object }>>}
 */
async function relaxations(filters) {
  const db = require('../../db/supabase');
  const options = [];

  const variants = [];
  if (Number.isFinite(filters.minPrice) || Number.isFinite(filters.maxPrice)) {
    const next = { ...filters };
    delete next.minPrice;
    delete next.maxPrice;
    variants.push({ key: 'smart.noPrice', filters: next });
  }
  if (filters.location) {
    const next = { ...filters };
    delete next.location;
    variants.push({ key: 'smart.noRegion', filters: next });
  }
  if (filters.categoryId) {
    const next = { ...filters };
    delete next.categoryId;
    delete next.categoryName;
    variants.push({ key: 'smart.noCat', filters: next });
  }

  await Promise.all(
    variants.map(async (variant) => {
      try {
        const { total } = await db.searchListings(variant.filters, 0, 1);
        if (total > 0) options.push({ ...variant, total });
      } catch (error) {
        console.warn('[ultra:brain] relaxation failed:', error.message);
      }
    })
  );

  return options.sort((a, b) => b.total - a.total);
}

/* ------------------------------ סטטיסטיקת מחירים ------------------------------ */

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * סטטיסטיקה משורות { price, condition, price_type }.
 * מחזיר null כשאין מספיק נתונים (פחות מ-minSample).
 */
function priceStats(rows, { minSample = 3 } = {}) {
  const valid = (rows || []).filter(
    (row) => row && row.price_type !== 'free' && Number(row.price) > 0
  );
  if (valid.length < minSample) return null;

  const prices = valid.map((row) => Number(row.price)).sort((a, b) => a - b);
  const sum = prices.reduce((acc, value) => acc + value, 0);

  const byCondition = {};
  ['new_sealed', 'like_new', 'good', 'parts'].forEach((condition) => {
    const list = valid
      .filter((row) => row.condition === condition)
      .map((row) => Number(row.price))
      .sort((a, b) => a - b);
    if (list.length >= 2) byCondition[condition] = Math.round(percentile(list, 0.5));
  });

  return {
    count: prices.length,
    median: Math.round(percentile(prices, 0.5)),
    average: Math.round(sum / prices.length),
    low: Math.round(percentile(prices, 0.25)),
    high: Math.round(percentile(prices, 0.75)),
    byCondition,
  };
}

/** שולף מחירי שוק של קטגוריה (מודעות מאושרות + שנמכרו). */
async function categoryPriceStats(categoryId) {
  const db = require('../../db/supabase');
  const extra = require('../../db/extra');
  const rows = await extra.safe(
    () =>
      db.supabase
        .from('listings')
        .select('price, condition, price_type')
        .eq('category_id', categoryId)
        .in('status', ['approved', 'sold'])
        .limit(3000),
    [],
    'ultra:categoryPriceStats'
  );
  return priceStats(rows);
}

/* ------------------------------- ציון איכות ------------------------------- */

const SCORE_RULES = [
  { id: 'title', weight: 15 },
  { id: 'desc', weight: 20 },
  { id: 'photos', weight: 25 },
  { id: 'price', weight: 10 },
  { id: 'market', weight: 15 },
  { id: 'location', weight: 5 },
  { id: 'contact', weight: 10 },
];

/**
 * ציון 0-100 למודעה + פירוט לכל קריטריון.
 * @param {object} listing  שורת מודעה (עם seller אם קיים)
 * @param {{median?:number}|null} market  תוצאת priceStats (אופציונלי)
 */
function scoreListing(listing, market = null) {
  const item = listing || {};
  const title = String(item.title || '').trim();
  const desc = String(item.description || '').trim();
  const photos = Array.isArray(item.photos) ? item.photos.length : 0;
  const seller = item.seller || {};
  const price = Number(item.price || 0);
  const isFree = item.price_type === 'free';

  const checks = {};

  // כותרת: 15-50 תווים מלא, 8-14 חלקי
  if (title.length >= 15 && title.length <= 50) checks.title = 1;
  else if (title.length >= 8) checks.title = 0.5;
  else checks.title = 0;

  // תיאור: 80+ מלא, 30-79 חלקי
  if (desc.length >= 80) checks.desc = 1;
  else if (desc.length >= 30) checks.desc = 0.5;
  else checks.desc = 0;

  // תמונות: 3+ מלא, 2 כמעט, 1 חלקי
  if (photos >= 3) checks.photos = 1;
  else if (photos === 2) checks.photos = 0.7;
  else if (photos === 1) checks.photos = 0.4;
  else checks.photos = 0;

  checks.price = isFree || price > 0 ? 1 : 0;

  // התאמה לשוק: בתוך 50%-150% מהחציון. אין נתוני שוק → זכות הספק (מלא).
  if (isFree || !market || !market.median) checks.market = 1;
  else {
    const ratio = price / market.median;
    if (ratio >= 0.5 && ratio <= 1.5) checks.market = 1;
    else if (ratio >= 0.3 && ratio <= 2.2) checks.market = 0.5;
    else checks.market = 0;
  }

  checks.location = String(item.location || '').trim() ? 1 : 0;
  checks.contact = seller.username || seller.phone_number ? 1 : 0;

  let score = 0;
  const details = SCORE_RULES.map((rule) => {
    const ratio = checks[rule.id];
    const points = Math.round(rule.weight * ratio);
    score += points;
    return { id: rule.id, ratio, points, weight: rule.weight, ok: ratio >= 1 };
  });

  return { score: Math.min(100, score), details };
}

module.exports = {
  parseQuery,
  toFilters,
  regionIndexFromText,
  categoryFromText,
  relaxations,
  priceStats,
  categoryPriceStats,
  scoreListing,
  SCORE_RULES,
  REGION_KEYWORDS,
  CATEGORY_KEYWORDS,
};
