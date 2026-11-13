'use strict';

/**
 * ULTRA — שכבת השדרוג השלישית (מעל הבסיס ומעל PRO).
 * כל הקבצים כאן חדשים; שום לוגיקה קיימת לא הוחלפה.
 *
 *   register(bot)  — רישום פקודות, כפתורים וחיפוש חכם (נקרא מ-bot/index.js אחרי pro.register)
 *   renderHub(ctx) — מסך הבית המעוצב (נקרא ממסך /start אם קיים)
 */

const handlers = require('./handlers');

module.exports = {
  register: handlers.register,
  renderHub: handlers.renderHub,
  showHealth: handlers.showHealth,
  showDigest: handlers.showDigest,
};
