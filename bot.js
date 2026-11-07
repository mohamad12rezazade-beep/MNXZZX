import TelegramBot from "node-telegram-bot-api";
import { createClient } from "@supabase/supabase-js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CARD_NUMBER = "6219861856357990";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// وضعیت کاربران در حافظه
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

  // مرحله ۱: شماره
  if (!userState[chatId]?.phoneVerified) {
    return bot.sendMessage(
      chatId,
      "👋 خوش آمدید!\nبرای شروع لطفاً شماره خود را تایید کنید:",
      { reply_markup: contactKeyboard }
    );
  }

  // مرحله ۲: عضویت
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

  // مرحله ۳: منو
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

// ---------- دکمه عضو شدم ----------
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

  // تایید/رد سفارش توسط ادمین
  if (query.data.startsWith("approve_")) {
    if (chatId !== ADMIN_ID) return;
    const orderId = query.data.split("_")[1];
    await supabase.from("orders").update({ status: "approved" }).eq("id", orderId);
    const { data: order } = await supabase.from("orders").select("user_id").eq("id", orderId).single();
    if (order) {
      bot.sendMessage(order.user_id, "✅ واریز شما تایید شد و سفارش در حال انجام است.");
    }
    bot.editMessageCaption("✅ تایید شد", {
      chat_id: chatId,
      message_id: query.message.message_id,
    });
  }

  if (query.data.startsWith("reject_")) {
    if (chatId !== ADMIN_ID) return;
    const orderId = query.data.split("_")[1];
    await supabase.from("orders").update({ status: "rejected" }).eq("id", orderId);
    const { data: order } = await supabase.from("orders").select("user_id").eq("id", orderId).single();
    if (order) {
      bot.sendMessage(order.user_id, "❌ متأسفانه رسید شما رد شد. لطفاً با پشتیبانی در تماس باشید.");
    }
    bot.editMessageCaption("❌ رد شد", {
      chat_id: chatId,
      message_id: query.message.message_id,
    });
  }
});

// ---------- دکمه‌های منو ----------
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  // خرید محصول
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

  // پشتیبانی
  if (text === "💬 پشتیبانی") {
    userState[chatId] = { step: "SUPPORT" };
    return bot.sendMessage(chatId, "📝 لطفاً پیام خود را ارسال کنید:");
  }

  // خرید ها
  if (text === "📜 خرید ها") {
    const { data: orders } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", chatId)
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (!orders || orders.length === 0) {
      return bot.sendMessage(chatId, "شما هیچ خرید تایید شده‌ای ندارید.");
    }

    let message = "📜 خریدهای تایید شده شما:\n\n";
    orders.forEach((o) => {
      message += `🔹 ${o.type} - مقدار: ${o.amount} - تاریخ: ${new Date(o.created_at).toLocaleDateString("fa-IR")}\n`;
    });
    return bot.sendMessage(chatId, message);
  }

  const state = userState[chatId];
  if (!state) return;

  // دریافت مقدار تون
  if (state.step === "WAIT_TON_AMOUNT") {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 0.1) {
      return bot.sendMessage(chatId, "❌ حداقل ۰.۱ تون وارد کنید.");
    }
    state.data = { amount, type: "TON" };
    state.step = "WAIT_TON_WALLET";
    return bot.sendMessage(chatId, "💼 لطفاً آدرس ولت خود را وارد کنید:");
  }

  // دریافت آدرس ولت تون
  if (state.step === "WAIT_TON_WALLET") {
    state.data.wallet = text;
    state.step = "WAIT_RECEIPT";
    return bot.sendMessage(
      chatId,
      `💳 لطفاً مبلغ را به شماره کارت زیر واریز کنید:\n\n<code>${CARD_NUMBER}</code>\n\nسپس تصویر رسید را ارسال کنید.`,
      { parse_mode: "HTML" }
    );
  }

  // دریافت مقدار داگز
  if (state.step === "WAIT_DOGS_AMOUNT") {
    const amount = parseInt(text);
    if (isNaN(amount) || amount < 1000) {
      return bot.sendMessage(chatId, "❌ حداقل ۱۰۰۰ داگز وارد کنید.");
    }
    state.data = { amount, type: "DOGS" };
    state.step = "WAIT_DOGS_USERNAME";
    return bot.sendMessage(chatId, "🆔 لطفاً آیدی یوزرنیم خود را وارد کنید (مثلاً @username):");
  }

  // دریافت یوزرنیم داگز
  if (state.step === "WAIT_DOGS_USERNAME") {
    state.data.username = text;
    state.step = "WAIT_RECEIPT";
    return bot.sendMessage(
      chatId,
      `💳 لطفاً مبلغ را به شماره کارت زیر واریز کنید:\n\n<code>${CARD_NUMBER}</code>\n\nسپس تصویر رسید را ارسال کنید.`,
      { parse_mode: "HTML" }
    );
  }

  // پشتیبانی - ارسال به ادمین
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

// ---------- انتخاب تون / داگز ----------
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

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
});

// ---------- دریافت رسید (عکس) ----------
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const state = userState[chatId];

  if (!state || state.step !== "WAIT_RECEIPT") {
    return bot.sendMessage(chatId, "لطفاً ابتدا از منوی «خرید محصول» شروع کنید.");
  }

  const photo = msg.photo[msg.photo.length - 1].file_id;
  const userData = state.data;

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: chatId,
      type: userData.type,
      amount: userData.amount,
      wallet_address: userData.type === "TON" ? userData.wallet : null,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    console.log(error);
    return bot.sendMessage(chatId, "❌ خطا در ثبت سفارش.");
  }

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
