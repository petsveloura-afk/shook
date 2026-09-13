'use strict';

/**
 * שכבת הגנה מפני ספאם והצפה — נבדקת רגע לפני שליחת מודעה למודרציה.
 * מחזירה תוצאה מובנית עם מפתח תרגום, כך שההודעה תוצג בשפת המשתמש.
 */

const extra = require('../db/extra');

/** נירמול טקסט לצורך השוואה (הסרת ניקוד, רווחים כפולים, אותיות גדולות). */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** בדיקת מילים חסומות בכל טקסט. מחזירה את המילה שנתפסה או null. */
async function findBlockedWord(text) {
  const words = await extra.listBlockedWords();
  if (!words.length) return null;

  const haystack = normalize(text);
  for (const entry of words) {
    const needle = normalize(entry.word);
    if (needle && haystack.includes(needle)) {
      return { word: entry.word, severity: entry.severity || 'block' };
    }
  }
  return null;
}

/**
 * בדיקה מלאה של טיוטת מודעה.
 * @returns {{ok: boolean, key?: string, vars?: object, flag?: object}}
 */
async function checkDraft(user, draft) {
  const settings = await extra.getSettings();
  const maxPerDay = Number(settings.max_ads_per_day || 5);

  // 1. מגבלת מודעות יומית
  const postedToday = await extra.countUserListingsSince(user.id, 24);
  if (postedToday >= maxPerDay) {
    return { ok: false, key: 'spam.limit', vars: { max: maxPerDay } };
  }

  // 2. מילים חסומות
  const hit = await findBlockedWord(`${draft.title || ''} ${draft.description || ''}`);
  if (hit && hit.severity === 'block') {
    return { ok: false, key: 'spam.blocked', vars: { word: hit.word } };
  }

  // 3. מודעה כפולה עם אותה כותרת
  const duplicate = await extra.findDuplicateListing(user.id, draft.title);
  if (duplicate) {
    return { ok: false, key: 'spam.duplicate', vars: { id: duplicate.id } };
  }

  // 4. חובת תמונה (ניתן לכיבוי מהגדרות המערכת)
  if (settings.require_photo && (!draft.photos || !draft.photos.length)) {
    return { ok: false, key: 'spam.blocked', vars: { word: '📸' } };
  }

  return { ok: true, flag: hit && hit.severity === 'flag' ? hit : null };
}

/** האם המערכת בתחזוקה (חוסם פרסום מודעות חדשות). */
async function isMaintenance() {
  const value = await extra.getSetting('maintenance_mode');
  return value === true || value === 'true';
}

/** האם אישור אוטומטי מופעל. */
async function isAutoApprove() {
  const value = await extra.getSetting('auto_approve');
  return value === true || value === 'true';
}

module.exports = {
  normalize,
  findBlockedWord,
  checkDraft,
  isMaintenance,
  isAutoApprove,
};
