'use strict';

/**
 * שירות "יעדים" — לאן הבוט מפרסם מודעות (ערוצים) ולאן הוא שולח בקשות אישור (קבוצות אדמין).
 *
 * עקרון: קודם בודקים את טבלת bot_destinations (ניתנת לניהול דרך פאנל האדמין,
 * ראה src/bot/handlers/channels.js), ואם היא ריקה — נופלים חזרה למשתני הסביבה
 * CHANNEL_ID / ADMIN_GROUP_ID כדי לשמור על תאימות מלאה אחורה.
 *
 * חוסן: אם המיגרציה (schema_channels.sql) עדיין לא הורצה ב-Supabase, הקריאות
 * ל-DB נכשלות בשקט (מטופל כבר בתוך db/supabase.js) והשירות פשוט משתמש ב-ENV.
 */

const env = require('../config/env');
const db = require('../db/supabase');

/** האם ה-chat id הוא ערך תקין (לא ריק, ולא הפלייסהולדר "0"). */
function isValidChatId(id) {
  if (id === null || id === undefined) return false;
  const value = String(id).trim();
  return value !== '' && value !== '0';
}

/** רשימת מזהי הצ'אטים שאליהם מפרסמים מודעות מאושרות. */
async function getChannelIds() {
  const rows = await db.listDestinations('channel');
  const ids = (rows || []).map((row) => row.chat_id).filter(isValidChatId);
  if (ids.length) return ids;
  return isValidChatId(env.CHANNEL_ID) ? [env.CHANNEL_ID] : [];
}

/** רשימת מזהי הצ'אטים (קבוצות) שאליהם נשלחות בקשות אישור מנהל. */
async function getAdminGroupIds() {
  const rows = await db.listDestinations('admin_group');
  const ids = (rows || []).map((row) => row.chat_id).filter(isValidChatId);
  if (ids.length) return ids;
  return isValidChatId(env.ADMIN_GROUP_ID) ? [env.ADMIN_GROUP_ID] : [];
}

module.exports = {
  isValidChatId,
  getChannelIds,
  getAdminGroupIds,
};
