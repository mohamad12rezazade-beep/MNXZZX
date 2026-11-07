import os
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from telegram import (
    Update,
    ReplyKeyboardMarkup,
    KeyboardButton,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)

load_dotenv()
logging.basicConfig(level=logging.INFO)

# ---------- خواندن متغیرها ----------
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_ID_RAW = os.getenv("ADMIN_ID", "").strip()
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if not BOT_TOKEN:
    raise SystemExit("❌ BOT_TOKEN تنظیم نشده!")
if not ADMIN_ID_RAW:
    raise SystemExit("❌ ADMIN_ID تنظیم نشده!")
if not DATABASE_URL:
    raise SystemExit("❌ DATABASE_URL تنظیم نشده!")

try:
    ADMIN_ID = int(ADMIN_ID_RAW)
except ValueError:
    raise SystemExit("❌ ADMIN_ID باید عدد باشه")

CARD_NUMBER = "6219861856357990"

user_state = {}


# ---------- اتصال دیتابیس ----------
def db():
    return psycopg2.connect(DATABASE_URL, sslmode="require")


def db_query(sql, params=None, fetch=False):
    conn = db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params or ())
            if fetch:
                result = cur.fetchall()
            else:
                result = None
            conn.commit()
            return result
    finally:
        conn.close()


# ---------- کیبوردها ----------
def main_keyboard():
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("🛒 خرید محصول")],
            [KeyboardButton("💬 پشتیبانی"), KeyboardButton("📜 خرید ها")],
        ],
        resize_keyboard=True,
    )


def contact_keyboard():
    return ReplyKeyboardMarkup(
        [[KeyboardButton("📱 تایید شماره", request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


# ---------- بررسی عضویت ----------
async def check_membership(context, user_id):
    try:
        member = await context.bot.get_chat_member("@BET_1XZX", user_id)
        return member.status in ("creator", "administrator", "member")
    except Exception as e:
        logging.error(f"خطا در بررسی عضویت: {e}")
        return False


# ---------- /start ----------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    state = user_state.get(chat_id, {})

    if not state.get("phone_verified"):
        await update.message.reply_text(
            "👋 خوش آمدید!\nبرای شروع لطفاً شماره خود را تایید کنید:",
            reply_markup=contact_keyboard(),
        )
        return

    is_member = await check_membership(context, chat_id)
    if not is_member:
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("📢 عضویت در کانال", url="https://t.me/BET_1XZX")],
                [InlineKeyboardButton("👥 عضویت در گروه", url="https://t.me/GAP_BAZIN1")],
                [InlineKeyboardButton("✅ عضو شدم", callback_data="check_join")],
            ]
        )
        await update.message.reply_text(
            "❗️ برای استفاده از ربات باید در کانال و گروه زیر عضو شوید:",
            reply_markup=keyboard,
        )
        return

    await update.message.reply_text("🏠 منوی اصلی:", reply_markup=main_keyboard())


# ---------- دریافت مخاطب ----------
async def contact_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    phone = update.message.contact.phone_number

    if not (phone.startswith("98") or phone.startswith("+98")):
        await update.message.reply_text(
            "❌ فقط شماره‌های +98 پذیرفته می‌شوند. دوباره تلاش کنید.",
            reply_markup=contact_keyboard(),
        )
        return

    user_state.setdefault(chat_id, {})["phone_verified"] = True
    await update.message.reply_text(
        "✅ شماره تایید شد.\nحالا برای ادامه /start را بزنید."
    )


# ---------- callback ها ----------
async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    chat_id = query.message.chat.id
    data = query.data

    if data == "check_join":
        is_member = await check_membership(context, chat_id)
        if is_member:
            await query.answer("✅ تایید شد")
            await query.edit_message_text("✅ عضویت تایید شد. خوش آمدید!")
            await context.bot.send_message(
                chat_id, "🏠 منوی اصلی:", reply_markup=main_keyboard()
            )
        else:
            await query.answer("❌ هنوز عضو نشده‌اید!", show_alert=True)
        return

    if data == "buy_ton":
        user_state[chat_id] = {"step": "WAIT_TON_AMOUNT"}
        await query.answer()
        await context.bot.send_message(chat_id, "🔢 تعداد تون را وارد کنید (حداقل ۰.۱):")
        return

    if data == "buy_dogs":
        user_state[chat_id] = {"step": "WAIT_DOGS_AMOUNT"}
        await query.answer()
        await context.bot.send_message(chat_id, "🔢 تعداد داگز را وارد کنید (حداقل ۱۰۰۰):")
        return

    if data.startswith("approve_"):
        if chat_id != ADMIN_ID:
            return
        order_id = data.split("_")[1]
        db_query("UPDATE orders SET status=%s WHERE id=%s", ("approved", order_id))
        res = db_query("SELECT user_id FROM orders WHERE id=%s", (order_id,), fetch=True)
        if res:
            await context.bot.send_message(
                res[0]["user_id"],
                "✅ واریز شما تایید شد و سفارش در حال انجام است.",
            )
        await query.edit_message_caption("✅ تایید شد")
        return

    if data.startswith("reject_"):
        if chat_id != ADMIN_ID:
            return
        order_id = data.split("_")[1]
        db_query("UPDATE orders SET status=%s WHERE id=%s", ("rejected", order_id))
        res = db_query("SELECT user_id FROM orders WHERE id=%s", (order_id,), fetch=True)
        if res:
            await context.bot.send_message(
                res[0]["user_id"],
                "❌ متأسفانه رسید شما رد شد. لطفاً با پشتیبانی در تماس باشید.",
            )
        await query.edit_message_caption("❌ رد شد")
        return


# ---------- متن‌ها ----------
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    text = update.message.text

    if text == "🛒 خرید محصول":
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("💎 تون (TON)", callback_data="buy_ton")],
                [InlineKeyboardButton("🐕 داگز (DOGS)", callback_data="buy_dogs")],
            ]
        )
        await update.message.reply_text("کدام محصول؟", reply_markup=keyboard)
        return

    if text == "💬 پشتیبانی":
        user_state[chat_id] = {"step": "SUPPORT"}
        await update.message.reply_text("📝 لطفاً پیام خود را ارسال کنید:")
        return

    if text == "📜 خرید ها":
        res = db_query(
            "SELECT * FROM orders WHERE user_id=%s AND status='approved' ORDER BY created_at DESC",
            (chat_id,),
            fetch=True,
        )
        if not res:
            await update.message.reply_text("شما هیچ خرید تایید شده‌ای ندارید.")
            return
        msg = "📜 خریدهای تایید شده شما:\n\n"
        for o in res:
            msg += f"🔹 {o['type']} - مقدار: {o['amount']} - تاریخ: {str(o['created_at'])[:10]}\n"
        await update.message.reply_text(msg)
        return

    state = user_state.get(chat_id)
    if not state:
        return

    step = state.get("step")

    if step == "WAIT_TON_AMOUNT":
        try:
            amount = float(text)
        except ValueError:
            await update.message.reply_text("❌ عدد معتبر وارد کنید.")
            return
        if amount < 0.1:
            await update.message.reply_text("❌ حداقل ۰.۱ تون وارد کنید.")
            return
        state["data"] = {"amount": amount, "type": "TON"}
        state["step"] = "WAIT_TON_WALLET"
        await update.message.reply_text("💼 لطفاً آدرس ولت خود را وارد کنید:")
        return

    if step == "WAIT_TON_WALLET":
        state["data"]["wallet"] = text
        state["step"] = "WAIT_RECEIPT"
        await update.message.reply_text(
            f"💳 لطفاً مبلغ را به شماره کارت زیر واریز کنید:\n\n<code>{CARD_NUMBER}</code>\n\nسپس تصویر رسید را ارسال کنید.",
            parse_mode="HTML",
        )
        return

    if step == "WAIT_DOGS_AMOUNT":
        try:
            amount = int(text)
        except ValueError:
            await update.message.reply_text("❌ عدد صحیح وارد کنید.")
            return
        if amount < 1000:
            await update.message.reply_text("❌ حداقل ۱۰۰۰ داگز وارد کنید.")
            return
        state["data"] = {"amount": amount, "type": "DOGS"}
        state["step"] = "WAIT_DOGS_USERNAME"
        await update.message.reply_text("🆔 لطفاً آیدی یوزرنیم خود را وارد کنید (مثلاً @username):")
        return

    if step == "WAIT_DOGS_USERNAME":
        state["data"]["username"] = text
        state["step"] = "WAIT_RECEIPT"
        await update.message.reply_text(
            f"💳 لطفاً مبلغ را به شماره کارت زیر واریز کنید:\n\n<code>{CARD_NUMBER}</code>\n\nسپس تصویر رسید را ارسال کنید.",
            parse_mode="HTML",
        )
        return

    if step == "SUPPORT":
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("↩️ پاسخ", callback_data=f"reply_{chat_id}")]]
        )
        await context.bot.send_message(
            ADMIN_ID,
            f"📩 پیام پشتیبانی از {update.message.from_user.first_name} ({chat_id}):\n\n{text}\n\nبرای پاسخ، روی پیام ریپلای کنید.",
            reply_markup=keyboard,
        )
        del user_state[chat_id]
        await update.message.reply_text("✅ پیام شما ارسال شد.")
        return


# ---------- رسید ----------
async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    state = user_state.get(chat_id)

    if not state or state.get("step") != "WAIT_RECEIPT":
        await update.message.reply_text("لطفاً ابتدا از منوی «خرید محصول» شروع کنید.")
        return

    photo_file_id = update.message.photo[-1].file_id
    user_data = state["data"]

    try:
        res = db_query(
            "INSERT INTO orders (user_id, type, amount, wallet_address, status) "
            "VALUES (%s, %s, %s, %s, 'pending') RETURNING id",
            (
                chat_id,
                user_data["type"],
                user_data["amount"],
                user_data.get("wallet"),
            ),
            fetch=True,
        )
        order_id = res[0]["id"]
    except Exception as e:
        logging.error(f"خطا در ثبت سفارش: {e}")
        await update.message.reply_text("❌ خطا در ثبت سفارش.")
        return

    caption = (
        f"📥 سفارش جدید #{order_id}\n"
        f"👤 کاربر: {update.message.from_user.first_name} ({chat_id})\n"
        f"📦 نوع: {user_data['type']}\n"
        f"🔢 مقدار: {user_data['amount']}\n"
    )
    if user_data["type"] == "TON":
        caption += f"💼 ولت: {user_data['wallet']}"
    else:
        caption += f"🆔 یوزرنیم: {user_data.get('username', '-')}"

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("✅ تایید", callback_data=f"approve_{order_id}"),
                InlineKeyboardButton("❌ رد", callback_data=f"reject_{order_id}"),
            ]
        ]
    )

    await context.bot.send_photo(
        ADMIN_ID, photo_file_id, caption=caption, reply_markup=keyboard
    )
    await update.message.reply_text(
        "✅ رسید شما ارسال شد. پس از تایید ادمین به شما اطلاع داده می‌شود."
    )
    del user_state[chat_id]


# ---------- main ----------
def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.CONTACT, contact_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
    app.add_handler(CallbackQueryHandler(callback_handler))

    print("🤖 ربات روشن شد...")
    app.run_polling()


if __name__ == "__main__":
    main()
