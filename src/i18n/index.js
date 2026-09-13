'use strict';

/**
 * מנוע ריבוי-שפות (i18n).
 *
 * • כל שפה היא קובץ שטוח של מפתחות ב-src/i18n/locales/<code>.js
 * • הוספת שפה חדשה = העתקת en.js, תרגום, והוספת הקוד ל-SUPPORTED כאן. זהו.
 * • שרשרת נפילה (fallback): שפת המשתמש ← אנגלית ← עברית ← המפתח עצמו.
 */

const he = require('./locales/he');
const en = require('./locales/en');
const ar = require('./locales/ar');
const ru = require('./locales/ru');
const fr = require('./locales/fr');
const es = require('./locales/es');
const uk = require('./locales/uk');

const LOCALES = { he, en, ar, ru, fr, es, uk };

const SUPPORTED = Object.keys(LOCALES);
const DEFAULT_LANG = 'he';
const FALLBACK_CHAIN = ['en', 'he'];

/** מיפוי קודי שפה של טלגרם (language_code) לשפות הנתמכות. */
const TELEGRAM_MAP = {
  he: 'he',
  iw: 'he',
  en: 'en',
  ar: 'ar',
  ru: 'ru',
  be: 'ru',
  kk: 'ru',
  uk: 'uk',
  fr: 'fr',
  es: 'es',
  ca: 'es',
  gl: 'es',
  pt: 'es',
};

const RTL = new Set(['he', 'ar']);

function isSupported(lang) {
  return Boolean(lang && SUPPORTED.includes(lang));
}

function normalize(lang) {
  if (!lang) return null;
  const base = String(lang).toLowerCase().split('-')[0];
  if (isSupported(base)) return base;
  return TELEGRAM_MAP[base] || null;
}

/** החלפת {placeholders} בערכים. */
function interpolate(template, vars) {
  if (!vars) return template;
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

/** תרגום מפתח לשפה מבוקשת. */
function t(lang, key, vars) {
  const chain = [normalize(lang) || DEFAULT_LANG, ...FALLBACK_CHAIN];
  for (const code of chain) {
    const dict = LOCALES[code];
    if (dict && dict[key] !== undefined) return interpolate(dict[key], vars);
  }
  return key;
}

/** יוצר פונקציית t() צמודה לשפה אחת. */
function translator(lang) {
  const code = normalize(lang) || DEFAULT_LANG;
  const fn = (key, vars) => t(code, key, vars);
  fn.lang = code;
  fn.isRTL = RTL.has(code);
  return fn;
}

function localeName(lang) {
  const code = normalize(lang) || DEFAULT_LANG;
  return `${LOCALES[code]['locale.flag']} ${LOCALES[code]['locale.name']}`;
}

function localeList() {
  return SUPPORTED.map((code) => ({
    code,
    name: LOCALES[code]['locale.name'],
    flag: LOCALES[code]['locale.flag'],
    rtl: RTL.has(code),
  }));
}

/**
 * זיהוי שפת המשתמש לפי סדר עדיפות:
 * 1. שדה language בטבלת users  2. סשן  3. language_code של טלגרם  4. ברירת מחדל
 */
function detect({ dbUser, session, from } = {}) {
  const fromDb = dbUser && normalize(dbUser.language);
  if (fromDb) return fromDb;

  const fromSession = session && normalize(session.lang);
  if (fromSession) return fromSession;

  const fromTelegram = from && normalize(from.language_code);
  if (fromTelegram) return fromTelegram;

  return DEFAULT_LANG;
}

/** כל הערכים של מפתח מסוים בכל השפות — משמש לזיהוי לחיצות תפריט בכל שפה. */
function allValues(key) {
  return SUPPORTED.map((code) => LOCALES[code][key]).filter(Boolean);
}

module.exports = {
  LOCALES,
  SUPPORTED,
  DEFAULT_LANG,
  RTL,
  t,
  translator,
  normalize,
  isSupported,
  detect,
  localeName,
  localeList,
  allValues,
  interpolate,
};
