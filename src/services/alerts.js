'use strict';

/**
 * מנוע ההתראות: אחרי שמודעה מאושרת ומתפרסמת, כל מי ששמר חיפוש תואם
 * מקבל התראה מיידית — בשפה שלו, עם כפתור ישיר למודעה.
 */

const env = require('../config/env');
const extra = require('../db/extra');
const i18n = require('../i18n');
const fmtPro = require('../bot/formatters_pro');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** האם המודעה תואמת לחיפוש השמור. */
function matches(listing, search) {
  if (search.category_id && Number(search.category_id) !== Number(listing.category_id)) return false;
  if (search.location && search.location !== listing.location) return false;
  if (search.free_only && listing.price_type !== 'free') return false;

  const price = Number(listing.price || 0);
  if (search.min_price !== null && search.min_price !== undefined && price < Number(search.min_price)) return false;
  if (search.max_price !== null && search.max_price !== undefined && price > Number(search.max_price)) return false;

  if (search.q) {
    const needle = String(search.q).toLowerCase();
    const haystack = `${listing.title || ''} ${listing.description || ''}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * מריץ התאמה מול כל ההתראות הפעילות ושולח הודעות.
 * @returns {Promise<number>} מספר ההתראות שנשלחו
 */
async function notifyMatches(telegram, listing) {
  if (!listing || listing.status !== 'approved') return 0;

  const searches = await extra.listActiveSavedSearches();
  if (!searches.length) return 0;

  const seen = new Set();
  let sent = 0;

  for (const search of searches) {
    const user = search.user;
    if (!user || user.status !== 'active') continue;
    if (user.notifications_enabled === false) continue;
    if (Number(user.id) === Number(listing.user_id)) continue; // לא שולחים למוכר עצמו
    if (seen.has(user.telegram_id)) continue;
    if (!matches(listing, search)) continue;

    const lang = i18n.normalize(user.language) || i18n.DEFAULT_LANG;
    const t = i18n.translator(lang);

    const text = `${t('alerts.newMatch')}\n\n${fmtPro.listingCard(listing, lang)}`;
    const keyboard = {
      inline_keyboard: [
        [{ text: t('common.more'), url: env.botLink(`ad_${listing.id}`) }],
        [{ text: t('alerts.title').replace(/<\/?b>/g, ''), url: env.botLink('alerts') }],
      ],
    };

    try {
      await telegram.sendMessage(user.telegram_id, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: keyboard,
      });
      seen.add(user.telegram_id);
      sent += 1;
      await extra.touchSavedSearch(search.id, Number(search.hits_count || 0) + 1);
    } catch (error) {
      console.warn(`[alerts] notify ${user.telegram_id} failed: ${error.message}`);
    }

    await sleep(40);
    if (sent >= 200) break; // הגנה מפני הצפה בריצה אחת
  }

  await extra.logEvent('alerts_dispatched', listing.user_id, { listing_id: listing.id, sent });
  return sent;
}

module.exports = { matches, notifyMatches };
