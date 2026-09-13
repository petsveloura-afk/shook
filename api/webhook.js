'use strict';

/**
 * Vercel Serverless Function — נקודת הקצה של ה-Webhook מטלגרם.
 *
 * POST /api/webhook                          -> עדכונים מטלגרם
 * GET  /api/webhook?action=set&secret=...     -> רישום ה-Webhook בטלגרם
 * GET  /api/webhook?action=info&secret=...    -> בדיקת מצב ה-Webhook
 * GET  /api/webhook?action=delete&secret=...  -> הסרת ה-Webhook
 * GET  /api/webhook                           -> Health check
 */

const env = require('../src/config/env');
const { getBot, registerCommands } = require('../src/bot');

const bot = getBot();

let initPromise = null;

/** אתחול חד-פעמי (botInfo נדרש לזיהוי פקודות בקבוצות). */
function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      const me = await bot.telegram.getMe();
      bot.botInfo = me;
      if (!env.BOT_USERNAME) env.BOT_USERNAME = me.username;
      return me;
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

function authorized(req) {
  if (!env.WEBHOOK_SECRET) return false;
  const provided = (req.query && req.query.secret) || req.headers['x-setup-secret'];
  return provided === env.WEBHOOK_SECRET;
}

module.exports = async function handler(req, res) {
  /* ------------------------------- GET ------------------------------- */
  if (req.method === 'GET') {
    const action = (req.query && req.query.action) || 'health';

    if (action === 'health') {
      return res.status(200).json({
        ok: true,
        service: 'pashpashuk-marketplace-bot',
        mode: 'webhook',
        time: new Date().toISOString(),
      });
    }

    if (!authorized(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized — add ?secret=WEBHOOK_SECRET' });
    }

    try {
      await ensureInit();

      if (action === 'set') {
        const url = env.webhookUrl();
        if (!url) return res.status(400).json({ ok: false, error: 'PUBLIC_URL is not configured' });

        await bot.telegram.setWebhook(url, {
          secret_token: env.WEBHOOK_SECRET,
          allowed_updates: ['message', 'callback_query', 'my_chat_member'],
          drop_pending_updates: true,
        });
        await registerCommands(bot);
        const info = await bot.telegram.getWebhookInfo();
        return res.status(200).json({ ok: true, action: 'set', url, info });
      }

      if (action === 'info') {
        const info = await bot.telegram.getWebhookInfo();
        return res.status(200).json({ ok: true, bot: bot.botInfo, info });
      }

      if (action === 'delete') {
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        return res.status(200).json({ ok: true, action: 'delete' });
      }

      return res.status(400).json({ ok: false, error: `unknown action: ${action}` });
    } catch (error) {
      console.error('[webhook:get] failed:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  }

  /* ------------------------------- POST ------------------------------- */
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }

  if (env.WEBHOOK_SECRET) {
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== env.WEBHOOK_SECRET) {
      console.warn('[webhook] rejected update with bad secret token');
      return res.status(401).json({ ok: false, error: 'invalid secret token' });
    }
  }

  try {
    await ensureInit();
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (update) await bot.handleUpdate(update);
  } catch (error) {
    // מחזירים 200 כדי שטלגרם לא ישלח את אותו עדכון שוב ושוב.
    console.error('[webhook] handleUpdate failed:', error);
  }

  return res.status(200).json({ ok: true });
};
