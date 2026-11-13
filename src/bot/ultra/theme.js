'use strict';

/**
 * ULTRA — שכבת עיצוב: מפרידים, איורי אמוג'י, מדי התקדמות, ברכה לפי שעה, טיפים.
 * קובץ טהור (ללא תלות ב-DB / טלגרם) ולכן קל לבדיקה.
 */

const { ut, TIP_COUNT } = require('../../i18n/ultra');

const DIVIDER = '━━━━━━━━━━━━━━━';
const SOFT_DIVIDER = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';

/* ------------------------------ זמן וברכות ------------------------------ */

/** שעה נוכחית בישראל (0-23). נופל ל-UTC+2 אם Intl לא זמין. */
function israelHour(date = new Date()) {
  try {
    const hour = new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Jerusalem',
    }).format(date);
    return Number(hour) % 24;
  } catch (error) {
    return (date.getUTCHours() + 2) % 24;
  }
}

function dayPart(hour = israelHour()) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'noon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

const PART_EMOJI = { morning: '🌅', noon: '☀️', evening: '🌇', night: '🌙' };

function greeting(lang, name, date = new Date()) {
  const part = dayPart(israelHour(date));
  return `${PART_EMOJI[part]} <b>${ut(lang, `greet.${part}`)}, ${name}!</b>`;
}

/* ------------------------------ איורי אמוג'י ------------------------------ */

const SCENES = {
  hub: ['🏷️ ✨ 🛍️ ✨ 🛒 ✨ 🏷️', '╰┈➤ 🏪 ➤┈╯'],
  tools: ['🧰 ⚙️ 🧠 ⚙️ 🧰'],
  price: ['💰 📈 🪙 📉 💰'],
  score: ['📈 ⭐ 🏆 ⭐ 📈'],
  guide: ['📖 ✨ 🧭 ✨ 📖'],
  safety: ['🛡️ 🤝 🔒 🤝 🛡️'],
  tips: ['💡 ✨ 💡'],
  empty: ['🔎 💨 🕵️ 💨 🔎'],
  health: ['🩺 💚 🖥️ 💚 🩺'],
  digest: ['📅 📊 ✨ 📊 📅'],
};

function scene(name) {
  return (SCENES[name] || SCENES.hub).join('\n');
}

/* ------------------------------ רכיבי תצוגה ------------------------------ */

/** בר התקדמות ▰▱ באורך קבוע. */
function meter(value, max = 100, width = 10) {
  const safeMax = Math.max(Number(max) || 0, 1);
  const filled = Math.round((Math.max(Number(value) || 0, 0) / safeMax) * width);
  const used = Math.min(filled, width);
  return '▰'.repeat(used) + '▱'.repeat(width - used);
}

function scoreEmoji(score) {
  if (score >= 90) return '🏆';
  if (score >= 70) return '🟢';
  if (score >= 45) return '🟡';
  return '🔴';
}

function scoreLevelKey(score) {
  if (score >= 90) return 'score.great';
  if (score >= 70) return 'score.good';
  if (score >= 45) return 'score.fair';
  return 'score.weak';
}

/** גרף קטן ▁▂▃▄▅▆▇█ מסדרת {day,value} או מערך מספרים. */
function spark(series) {
  const values = (series || []).map((point) => Number(point && point.value !== undefined ? point.value : point) || 0);
  if (!values.length) return '';
  const levels = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values, 1);
  return values.map((value) => levels[Math.min(levels.length - 1, Math.round((value / max) * (levels.length - 1)))]).join('');
}

/** מספר עם מפריד אלפים. */
function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

/** בריחה ל-HTML של טלגרם. */
function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** מחלק מערך לשורות באורך קבוע (לכפתורים). */
function chunk(items, size = 2) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** מסגרת כותרת אחידה לכל המסכים: סצנה + כותרת + קו. */
function frame(sceneName, title, lines = []) {
  return [scene(sceneName), title, DIVIDER, ...lines].join('\n');
}

/* ----------------------------------- טיפים ----------------------------------- */

/** טיפ לפי אינדקס (מחזורי). בלי אינדקס — טיפ של היום (קבוע לאורך היום). */
function tipIndex(index) {
  if (Number.isInteger(index)) return ((index % TIP_COUNT) + TIP_COUNT) % TIP_COUNT;
  const day = Math.floor(Date.now() / 86400000);
  return day % TIP_COUNT;
}

function tip(lang, index) {
  return ut(lang, `tip.${tipIndex(index) + 1}`);
}

module.exports = {
  DIVIDER,
  SOFT_DIVIDER,
  israelHour,
  dayPart,
  greeting,
  scene,
  meter,
  spark,
  scoreEmoji,
  scoreLevelKey,
  num,
  esc,
  chunk,
  frame,
  tipIndex,
  tip,
};
