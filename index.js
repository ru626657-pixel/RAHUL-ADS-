/**
 * Telegram → Meta Conversions API bridge bot
 * ---------------------------------------------------------------
 * Kaam: jab koi Facebook/Instagram ad se click karke bot ko /start
 * karta hai (link format: t.me/YourBot?start=<fbclid>), ye bot:
 *   1. fbclid ko capture karta hai
 *   2. Meta ko server-side "Lead" event bhejta hai (Conversions API)
 *   3. User ko channel ka link deta hai
 *   4. (optional) ek chhota qualifying question puchta hai
 *
 * Isse Meta ko pata chalta hai ki kaun ACTUALLY join kar raha hai,
 * na ki sirf link par click kar raha hai — jisse campaign optimize
 * hoti hai aur lookalike audience ki quality improve hoti hai.
 * ---------------------------------------------------------------
 */

require('dotenv').config();
const { Telegraf } = require('telegraf');
const crypto = require('crypto');
const fetch = require('node-fetch');

// ---------- Config (.env se aata hai) ----------
const {
  TELEGRAM_BOT_TOKEN,
  FB_PIXEL_ID,
  FB_ACCESS_TOKEN,
  FB_TEST_EVENT_CODE, // optional — Events Manager me "Test Events" tab se milta hai
  CHANNEL_LINK,        // aapka actual private/public channel invite link
  PORT,
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !FB_PIXEL_ID || !FB_ACCESS_TOKEN || !CHANNEL_LINK) {
  console.error('❌ .env me TELEGRAM_BOT_TOKEN, FB_PIXEL_ID, FB_ACCESS_TOKEN, CHANNEL_LINK zaroor daalein.');
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// ---------- Helper: SHA-256 hash (Meta ko hashed data chahiye) ----------
function sha256(value) {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

// ---------- Helper: Meta ko event bhejna ----------
async function sendLeadEvent({ fbclid, telegramUserId, firstName, phone }) {
  const eventTime = Math.floor(Date.now() / 1000);

  const userData = {
    // Telegram user ID ko external_id ki tarah bhejna — dedupe/match ke liye
    external_id: [sha256(String(telegramUserId))],
  };

  if (fbclid) {
    // Meta ka click-id format: fb.1.<timestamp>.<fbclid>
    userData.fbc = `fb.1.${eventTime}.${fbclid}`;
  }
  if (phone) {
    userData.ph = [sha256(phone.replace(/[^0-9]/g, ''))];
  }

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: eventTime,
        action_source: 'chat', // Telegram jaisa chat-based join isi source ke under aata hai
        event_source_url: CHANNEL_LINK,
        user_data: userData,
        custom_data: {
          content_name: 'telegram_channel_join',
          lead_source: 'telegram_bot',
        },
      },
    ],
  };

  if (FB_TEST_EVENT_CODE) {
    payload.test_event_code = FB_TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/v20.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok) {
    console.error('❌ Meta CAPI error:', JSON.stringify(json));
  } else {
    console.log('✅ Lead event bheja gaya:', JSON.stringify(json));
  }
  return json;
}

// ---------- /start handler ----------
bot.start(async (ctx) => {
  const fbclid = ctx.startPayload || null; // t.me/YourBot?start=XXXX se aata hai
  const telegramUserId = ctx.from.id;
  const firstName = ctx.from.first_name || '';

  console.log(`➡️  Naya join attempt: user=${telegramUserId} fbclid=${fbclid || 'none'}`);

  // Meta ko event bhejo (background me — user ko wait nahi karana)
  sendLeadEvent({ fbclid, telegramUserId, firstName }).catch((e) =>
    console.error('CAPI send failed:', e)
  );

  // Channel link TURANT pehle message me — koi gatekeeping nahi.
  // Sawaal sirf bonus data ke liye hai, access rokne ke liye nahi.
  await ctx.reply(
    `Namaste ${firstName} 👋\n\nMarket Levels Daily channel me aapka swagat hai.\n\nYe raha channel ka link 👉 ${CHANNEL_LINK}\n\nHar trading din subah 9 baje levels post hote hain. Wahan milte hain 📈`
  );

  // Optional follow-up — user isse ignore bhi kar sakta hai, channel access
  // already mil chuka hai upar.
  await ctx.reply(
    `Bas ek chhoti si baat — aap trading me kitna experience rakhte hain? (optional)`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Bilkul naya hoon', callback_data: 'exp_beginner' }],
          [{ text: '6 mahine - 2 saal', callback_data: 'exp_intermediate' }],
          [{ text: '2+ saal se trade kar raha hoon', callback_data: 'exp_advanced' }],
        ],
      },
    }
  );
});

// ---------- Experience button click (optional data, channel already diya ja chuka hai) ----------
bot.action(/exp_(.+)/, async (ctx) => {
  const level = ctx.match[1]; // beginner | intermediate | advanced
  console.log(`📊 User ${ctx.from.id} experience: ${level}`);

  await ctx.answerCbQuery();
  await ctx.editMessageText(`Dhanyawad! 🙌 Milte hain channel me.`);

  // Chaho to yahan "level" ko apne CRM/Google Sheet me bhi save kar sakte ho
  // taki lead segment ke hisaab se follow-up kar sako.
});

// ---------- Error handling ----------
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}:`, err);
});

bot.launch();
console.log('🤖 Bot chalu ho gaya.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
