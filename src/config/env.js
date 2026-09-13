'use strict';

/**
 * טעינה + ולידציה של משתני הסביבה.
 * נטען פעם אחת ומשותף לכל המודולים (Vercel / HF Spaces / Local).
 */

try {
  // בסביבת Vercel אין קובץ .env – dotenv פשוט לא ימצא כלום וזה תקין.
  require('dotenv').config();
} catch (err) {
  console.warn('[env] dotenv not loaded:', err.message);
}

function str(name, fallback = null) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value).trim();
}

function int(name, fallback) {
  const raw = str(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(name) {
  const raw = str(name, '');
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const env = {
  // Telegram
  BOT_TOKEN: str('BOT_TOKEN'),
  BOT_USERNAME: (str('BOT_USERNAME', '') || '').replace(/^@/, ''),
  CHANNEL_ID: str('CHANNEL_ID'),
  CHANNEL_URL: str('CHANNEL_URL', ''),
  ADMIN_GROUP_ID: str('ADMIN_GROUP_ID'),
  ADMIN_IDS: list('ADMIN_IDS').map((id) => String(id)),
  SUPPORT_USERNAME: (str('SUPPORT_USERNAME', '') || '').replace(/^@/, ''),

  // Supabase
  SUPABASE_URL: str('SUPABASE_URL'),
  SUPABASE_KEY: str('SUPABASE_SERVICE_ROLE_KEY') || str('SUPABASE_KEY'),

  // Webhook / runtime
  PUBLIC_URL: (str('PUBLIC_URL', '') || '').replace(/\/+$/, ''),
  WEBHOOK_SECRET: str('WEBHOOK_SECRET', ''),
  WEBHOOK_PATH: str('WEBHOOK_PATH', '/api/webhook'),
  MODE: (str('MODE', 'polling') || 'polling').toLowerCase(),
  PORT: int('PORT', 7860),
  NODE_ENV: str('NODE_ENV', 'production'),

  // Tunables
  PAGE_SIZE: int('PAGE_SIZE', 1),
  MAX_PHOTOS: int('MAX_PHOTOS', 5),
  BUMP_COOLDOWN_HOURS: int('BUMP_COOLDOWN_HOURS', 24),
  BROADCAST_DELAY_MS: int('BROADCAST_DELAY_MS', 45),
};

/**
 * הגנה מפני פלייסהולדר "0" שנשאר בטעות ב-CHANNEL_ID / ADMIN_GROUP_ID.
 * "0" הוא מחרוזת לא ריקה ולכן נחשב "מוגדר" בבדיקות רגילות (truthy),
 * אבל אינו chat_id תקין בטלגרם — מתייחסים אליו כאילו לא הוגדר בכלל,
 * כדי שהקוד ינסה לשלוח הודעות במקום להיכשל בשקט מול chat "0" שלא קיים.
 */
['CHANNEL_ID', 'ADMIN_GROUP_ID'].forEach((key) => {
  if (env[key] === '0') env[key] = null;
});

/** בדיקת חובה – נזרקת שגיאה ברורה בעברית/אנגלית אם חסר משתנה קריטי. */
const REQUIRED = ['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];

const missing = REQUIRED.filter((key) => !env[key]);
if (missing.length) {
  throw new Error(
    `[env] Missing required environment variables: ${missing.join(', ')}. ` +
      'העתק את .env.example ל-.env (או הגדר Environment Variables בפלטפורמת הפריסה) והשלם את הערכים.'
  );
}

const WARN_IF_EMPTY = ['CHANNEL_ID', 'ADMIN_GROUP_ID', 'ADMIN_IDS', 'BOT_USERNAME'];
WARN_IF_EMPTY.forEach((key) => {
  const value = env[key];
  const empty = Array.isArray(value) ? value.length === 0 : !value;
  if (empty) {
    console.warn(`[env] Warning: ${key} is not set – חלק מהפיצ'רים לא יעבדו עד שתגדיר אותו.`);
  }
});

env.isAdmin = function isAdmin(telegramId) {
  if (!telegramId) return false;
  return env.ADMIN_IDS.includes(String(telegramId));
};

env.botLink = function botLink(payload) {
  const base = env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}` : 'https://t.me';
  return payload ? `${base}?start=${encodeURIComponent(payload)}` : base;
};

env.webhookUrl = function webhookUrl() {
  if (!env.PUBLIC_URL) return null;
  return `${env.PUBLIC_URL}${env.WEBHOOK_PATH}`;
};

module.exports = env;
