import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import pg from "pg";

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const DATABASE_URL = process.env.DATABASE_URL;
const CARD_NUMBER = "6219861856357990";

if (!BOT_TOKEN || !ADMIN_ID || !DATABASE_URL) {
  console.error("❌ متغیرهای .env کامل نیست!");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const userState = {};

// ---------- کیبوردها ----------
const mainKeyboard = {
  keyboard: [
    [{ text: "🛒 خرید محصول" }],
    [{ text: "💬 پشتیبانی" }, { text: "📜 خرید ها" }],
  ],
  resize_keyboard: true,
};

const contactKeyboard = {
  keyboard: [[{ text: "📱 تایید شماره", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

// ---------- بررسی عضویت ----------
async function checkMembership(userId) {
  try {
    const chatMember = await bot.getChatMember("@BET_1XZX", userId);
    return ["creator", "administrator", "member"].includes(chatMember.status);
  } catch (e) {
    console.log("خطا در بررسی عضویت:", e.message);
    return false;
  }
}

// ---------- /start ----------
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  if (!userState[chatId]?.phoneVerified) {
    return bot.sendMessage(
      chatId,
      "👋 خوش آمدید!\nبرای شروع لطفاً شماره خود را تایید کنید:",
      { reply_markup: contactKeyboard }
    );
  }

  const isMember = await checkMembership(chatId);
  if (!isMember) {
    return bot.sendMessage(
      chatId,
      "❗️ برای استفاده از ربات باید در کانال و گروه زیر عضو شوید:",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 عضویت در کانال", url: "https://t.me/BET_1XZX" }],
            [{ text: "👥 عضویت در گروه", url: "https://t.me/GAP_BAZIN1" }],
            [{ text: "✅ عضو شدم", callback_data: "check_join" }],
          ],
        },
      }
    );
  }

  bot.sendMessage(chatId, "🏠 منوی اصلی:", { reply_markup: mainKeyboard });
});

// ---------- دریافت مخاطب ----------
bot.on("contact", async (msg) => {
  const chatId = msg.chat.id;
  const phone = msg.contact.phone_number;

  if (!phone.startsWith("98") && !phone.startsWith("+98")) {
    return bot.sendMessage(chatId, "❌ فقط شماره‌های +98 پذیرفته می‌شوند. دوباره تلاش کنید.", {
      reply_markup: contactKeyboard,
    });
  }

  userState[chatId] = { ...userState[chatId], phoneVerified: true };
  bot.sendMessage(chatId, "✅ شماره تایید شد.\nحالا برای ادامه /start را بزنید.");
});

// ---------- callback ها ----------
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === "check_join") {
    const isMember = await checkMembership(chatId);
    if (isMember) {
      bot.answerCallbackQuery(query.id, "✅ تایید شد");
      bot.editMessageText("✅ عضویت تایید شد. خوش آمدید!", {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      bot.sendMessage(chatId, "🏠 منوی اصلی:", { reply_markup: mainKeyboard });
    } else {
      bot.answerCallbackQuery(query.id, "❌ هنوز عضو نشده‌اید!", { show_alert: true });
    }
  }

  if (query.data === "buy_ton") {
    userState[chatId] = { step: "WAIT_TON_AMOUNT" };
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, "🔢 تعداد تون را وارد کنید (حداقل ۰.۱):");
  }

  if (query.data === "buy_dogs") {
    userState[chatId] = { step: "WAIT_DOGS_AMOUNT" };
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, "🔢 تعداد داگز را وارد کنید (حداقل ۱۰۰۰):");
  }

  if (query.data.startsWith("approve_")) {
    if (chatId !== ADMIN_ID) return;
    const orderId = query.data.split("_")[1];
    await pool.query("UPDATE orders SET status=$1 WHERE id=$2", ["approved", orderId]);
    const { rows } = await pool.query("SELECT user_id FROM orders WHERE id=$1", [orderId]);
    if (rows[0]) bot.sendMessage(rows[0].user_id, "✅ واریز شما تایید شد و سفارش در حال انجام است.");
    bot.editMessageCaption("✅ تایید شد", { chat_id: chatId, message_id: query.message.message_id });
  }

  if (query.data.startsWith("reject_")) {
    if (chatId !== ADMIN_ID) return;
    const orderId = query.data.split("_")[1];
    await pool.query("UPDATE orders SET status=$1 WHERE id=$2", ["rejected", orderId]);
    const { rows } = await pool.query("SELECT user_id FROM orders WHERE id=$1", [orderId]);
    if (rows[0]) bot.sendMessage(rows[0].user_id, "❌ متأسفانه رسید شما رد شد. لطفاً با پشتیبانی در تماس باشید.");
    bot.editMessageCaption("❌ رد شد", { chat_id: chatId, message_id: query.message.message_id });
  }
});

// ---------- متن‌ها ----------
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  if (text === "🛒 خرید محصول") {
    return bot.sendMessage(chatId, "کدام محصول؟", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💎 تون (TON)", callback_data: "buy_ton" }],
          [{ text: "🐕 داگز (DOGS)", callback_data: "buy_dogs" }],
        ],
      },
    });
  }

  if (text === "💬 پشتیبانی") {
    userState[chatId] = { step: "SUPPORT" };
    return bot.sendMessage(chatId, "📝 لطفاً پیام خود را ارسال کنید:");
  }

  if (text === "📜 خرید ها") {
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE user_id=$1 AND status='approved' ORDER BY created_at DESC",
      [chatId]
    );

    if (rows.length === 0) {
      return bot.sendMessage(chatId, "شما هیچ خرید تایید شده‌ای ندارید.");
    }

    let message = "📜 خریدهای تایید شده شما:\n\n";
    rows.forEach((o) => {
      message += `🔹 ${o.type} - مقدار: ${o.amount} - تاریخ: ${new Date(o.created_at).toLocaleDateString("fa-IR")}\n`;
    });
    return bot.sendMessage(chatId, message);
  }

  const state = userState[chatId];
  if (!state) return;

  if (state.step === "WAIT_TON_AMOUNT") {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 0.1) {
      return bot.sendMessage(chatId, "❌ حداقل ۰.۱ تون وارد کنید.");
    }
    state.data = { amount, type: "TON" };
    state.step = "WAIT_TON_WALLET";
    return bot.sendMessage(chatId, "💼 لطفاً آدرس ولت خود را وارد کنید:");
  }

  if (state.step === "WAIT_TON_WALLET") {
    state.data.wallet = text;
    state.step = "WAIT_RECEIPT";
    return bot.sendMessage(
      chatId,
      `💳 لطفاً مبلغ را به شماره کارت زیر واریز کنید:\n\n<code>${CARD_NUMBER}</code>\n\nسپس تصویر رسید را ارسال کنید.`,
      { parse_mode: "HTML" }
    );
  }

  if (state.step === "WAIT_DOGS_AMOUNT") {
    const amount = parseInt(text);
    if (isNaN(amount) || amount < 1000) {
      return bot.sendMessage(chatId, "❌ حداقل ۱۰۰۰ داگز وارد کنید.");
    }
    state.data = { amount, type: "DOGS" };
    state.step = "WAIT_DOGS_USERNAME";
    return bot.sendMessage(chatId, "🆔 لطفاً آیدی یوزرنیم خود را وارد کنید (مثلاً @username):");
  }

  if (state.step === "WAIT_DOGS_USERNAME") {
    state.data.username = text;
    state.step = "WAIT_RECEIPT";
    return bot.sendMessage(
      chatId,
      `💳 لطفاً مبلغ را به شماره کارت زیر واریز کنید:\n\n<code>${CARD_NUMBER}</code>\n\nسپس تصویر رسید را ارسال کنید.`,
      { parse_mode: "HTML" }
    );
  }

  if (state.step === "SUPPORT") {
    await bot.sendMessage(
      ADMIN_ID,
      `📩 پیام پشتیبانی از ${msg.from.first_name} (${chatId}):\n\n${text}\n\nبرای پاسخ، روی پیام ریپلای کنید.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "↩️ پاسخ", callback_data: `reply_${chatId}` }]],
        },
      }
    );
    delete userState[chatId];
    return bot.sendMessage(chatId, "✅ پیام شما ارسال شد.");
  }
});

// ---------- رسید ----------
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const state = userState[chatId];

  if (!state || state.step !== "WAIT_RECEIPT") {
    return bot.sendMessage(chatId, "لطفاً ابتدا از منوی «خرید محصول» شروع کنید.");
  }

  const photo = msg.photo[msg.photo.length - 1].file_id;
  const userData = state.data;

  const { rows } = await pool.query(
    `INSERT INTO orders (user_id, type, amount, wallet_address, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [
      chatId,
      userData.type,
      userData.amount,
      userData.type === "TON" ? userData.wallet : null,
    ]
  );

  const order = rows[0];

  const caption = `
📥 سفارش جدید #${order.id}
👤 کاربر: ${msg.from.first_name} (${chatId})
📦 نوع: ${userData.type}
🔢 مقدار: ${userData.amount}
${userData.type === "TON" ? `💼 ولت: ${userData.wallet}` : `🆔 یوزرنیم: ${userData.username}`}
  `;

  await bot.sendPhoto(ADMIN_ID, photo, {
    caption,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ تایید", callback_data: `approve_${order.id}` },
          { text: "❌ رد", callback_data: `reject_${order.id}` },
        ],
      ],
    },
  });

  bot.sendMessage(chatId, "✅ رسید شما ارسال شد. پس از تایید ادمین به شما اطلاع داده می‌شود.");
  delete userState[chatId];
});

console.log("🤖 ربات روشن شد...");
