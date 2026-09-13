'use strict';

/**
 * תרגום הטקסונומיה של המערכת (מצב מוצר ואזורים).
 *
 * חשוב: הערכים ב-DB נשארים בדיוק כפי שהם (מפתחות מצב באנגלית, אזורים בעברית) —
 * כאן מתרגמים רק את מה שמוצג למשתמש, כך שאין שבירה של נתונים קיימים.
 */

const kb = require('../bot/keyboards');

const CONDITIONS = {
  he: {
    new_sealed: 'חדש באריזה 🎁',
    like_new: 'כמו חדש ✨',
    good: 'משומש במצב טוב 👍',
    parts: 'לא עובד / לחלקים 🛠️',
  },
  en: {
    new_sealed: 'Brand new, sealed 🎁',
    like_new: 'Like new ✨',
    good: 'Used, good condition 👍',
    parts: 'Not working / for parts 🛠️',
  },
  ar: {
    new_sealed: 'جديد بالعلبة 🎁',
    like_new: 'كالجديد ✨',
    good: 'مستعمل بحالة جيدة 👍',
    parts: 'لا يعمل / لقطع الغيار 🛠️',
  },
  ru: {
    new_sealed: 'Новое в упаковке 🎁',
    like_new: 'Как новое ✨',
    good: 'Б/у, хорошее состояние 👍',
    parts: 'Не работает / на запчасти 🛠️',
  },
  uk: {
    new_sealed: 'Нове в упаковці 🎁',
    like_new: 'Як нове ✨',
    good: 'Вживане, гарний стан 👍',
    parts: 'Не працює / на запчастини 🛠️',
  },
  fr: {
    new_sealed: 'Neuf sous emballage 🎁',
    like_new: 'Comme neuf ✨',
    good: 'Occasion, bon état 👍',
    parts: 'En panne / pour pièces 🛠️',
  },
  es: {
    new_sealed: 'Nuevo y precintado 🎁',
    like_new: 'Como nuevo ✨',
    good: 'Usado, buen estado 👍',
    parts: 'No funciona / para piezas 🛠️',
  },
};

/** אזורים לפי אינדקס — חייב להישאר באותו סדר כמו kb.REGIONS. */
const REGIONS = {
  he: kb.REGIONS,
  en: [
    'North & Galilee',
    'Haifa area',
    'Sharon',
    'Gush Dan (Tel Aviv)',
    'Jerusalem area',
    'Shfela',
    'South & Beer Sheva',
    'Eilat & Arava',
    'Judea & Samaria',
    'Nationwide / shipping',
  ],
  ar: [
    'الشمال والجليل',
    'حيفا والكريوت',
    'الشارون',
    'غوش دان (تل أبيب)',
    'القدس والمحيط',
    'الشفيلا',
    'الجنوب وبئر السبع',
    'إيلات والعربة',
    'يهودا والسامرة',
    'كل البلاد / شحن',
  ],
  ru: [
    'Север и Галилея',
    'Хайфа и Крайот',
    'Шарон',
    'Гуш-Дан (Тель-Авив)',
    'Иерусалим и окрестности',
    'Шфела',
    'Юг и Беэр-Шева',
    'Эйлат и Арава',
    'Иудея и Самария',
    'По всей стране / доставка',
  ],
  uk: [
    'Північ і Галілея',
    'Хайфа і Крайот',
    'Шарон',
    'Гуш-Дан (Тель-Авів)',
    'Єрусалим і околиці',
    'Шфела',
    'Південь і Беер-Шева',
    'Ейлат і Арава',
    'Юдея і Самарія',
    'По всій країні / доставка',
  ],
  fr: [
    'Nord & Galilée',
    'Haïfa et environs',
    'Sharon',
    'Gush Dan (Tel Aviv)',
    'Jérusalem et environs',
    'Shfela',
    'Sud & Beer Sheva',
    'Eilat & Arava',
    'Judée & Samarie',
    'Tout le pays / livraison',
  ],
  es: [
    'Norte y Galilea',
    'Haifa y alrededores',
    'Sharon',
    'Gush Dan (Tel Aviv)',
    'Jerusalén y alrededores',
    'Shfela',
    'Sur y Beer Sheva',
    'Eilat y Arava',
    'Judea y Samaria',
    'Todo el país / envío',
  ],
};

function conditionLabel(key, lang) {
  const dict = CONDITIONS[lang] || CONDITIONS.he;
  return dict[key] || CONDITIONS.he[key] || '—';
}

/** מקבל את הערך כפי שנשמר ב-DB (עברית) ומחזיר תווית בשפת המשתמש. */
function regionLabel(value, lang) {
  const index = kb.REGIONS.indexOf(value);
  if (index === -1) return value;
  const list = REGIONS[lang] || REGIONS.he;
  return list[index] || value;
}

/** רשימת אזורים בשפת המשתמש, עם הערך המקורי לשמירה ב-DB. */
function regionOptions(lang) {
  const list = REGIONS[lang] || REGIONS.he;
  return kb.REGIONS.map((value, index) => ({ index, value, label: list[index] || value }));
}

module.exports = { CONDITIONS, REGIONS, conditionLabel, regionLabel, regionOptions };
