'use strict';

/**
 * מכונת המצבים (FSM) ליצירת מודעה חדשה.
 * המצב נשמר ב-DB (טבלת sessions) ולכן עובד גם ב-Serverless (Vercel).
 *
 * States:
 *   ad:CATEGORY -> ad:TITLE -> ad:DESC -> ad:CONDITION -> ad:PRICE
 *   -> ad:LOCATION -> ad:PHOTOS -> ad:PREVIEW
 */

const env = require('../../config/env');
const db = require('../../db/supabase');
const kb = require('../keyboards');
const fmt = require('../formatters');

const LIMITS = {
  TITLE_MIN: 5,
  TITLE_MAX: 50,
  DESC_MIN: 10,
  DESC_MAX: 500,
  PRICE_MAX: 100000000,
};

/* ------------------------------- עזרי מצב ------------------------------- */

function draftOf(ctx) {
  if (!ctx.session.draft) ctx.session.draft = { photos: [] };
  if (!Array.isArray(ctx.session.draft.photos)) ctx.session.draft.photos = [];
  return ctx.session.draft;
}

function setState(ctx, state) {
  ctx.session.state = state;
}

function clearWizard(ctx) {
  delete ctx.session.state;
  delete ctx.session.draft;
}

async function categoryName(categoryId) {
  if (!categoryId) return 'שונות ✨';
  const category = await db.getCategory(categoryId);
  return category ? `${category.name_he} ${category.emoji}` : 'שונות ✨';
}

/* ------------------------------- שלבי האשף ------------------------------- */

async function start(ctx) {
  ctx.session.draft = { photos: [] };
  await ctx.reply(
    '➕ <b>פרסום מודעה חדשה</b>\n\nנתחיל! בכל שלב ניתן לבטל בלחיצה על «❌ ביטול».',
    { parse_mode: 'HTML', ...kb.cancelOnly() }
  );
  return askCategory(ctx);
}

async function askCategory(ctx) {
  const categories = await db.listCategories();
  if (!categories.length) {
    clearWizard(ctx);
    return ctx.reply('⚠️ אין קטגוריות מוגדרות במערכת. פנה למנהל.', kb.mainMenu());
  }
  setState(ctx, 'ad:CATEGORY');
  return ctx.reply('1️⃣ <b>בחר קטגוריה למודעה:</b>', {
    parse_mode: 'HTML',
    ...kb.categoriesGrid(categories, 'cat:'),
  });
}

async function askTitle(ctx) {
  setState(ctx, 'ad:TITLE');
  return ctx.reply(
    `2️⃣ <b>מה שם המוצר?</b>\n\nכתוב כותרת קצרה וברורה (${LIMITS.TITLE_MIN}-${LIMITS.TITLE_MAX} תווים).\nלדוגמה: <i>אייפון 13 128GB שחור</i>`,
    { parse_mode: 'HTML', ...kb.cancelOnly() }
  );
}

async function askDescription(ctx) {
  setState(ctx, 'ad:DESC');
  return ctx.reply(
    `3️⃣ <b>תיאור המוצר</b>\n\nספר על המוצר: מצב, אביזרים, סיבת המכירה וכו' (${LIMITS.DESC_MIN}-${LIMITS.DESC_MAX} תווים).`,
    { parse_mode: 'HTML', ...kb.cancelOnly() }
  );
}

async function askCondition(ctx) {
  setState(ctx, 'ad:CONDITION');
  return ctx.reply('4️⃣ <b>מה מצב המוצר?</b>', {
    parse_mode: 'HTML',
    ...kb.conditionKeyboard(),
  });
}

async function askPrice(ctx) {
  setState(ctx, 'ad:PRICE');
  return ctx.reply(
    '5️⃣ <b>מה המחיר המבוקש?</b>\n\nכתוב מספר בשקלים (לדוגמה: <code>1500</code>)\nאו בחר אפשרות מהירה:',
    { parse_mode: 'HTML', ...kb.priceKeyboard() }
  );
}

async function askLocation(ctx) {
  setState(ctx, 'ad:LOCATION');
  return ctx.reply('6️⃣ <b>מאיזה אזור המוצר?</b>', {
    parse_mode: 'HTML',
    ...kb.regionsKeyboard('loc:'),
  });
}

async function askPhotos(ctx) {
  const draft = draftOf(ctx);
  setState(ctx, 'ad:PHOTOS');
  await ctx.reply(
    `7️⃣ <b>העלאת תמונות</b>\n\nשלח עד ${env.MAX_PHOTOS} תמונות (אפשר גם אלבום אחד עם כמה תמונות יחד).\nכשתסיים — לחץ על «${kb.DONE_PHOTOS}».`,
    { parse_mode: 'HTML', ...kb.photosKeyboard() }
  );
  if (draft.photos.length) {
    await ctx.reply(`📸 כרגע מצורפות ${draft.photos.length} תמונות.`, kb.photosDoneInline(draft.photos.length));
  }
  return true;
}

async function showPreview(ctx) {
  const draft = draftOf(ctx);
  setState(ctx, 'ad:PREVIEW');

  const name = await categoryName(draft.category_id);
  const text = fmt.previewCard(draft, { categoryName: name, photosCount: draft.photos.length });

  if (draft.photos.length === 1) {
    await ctx.replyWithPhoto(draft.photos[0]);
  } else if (draft.photos.length > 1) {
    await ctx.replyWithMediaGroup(
      draft.photos.map((fileId) => ({ type: 'photo', media: fileId }))
    );
  }

  return ctx.reply(text, { parse_mode: 'HTML', ...kb.previewKeyboard() });
}

/* ------------------------- שליחה למודרציה ופרסום ------------------------- */

/** שולח את המודעה לקבוצת האדמינים עם כפתורי אישור/דחייה. */
async function sendToModeration(telegram, listing) {
  if (!env.ADMIN_GROUP_ID) {
    console.warn('[moderation] ADMIN_GROUP_ID is not set — skipping moderation message');
    return null;
  }

  const photos = listing.photos || [];
  try {
    if (photos.length === 1) {
      await telegram.sendPhoto(env.ADMIN_GROUP_ID, photos[0]);
    } else if (photos.length > 1) {
      await telegram.sendMediaGroup(
        env.ADMIN_GROUP_ID,
        photos.map((fileId) => ({ type: 'photo', media: fileId }))
      );
    }
  } catch (error) {
    console.error('[moderation] failed to send photos:', error.message);
  }

  return telegram.sendMessage(env.ADMIN_GROUP_ID, fmt.moderationCard(listing), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: kb.moderationKeyboard(listing).reply_markup,
  });
}

async function submit(ctx) {
  const draft = draftOf(ctx);
  const user = ctx.state.dbUser;

  if (!draft.title || !draft.description || !draft.location) {
    clearWizard(ctx);
    return ctx.reply('⚠️ חלק מהפרטים חסרים. נתחיל מחדש מהתפריט הראשי.', kb.mainMenu());
  }

  const listing = await db.createListing({
    user_id: user.id,
    title: draft.title,
    description: draft.description,
    category_id: draft.category_id || null,
    condition: draft.condition || 'good',
    price: draft.price_type === 'free' ? 0 : Number(draft.price || 0),
    price_type: draft.price_type || 'fixed',
    location: draft.location,
    photos: draft.photos,
    status: 'pending',
  });

  clearWizard(ctx);

  await ctx.reply(
    [
      '✅ <b>המודעה נשלחה בהצלחה!</b>',
      '',
      `🆔 מזהה המודעה שלך: <code>${fmt.adId(listing.id)}</code>`,
      '⏳ המודעה ממתינה לאישור מנהל ותפורסם בערוץ תוך זמן קצר.',
      '',
      'נשלח לך התראה ברגע שהמודעה תאושר 🔔',
    ].join('\n'),
    { parse_mode: 'HTML', ...kb.mainMenu() }
  );

  try {
    await sendToModeration(ctx.telegram, listing);
  } catch (error) {
    console.error('[submit] moderation dispatch failed:', error.message);
  }

  return true;
}

/* -------------------------------- טיפול בטקסט -------------------------------- */

async function onText(ctx) {
  const text = (ctx.message.text || '').trim();
  const state = ctx.session.state || '';
  const draft = draftOf(ctx);

  if (text === kb.CANCEL) {
    clearWizard(ctx);
    return ctx.reply('❌ פרסום המודעה בוטל.', kb.mainMenu());
  }

  switch (state) {
    case 'ad:CATEGORY':
      return ctx.reply('👆 בחר קטגוריה מהכפתורים שלמעלה.');

    case 'ad:TITLE': {
      if (text.length < LIMITS.TITLE_MIN || text.length > LIMITS.TITLE_MAX) {
        return ctx.reply(
          `⚠️ הכותרת חייבת להיות בין ${LIMITS.TITLE_MIN} ל-${LIMITS.TITLE_MAX} תווים (כרגע: ${text.length}). נסה שוב:`
        );
      }
      draft.title = text;
      if (draft.editing) {
        draft.editing = false;
        return showPreview(ctx);
      }
      return askDescription(ctx);
    }

    case 'ad:DESC': {
      if (text.length < LIMITS.DESC_MIN || text.length > LIMITS.DESC_MAX) {
        return ctx.reply(
          `⚠️ התיאור חייב להיות בין ${LIMITS.DESC_MIN} ל-${LIMITS.DESC_MAX} תווים (כרגע: ${text.length}). נסה שוב:`
        );
      }
      draft.description = text;
      if (draft.editing) {
        draft.editing = false;
        return showPreview(ctx);
      }
      return askCondition(ctx);
    }

    case 'ad:CONDITION':
      return ctx.reply('👆 בחר את מצב המוצר מהכפתורים שלמעלה.');

    case 'ad:PRICE': {
      const normalized = text.replace(/[₪,\s]/g, '');
      const value = Number(normalized);
      if (!Number.isFinite(value) || value < 0 || value > LIMITS.PRICE_MAX) {
        return ctx.reply('⚠️ נא להזין מחיר מספרי תקין (לדוגמה: 1500), או לבחור אפשרות מהכפתורים.');
      }
      draft.price = value;
      draft.price_type = value === 0 ? 'free' : 'fixed';
      if (draft.editing) {
        draft.editing = false;
        return showPreview(ctx);
      }
      return askLocation(ctx);
    }

    case 'ad:LOCATION':
      return ctx.reply('👆 בחר אזור מהכפתורים שלמעלה.');

    case 'ad:PHOTOS': {
      if (text === kb.DONE_PHOTOS) {
        if (!draft.photos.length) {
          return ctx.reply('⚠️ חובה לצרף לפחות תמונה אחת כדי שהמודעה תאושר. שלח תמונה:');
        }
        draft.editing = false;
        return showPreview(ctx);
      }
      return ctx.reply(
        `📸 שלח תמונות של המוצר, או לחץ על «${kb.DONE_PHOTOS}» כדי להמשיך.`
      );
    }

    case 'ad:PREVIEW':
      return ctx.reply('👆 אשר, ערוך או בטל את המודעה באמצעות הכפתורים שלמעלה.');

    default:
      return false;
  }
}

/* ------------------------------- טיפול בתמונות ------------------------------- */

async function onPhoto(ctx) {
  const draft = draftOf(ctx);

  if (draft.photos.length >= env.MAX_PHOTOS) {
    return ctx.reply(
      `⚠️ הגעת למקסימום ${env.MAX_PHOTOS} תמונות. לחץ על «${kb.DONE_PHOTOS}» כדי להמשיך.`,
      kb.photosDoneInline(draft.photos.length)
    );
  }

  const sizes = ctx.message.photo || [];
  const best = sizes[sizes.length - 1];
  if (!best) return false;

  if (!draft.photos.includes(best.file_id)) draft.photos.push(best.file_id);

  const groupId = ctx.message.media_group_id || null;
  const sameAlbum = groupId && draft.lastMediaGroup === groupId;
  draft.lastMediaGroup = groupId;

  if (sameAlbum) return true; // לא מציפים את המשתמש בהודעה לכל תמונה באלבום

  return ctx.reply(
    `📸 נשמרו ${draft.photos.length} מתוך ${env.MAX_PHOTOS} תמונות.\nאפשר לשלוח עוד, או לסיים:`,
    kb.photosDoneInline(draft.photos.length)
  );
}

/* --------------------------------- Actions --------------------------------- */

function register(bot) {
  // בחירת קטגוריה
  bot.action(/^cat:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if ((ctx.session.state || '') !== 'ad:CATEGORY') return;
    const draft = draftOf(ctx);
    draft.category_id = Number(ctx.match[1]);
    const name = await categoryName(draft.category_id);
    await ctx.editMessageText(`1️⃣ קטגוריה נבחרה: <b>${fmt.esc(name)}</b> ✅`, { parse_mode: 'HTML' });
    if (draft.editing) {
      draft.editing = false;
      return showPreview(ctx);
    }
    return askTitle(ctx);
  });

  // מצב המוצר
  bot.action(/^cond:(new_sealed|like_new|good|parts)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if ((ctx.session.state || '') !== 'ad:CONDITION') return;
    const draft = draftOf(ctx);
    draft.condition = ctx.match[1];
    await ctx.editMessageText(
      `4️⃣ מצב המוצר: <b>${fmt.esc(kb.CONDITIONS[draft.condition])}</b> ✅`,
      { parse_mode: 'HTML' }
    );
    if (draft.editing) {
      draft.editing = false;
      return showPreview(ctx);
    }
    return askPrice(ctx);
  });

  // מחיר מהיר
  bot.action(/^price:(free|flex)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if ((ctx.session.state || '') !== 'ad:PRICE') return;
    const draft = draftOf(ctx);

    if (ctx.match[1] === 'free') {
      draft.price = 0;
      draft.price_type = 'free';
      await ctx.editMessageText('5️⃣ מחיר: <b>למסירה בחינם 🎁</b> ✅', { parse_mode: 'HTML' });
      if (draft.editing) {
        draft.editing = false;
        return showPreview(ctx);
      }
      return askLocation(ctx);
    }

    draft.price_type = 'flexible';
    ctx.session.state = 'ad:PRICE';
    await ctx.editMessageText(
      '5️⃣ מחיר גמיש נבחר 🤝\nכתוב עכשיו את המחיר המבוקש כנקודת פתיחה (מספר בשקלים):',
      { parse_mode: 'HTML' }
    );
    return true;
  });

  // מיקום
  bot.action(/^loc:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if ((ctx.session.state || '') !== 'ad:LOCATION') return;
    const draft = draftOf(ctx);
    const region = kb.REGIONS[Number(ctx.match[1])];
    if (!region) return ctx.reply('⚠️ אזור לא תקין, נסה שוב.');
    draft.location = region;
    await ctx.editMessageText(`6️⃣ מיקום: <b>${fmt.esc(region)}</b> ✅`, { parse_mode: 'HTML' });
    if (draft.editing) {
      draft.editing = false;
      return showPreview(ctx);
    }
    return askPhotos(ctx);
  });

  // סיום העלאת תמונות
  bot.action('ph:done', async (ctx) => {
    await ctx.answerCbQuery();
    if ((ctx.session.state || '') !== 'ad:PHOTOS') return;
    const draft = draftOf(ctx);
    if (!draft.photos.length) {
      return ctx.reply('⚠️ חובה לצרף לפחות תמונה אחת. שלח תמונה:');
    }
    draft.editing = false;
    return showPreview(ctx);
  });

  bot.action('ph:reset', async (ctx) => {
    await ctx.answerCbQuery('התמונות אופסו');
    if ((ctx.session.state || '') !== 'ad:PHOTOS') return;
    const draft = draftOf(ctx);
    draft.photos = [];
    draft.lastMediaGroup = null;
    return ctx.reply('🗑️ התמונות אופסו. שלח תמונות חדשות:', kb.photosKeyboard());
  });

  // תצוגה מקדימה — אישור / עריכה / ביטול
  bot.action('pv:confirm', async (ctx) => {
    await ctx.answerCbQuery('שולח...');
    if ((ctx.session.state || '') !== 'ad:PREVIEW') return;
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (error) {
      /* ההודעה כבר נערכה — ממשיכים */
    }
    return submit(ctx);
  });

  bot.action('pv:cancel', async (ctx) => {
    await ctx.answerCbQuery();
    clearWizard(ctx);
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (error) {
      /* noop */
    }
    return ctx.reply('❌ המודעה בוטלה ולא נשמרה.', kb.mainMenu());
  });

  bot.action('pv:edit', async (ctx) => {
    await ctx.answerCbQuery();
    if ((ctx.session.state || '') !== 'ad:PREVIEW') return;
    return ctx.reply('✏️ <b>איזה שדה תרצה לערוך?</b>', {
      parse_mode: 'HTML',
      ...kb.editFieldsKeyboard(),
    });
  });

  // בחירת שדה לעריכה
  bot.action(/^ed:(title|desc|price|cond|cat|loc|photos|back)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const draft = draftOf(ctx);
    const field = ctx.match[1];

    if (field === 'back') return showPreview(ctx);

    draft.editing = true;

    switch (field) {
      case 'title':
        return askTitle(ctx);
      case 'desc':
        return askDescription(ctx);
      case 'price':
        return askPrice(ctx);
      case 'cond':
        return askCondition(ctx);
      case 'cat':
        return askCategory(ctx);
      case 'loc':
        return askLocation(ctx);
      case 'photos':
        draft.photos = [];
        draft.lastMediaGroup = null;
        return askPhotos(ctx);
      default:
        return showPreview(ctx);
    }
  });
}

module.exports = {
  register,
  start,
  onText,
  onPhoto,
  showPreview,
  sendToModeration,
  clearWizard,
  LIMITS,
};
