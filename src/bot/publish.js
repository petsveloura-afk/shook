'use strict';

/**
 * שירות הפרסום בערוץ — פרסום, סימון "נמכר", הסרה והקפצה.
 * משותף ל-handlers/admin.js ול-handlers/user.js (ללא תלות מעגלית).
 */

const env = require('../config/env');
const db = require('../db/supabase');
const fmt = require('./formatters');
const kb = require('./keyboards');

/** האם הפוסט בערוץ נשלח כתמונה בודדת עם caption. */
function isSinglePhotoPost(listing) {
  const photos = listing.photos || [];
  return photos.length === 1;
}

/**
 * מפרסם מודעה בערוץ.
 * 1 תמונה  -> sendPhoto עם caption + כפתורים.
 * 2+ תמונות -> sendMediaGroup (אלבום) + הודעת טקסט עם הכפתורים.
 * 0 תמונות -> הודעת טקסט בלבד.
 */
async function publishListing(telegram, listingId) {
  const listing = await db.getListing(listingId);
  if (!listing) throw new Error(`listing ${listingId} not found`);
  if (!env.CHANNEL_ID) throw new Error('CHANNEL_ID is not configured');

  const approvedAt = listing.approved_at || new Date().toISOString();
  const enriched = { ...listing, approved_at: approvedAt };
  const text = fmt.channelPost(enriched);
  const keyboard = kb.channelKeyboard(listing.id);
  const photos = listing.photos || [];

  let mainMessageId = null;
  let mediaMessageIds = [];

  if (photos.length === 1) {
    const message = await telegram.sendPhoto(env.CHANNEL_ID, photos[0], {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
    });
    mainMessageId = message.message_id;
  } else if (photos.length > 1) {
    const album = await telegram.sendMediaGroup(
      env.CHANNEL_ID,
      photos.slice(0, env.MAX_PHOTOS).map((fileId) => ({ type: 'photo', media: fileId }))
    );
    mediaMessageIds = album.map((message) => message.message_id);
    const message = await telegram.sendMessage(env.CHANNEL_ID, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
      reply_to_message_id: mediaMessageIds[0],
      allow_sending_without_reply: true,
      disable_web_page_preview: true,
    });
    mainMessageId = message.message_id;
  } else {
    const message = await telegram.sendMessage(env.CHANNEL_ID, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
      disable_web_page_preview: true,
    });
    mainMessageId = message.message_id;
  }

  return db.updateListing(listing.id, {
    status: 'approved',
    reject_reason: null,
    approved_at: approvedAt,
    channel_message_id: mainMessageId,
    channel_media_message_ids: mediaMessageIds,
  });
}

/** מעדכן את הפוסט בערוץ עם תג "נמכר" ומסיר את כפתורי הרכישה. */
async function markSoldInChannel(telegram, listing) {
  if (!env.CHANNEL_ID || !listing.channel_message_id) return null;

  const text = fmt.channelPost(listing, { sold: true });
  const keyboard = { inline_keyboard: [[{ text: '🤖 לפרסום מודעה דרך הבוט', url: env.botLink('publish') }]] };

  try {
    if (isSinglePhotoPost(listing)) {
      await telegram.editMessageCaption(
        env.CHANNEL_ID,
        listing.channel_message_id,
        undefined,
        text,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    } else {
      await telegram.editMessageText(
        env.CHANNEL_ID,
        listing.channel_message_id,
        undefined,
        text,
        { parse_mode: 'HTML', reply_markup: keyboard, disable_web_page_preview: true }
      );
    }
  } catch (error) {
    console.error('[publish] markSoldInChannel failed:', error.message);
  }
  return true;
}

/** מוחק את הפוסט (וגם את האלבום) מהערוץ. */
async function removeFromChannel(telegram, listing) {
  if (!env.CHANNEL_ID) return false;

  const ids = [];
  if (listing.channel_message_id) ids.push(listing.channel_message_id);
  (listing.channel_media_message_ids || []).forEach((id) => ids.push(id));

  for (const messageId of ids) {
    try {
      await telegram.deleteMessage(env.CHANNEL_ID, messageId);
    } catch (error) {
      // הודעות מעל 48 שעות לא ניתנות למחיקה — לא נכשלים על כך.
      console.warn(`[publish] deleteMessage ${messageId} failed: ${error.message}`);
    }
  }
  return true;
}

/** הקפצת מודעה: מסירים את הפוסט הקיים ומפרסמים מחדש בראש הערוץ. */
async function bumpListing(telegram, listingId) {
  const listing = await db.getListing(listingId);
  if (!listing) throw new Error(`listing ${listingId} not found`);

  await removeFromChannel(telegram, listing);
  await db.updateListing(listing.id, {
    channel_message_id: null,
    channel_media_message_ids: [],
    bumped_at: new Date().toISOString(),
  });
  return publishListing(telegram, listing.id);
}

module.exports = {
  publishListing,
  markSoldInChannel,
  removeFromChannel,
  bumpListing,
  isSinglePhotoPost,
};
