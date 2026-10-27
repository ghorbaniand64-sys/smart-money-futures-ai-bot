import os
import logging
import asyncio
import sqlite3
import secrets

from datetime import datetime, timezone, timedelta

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    Message,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    CallbackQuery,
)
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramAPIError


# =========================================================
# LOGGING
# =========================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


# =========================================================
# CONFIGURATION
# =========================================================

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
VIP_CHANNEL_ID = os.getenv("VIP_CHANNEL_ID")
ADMIN_TELEGRAM_ID = os.getenv("ADMIN_TELEGRAM_ID")

PUBLIC_CHANNEL = "https://t.me/NovaraSignalsHQ"

PAYMENT_NETWORK = "Arbitrum One"
PAYMENT_TOKEN = "USDT"

PAYMENT_WALLET = (
    "0x7cf02544f66c258ea669bcd89e64bcbd11452b7d"
)

DATABASE_PATH = os.getenv(
    "DATABASE_PATH",
    "novara_orders.db",
)


# =========================================================
# SUBSCRIPTION PLANS
# =========================================================

PLANS = {
    "30": {
        "name": "Starter",
        "days": 30,
        "amount": "30",
    },
    "90": {
        "name": "Pro",
        "days": 90,
        "amount": "75",
    },
    "180": {
        "name": "Elite",
        "days": 180,
        "amount": "135",
    },
}


# =========================================================
# VALIDATE ENVIRONMENT
# =========================================================

if not BOT_TOKEN:
    raise RuntimeError(
        "TELEGRAM_BOT_TOKEN is not configured"
    )

if not VIP_CHANNEL_ID:
    raise RuntimeError(
        "VIP_CHANNEL_ID is not configured"
    )

if not ADMIN_TELEGRAM_ID:
    raise RuntimeError(
        "ADMIN_TELEGRAM_ID is not configured"
    )

VIP_CHANNEL_ID = int(VIP_CHANNEL_ID)
ADMIN_TELEGRAM_ID = int(ADMIN_TELEGRAM_ID)


# =========================================================
# BOT INITIALIZATION
# =========================================================

bot = Bot(
    token=BOT_TOKEN,
    default=DefaultBotProperties(
        parse_mode=ParseMode.HTML
    ),
)

dp = Dispatcher()


# =========================================================
# DATABASE
# =========================================================

def init_database():
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                order_id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                username TEXT,
                plan_key TEXT NOT NULL,
                plan_name TEXT NOT NULL,
                duration_days INTEGER NOT NULL,
                amount_usdt TEXT NOT NULL,
                network TEXT NOT NULL,
                payment_wallet TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_orders_user_id
            ON orders(user_id)
            """
        )

        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_orders_status
            ON orders(status)
            """
        )

        # A user_id can appear only once: trial use is permanent.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trial_users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                invite_link TEXT UNIQUE,
                started_at TEXT,
                expires_at TEXT,
                status TEXT NOT NULL DEFAULT 'INVITED'
            )
            """
        )

        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_trial_expiry
            ON trial_users(status, expires_at)
            """
        )

        conn.commit()

    logging.info("NOVARA_DATABASE_READY")


def create_order(
    user_id: int,
    username: str,
    plan_key: str,
) -> dict:
    plan = PLANS[plan_key]

    order_id = (
        "NV-"
        + datetime.now(timezone.utc).strftime("%Y%m%d")
        + "-"
        + secrets.token_hex(4).upper()
    )

    created_at = datetime.now(
        timezone.utc
    ).isoformat()

    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(
            """
            INSERT INTO orders (
                order_id,
                user_id,
                username,
                plan_key,
                plan_name,
                duration_days,
                amount_usdt,
                network,
                payment_wallet,
                status,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_id,
                user_id,
                username,
                plan_key,
                plan["name"],
                plan["days"],
                plan["amount"],
                PAYMENT_NETWORK,
                PAYMENT_WALLET,
                "PENDING",
                created_at,
            ),
        )

        conn.commit()

    return {
        "order_id": order_id,
        "plan": plan,
        "created_at": created_at,
    }


def get_user_orders(user_id: int, limit: int = 5):
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row

        rows = conn.execute(
            """
            SELECT
                order_id,
                plan_name,
                duration_days,
                amount_usdt,
                status,
                created_at
            FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()

    return [dict(row) for row in rows]


def get_pending_orders(limit: int = 10):
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row

        rows = conn.execute(
            """
            SELECT
                order_id,
                user_id,
                username,
                plan_name,
                amount_usdt,
                created_at
            FROM orders
            WHERE status = 'PENDING'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [dict(row) for row in rows]


# =========================================================
# TRIAL / PAID ACCESS HELPERS
# =========================================================

def has_active_paid_subscription(user_id: int) -> bool:
    """Only orders explicitly marked PAID count as paid subscriptions."""
    now = datetime.now(timezone.utc)
    with sqlite3.connect(DATABASE_PATH) as conn:
        rows = conn.execute(
            """SELECT duration_days, created_at FROM orders
               WHERE user_id = ? AND status = 'PAID'""",
            (user_id,),
        ).fetchall()
    for duration_days, created_at in rows:
        try:
            paid_at = datetime.fromisoformat(created_at)
            if paid_at.tzinfo is None:
                paid_at = paid_at.replace(tzinfo=timezone.utc)
            if paid_at + timedelta(days=int(duration_days)) > now:
                return True
        except (TypeError, ValueError):
            logging.warning("Invalid paid order timestamp for user_id=%s", user_id)
    return False


def get_trial(user_id: int):
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM trial_users WHERE user_id = ?", (user_id,)
        ).fetchone()
    return dict(row) if row else None


async def revoke_vip_access(user_id: int) -> bool:
    """Remove VIP access and return True only when Telegram confirms success."""
    try:
        # Ban then unban removes current access while permitting later paid re-entry.
        await bot.ban_chat_member(chat_id=VIP_CHANNEL_ID, user_id=user_id)
        await bot.unban_chat_member(
            chat_id=VIP_CHANNEL_ID,
            user_id=user_id,
            only_if_banned=True,
        )
        logging.info("NOVARA_TRIAL_ACCESS_REVOKED | user_id=%s", user_id)
        return True
    except TelegramAPIError:
        logging.exception("NOVARA_TRIAL_ACCESS_REVOKE_FAILED | user_id=%s", user_id)
        return False

async def trial_expiry_worker():
    """Retry expiry checks every minute; never mark EXPIRED before revocation succeeds."""
    while True:
        try:
            now = datetime.now(timezone.utc).isoformat()
            with sqlite3.connect(DATABASE_PATH, timeout=30) as conn:
                expired = conn.execute(
                    """SELECT user_id FROM trial_users
                       WHERE status = 'ACTIVE'
                         AND expires_at IS NOT NULL
                         AND expires_at <= ?""",
                    (now,),
                ).fetchall()

            for (user_id,) in expired:
                try:
                    if has_active_paid_subscription(user_id):
                        with sqlite3.connect(DATABASE_PATH, timeout=30) as conn:
                            conn.execute(
                                """UPDATE trial_users SET status='CONVERTED'
                                   WHERE user_id=? AND status='ACTIVE'""",
                                (user_id,),
                            )
                            conn.commit()
                        logging.info("NOVARA_TRIAL_CONVERTED | user_id=%s", user_id)
                        continue

                    # If Telegram rejects the revocation, leave status ACTIVE so this
                    # worker retries next cycle rather than recording a false success.
                    if not await revoke_vip_access(user_id):
                        continue

                    checked_at = datetime.now(timezone.utc).isoformat()
                    with sqlite3.connect(DATABASE_PATH, timeout=30) as conn:
                        conn.execute(
                            """UPDATE trial_users SET status='EXPIRED'
                               WHERE user_id=? AND status='ACTIVE'
                                 AND expires_at IS NOT NULL AND expires_at <= ?""",
                            (user_id, checked_at),
                        )
                        conn.commit()
                    logging.info("NOVARA_TRIAL_EXPIRED | user_id=%s", user_id)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logging.exception("NOVARA_TRIAL_EXPIRY_ERROR | user_id=%s", user_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.exception("NOVARA_TRIAL_EXPIRY_WORKER_ERROR")
        await asyncio.sleep(60)

# =========================================================
# KEYBOARDS
# =========================================================

def main_menu():
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📡 Free Signals",
                    url=PUBLIC_CHANNEL,
                )
            ],
            [
                InlineKeyboardButton(
                    text="🎁 Start 24-Hour VIP Trial",
                    callback_data="trial",
                )
            ],
            [
                InlineKeyboardButton(
                    text="💎 VIP Membership",
                    callback_data="vip",
                )
            ],
            [
                InlineKeyboardButton(
                    text="💳 Subscription Plans",
                    callback_data="plans",
                )
            ],
            [
                InlineKeyboardButton(
                    text="🔎 Verify Payment",
                    callback_data="verify",
                )
            ],
            [
                InlineKeyboardButton(
                    text="👤 My Subscription",
                    callback_data="subscription",
                )
            ],
            [
                InlineKeyboardButton(
                    text="🆘 Support",
                    callback_data="support",
                )
            ],
        ]
    )


def plans_keyboard():
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🥉 Starter — 30 Days | 30 USDT",
                    callback_data="plan_30",
                )
            ],
            [
                InlineKeyboardButton(
                    text="🥈 Pro — 90 Days | 75 USDT",
                    callback_data="plan_90",
                )
            ],
            [
                InlineKeyboardButton(
                    text="🥇 Elite — 180 Days | 135 USDT",
                    callback_data="plan_180",
                )
            ],
            [
                InlineKeyboardButton(
                    text="⬅️ Main Menu",
                    callback_data="main_menu",
                )
            ],
        ]
    )


# =========================================================
# /START
# =========================================================

@dp.message(CommandStart())
async def start_handler(message: Message):
    await message.answer(
        "✨ <b>WELCOME TO NOVARA</b>\n\n"
        "Your gateway to premium trading signals.\n\n"
        "📡 Access free signals\n"
        "💎 Explore VIP membership\n"
        "🔐 Manage your membership\n\n"
        "Choose an option below:",
        reply_markup=main_menu(),
    )


# =========================================================
# /MYID
# =========================================================

@dp.message(Command("myid"))
async def myid_handler(message: Message):
    if not message.from_user:
        return

    await message.answer(
        f"Your Telegram ID: "
        f"<code>{message.from_user.id}</code>"
    )


# =========================================================
# /VIPLINK — ADMIN ONLY
# =========================================================

@dp.message(Command("viplink"))
async def viplink_handler(message: Message):
    if not message.from_user:
        await message.answer(
            "Unable to identify the sender."
        )
        return

    if message.from_user.id != ADMIN_TELEGRAM_ID:
        await message.answer(
            "⛔ You are not authorized to use this command."
        )
        return

    try:
        invite = await bot.create_chat_invite_link(
            chat_id=VIP_CHANNEL_ID,
            name="NOVARA VIP - Admin Generated",
            expire_date=(
                datetime.now(timezone.utc)
                + timedelta(hours=1)
            ),
            member_limit=1,
        )

        await message.answer(
            "✅ <b>VIP INVITE CREATED</b>\n\n"
            f"🔗 <a href=\"{invite.invite_link}\">"
            "Join NOVARA VIP</a>\n\n"
            "⏳ Expires in: 1 hour\n"
            "👤 Maximum uses: 1\n\n"
            "⚠️ This administrative link does not "
            "confirm payment or grant a paid subscription."
        )

    except TelegramAPIError:
        logging.exception(
            "Failed to create VIP invite link"
        )

        await message.answer(
            "❌ Could not create the invite link. "
            "Check that the bot is an administrator "
            "with permission to invite users."
        )


# =========================================================
# /ORDERS — ADMIN ONLY
# =========================================================

@dp.message(Command("orders"))
async def orders_handler(message: Message):
    if not message.from_user:
        return

    if message.from_user.id != ADMIN_TELEGRAM_ID:
        await message.answer(
            "⛔ You are not authorized to use this command."
        )
        return

    try:
        orders = get_pending_orders()

        if not orders:
            await message.answer(
                "📋 <b>PENDING ORDERS</b>\n\n"
                "No pending orders were found."
            )
            return

        lines = [
            "📋 <b>PENDING ORDERS</b>\n"
        ]

        for order in orders:
            username = (
                f"@{order['username']}"
                if order["username"]
                else "No username"
            )

            lines.append(
                f"🧾 <code>{order['order_id']}</code>\n"
                f"👤 User: {order['user_id']}\n"
                f"🔹 Username: {username}\n"
                f"💎 Plan: {order['plan_name']}\n"
                f"💰 Amount: {order['amount_usdt']} USDT\n"
                f"🕒 Created: {order['created_at']}\n"
            )

        await message.answer(
            "\n".join(lines)
        )

    except Exception:
        logging.exception(
            "Failed to retrieve pending orders"
        )

        await message.answer(
            "❌ Could not retrieve orders."
        )


# =========================================================
# ONE-TIME 24-HOUR VIP TRIAL
# =========================================================

@dp.callback_query(F.data == "trial")
async def trial_handler(callback: CallbackQuery):
    """Issue a single-use invitation; the 24-hour timer begins on actual join."""
    user = callback.from_user
    try:
        existing = get_trial(user.id)
        if existing:
            if existing.get("status") == "INVITED" and existing.get("invite_link"):
                await callback.message.answer(
                    "🎁 <b>Your NOVARA VIP trial invitation is ready.</b>\n\n"
                    "Your 24 hours begin only when you join the VIP channel.\n\n"
                    f"<a href=\"{existing['invite_link']}\">Join NOVARA VIP Trial</a>\n\n"
                    "This invitation is reserved for your Telegram account."
                )
            elif existing.get("status") == "ACTIVE" and existing.get("expires_at"):
                await callback.message.answer(
                    "🎁 Your 24-hour trial is already active.\n"
                    f"Expiry (UTC): <code>{existing['expires_at']}</code>"
                )
            else:
                await callback.message.answer(
                    "⛔ The free 24-hour VIP trial is available only once per Telegram account."
                )
            return

        if has_active_paid_subscription(user.id):
            await callback.message.answer(
                "✅ You already have an active paid subscription. You do not need a trial."
            )
            return

        # No expire_date: the trial timer starts on joining, not on link creation.
        # member_limit=1 makes this invitation single-use.
        invite = await bot.create_chat_invite_link(
            chat_id=VIP_CHANNEL_ID,
            name=f"NOVARA-TRIAL-{user.id}",
            member_limit=1,
        )
        try:
            with sqlite3.connect(DATABASE_PATH, timeout=30) as conn:
                conn.execute(
                    """INSERT INTO trial_users
                       (user_id, username, invite_link, status)
                       VALUES (?, ?, ?, 'INVITED')""",
                    (user.id, user.username or "", invite.invite_link),
                )
                conn.commit()
        except sqlite3.IntegrityError:
            # A concurrent click may have created the reservation first.
            existing = get_trial(user.id)
            if existing and existing.get("status") == "INVITED" and existing.get("invite_link"):
                await callback.message.answer(
                    "🎁 Your trial invitation is ready.\n\n"
                    f"<a href=\"{existing['invite_link']}\">Join NOVARA VIP Trial</a>"
                )
                return
            await callback.message.answer(
                "⛔ A trial has already been reserved or used for this Telegram account."
            )
            return

        await callback.message.answer(
            "🎁 <b>NOVARA VIP — 24-HOUR TRIAL</b>\n\n"
            "Your one-time invite link is ready. The 24-hour clock starts when you join the VIP channel.\n\n"
            f"<a href=\"{invite.invite_link}\">Join NOVARA VIP Trial</a>\n\n"
            "🔒 Access is automatically removed after 24 hours unless you have an active paid subscription.\n"
            "⚠️ This trial can be used only once per Telegram account."
        )
        logging.info("NOVARA_TRIAL_INVITE_CREATED | user_id=%s", user.id)
    except TelegramAPIError:
        logging.exception("NOVARA_TRIAL_CREATE_FAILED | user_id=%s", user.id)
        await callback.message.answer(
            "❌ Could not create the trial invitation. Check the bot's VIP channel permissions or contact support."
        )
    except Exception:
        logging.exception("NOVARA_TRIAL_HANDLER_ERROR | user_id=%s", user.id)
        await callback.message.answer("❌ The trial could not be processed. Please try again later.")
    finally:
        await callback.answer()

@dp.chat_member()
async def track_trial_join(event):
    """Start the trial only for its reserved user and only on the first successful join."""
    try:
        if event.chat.id != VIP_CHANNEL_ID:
            return
        old_status = event.old_chat_member.status
        new_status = event.new_chat_member.status
        if new_status not in ("member", "administrator", "creator"):
            return
        if old_status in ("member", "administrator", "creator"):
            return

        used = getattr(event, "invite_link", None)
        invite_link = getattr(used, "invite_link", None) if used else None
        if not invite_link:
            return

        user_id = event.new_chat_member.user.id
        now = datetime.now(timezone.utc)
        expiry = now + timedelta(hours=24)

        with sqlite3.connect(DATABASE_PATH, timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """SELECT user_id, status FROM trial_users
                   WHERE invite_link = ?""",
                (invite_link,),
            ).fetchone()
            if not row or row["user_id"] != user_id or row["status"] != "INVITED":
                return

            # A paid subscription obtained after the invite was issued takes precedence.
            if has_active_paid_subscription(user_id):
                conn.execute(
                    """UPDATE trial_users SET status='CONVERTED'
                       WHERE user_id=? AND status='INVITED'""",
                    (user_id,),
                )
                conn.commit()
                logging.info("NOVARA_TRIAL_SKIPPED_PAID_USER | user_id=%s", user_id)
                return

            cursor = conn.execute(
                """UPDATE trial_users SET started_at=?, expires_at=?, status='ACTIVE'
                   WHERE user_id=? AND status='INVITED'""",
                (now.isoformat(), expiry.isoformat(), user_id),
            )
            conn.commit()
            if cursor.rowcount != 1:
                return

        await bot.send_message(
            user_id,
            "✅ <b>Your NOVARA VIP trial has started.</b>\n"
            f"It expires in 24 hours (UTC): <code>{expiry.isoformat()}</code>.\n"
            "If you purchase an active subscription before expiry, your paid access will be preserved."
        )
        logging.info("NOVARA_TRIAL_STARTED | user_id=%s | expires_at=%s", user_id, expiry.isoformat())
    except asyncio.CancelledError:
        raise
    except Exception:
        logging.exception("NOVARA_TRIAL_JOIN_TRACKING_ERROR")

# =========================================================
# VIP MEMBERSHIP
# =========================================================

@dp.callback_query(F.data == "vip")
async def vip_handler(callback: CallbackQuery):
    await callback.message.answer(
        "💎 <b>NOVARA VIP MEMBERSHIP</b>\n\n"
        "Unlock access to our private VIP signals channel.\n\n"
        "Choose a subscription plan to continue.",
        reply_markup=plans_keyboard(),
    )

    await callback.answer()


# =========================================================
# SUBSCRIPTION PLANS
# =========================================================

@dp.callback_query(F.data == "plans")
async def plans_handler(callback: CallbackQuery):
    await callback.message.answer(
        "💳 <b>NOVARA SUBSCRIPTION PLANS</b>\n\n"
        "🥉 <b>Starter</b>\n"
        "30 days — 30 USDT\n\n"
        "🥈 <b>Pro</b>\n"
        "90 days — 75 USDT\n\n"
        "🥇 <b>Elite</b>\n"
        "180 days — 135 USDT\n\n"
        "Select your preferred plan below.",
        reply_markup=plans_keyboard(),
    )

    await callback.answer()


# =========================================================
# CREATE ORDER
# =========================================================

@dp.callback_query(F.data.startswith("plan_"))
async def create_order_handler(
    callback: CallbackQuery,
):
    if not callback.from_user:
        await callback.answer(
            "Unable to identify your account.",
            show_alert=True,
        )
        return

    plan_key = callback.data.replace(
        "plan_",
        "",
        1,
    )

    if plan_key not in PLANS:
        await callback.answer(
            "Invalid subscription plan.",
            show_alert=True,
        )
        return

    user = callback.from_user

    try:
        order = create_order(
            user_id=user.id,
            username=user.username or "",
            plan_key=plan_key,
        )

        plan = order["plan"]

        await callback.message.answer(
            "🧾 <b>NOVARA ORDER CREATED</b>\n\n"
            f"🆔 Order ID:\n"
            f"<code>{order['order_id']}</code>\n\n"
            f"💎 Plan: <b>{plan['name']}</b>\n"
            f"⏳ Duration: <b>{plan['days']} days</b>\n"
            f"💰 Amount: <b>{plan['amount']} USDT</b>\n\n"
            f"🌐 Network: <b>{PAYMENT_NETWORK}</b>\n"
            f"🪙 Token: <b>{PAYMENT_TOKEN}</b>\n\n"
            "👛 <b>Payment Wallet</b>\n"
            f"<code>{PAYMENT_WALLET}</code>\n\n"
            "⚠️ <b>IMPORTANT</b>\n"
            "This order is currently <b>PENDING</b>.\n\n"
            "Payment verification is not enabled yet. "
            "Do not treat this order as paid until "
            "the transaction has been independently verified.\n\n"
            "🔐 Always select the Arbitrum One network "
            "when sending funds."
        )

        logging.info(
            "NOVARA_ORDER_CREATED | order_id=%s | "
            "user_id=%s | plan=%s | amount=%s",
            order["order_id"],
            user.id,
            plan_key,
            plan["amount"],
        )

        await callback.answer(
            "Your order has been created."
        )

    except Exception:
        logging.exception(
            "Failed to create order for user %s",
            user.id,
        )

        await callback.answer(
            "Could not create your order. Please try again.",
            show_alert=True,
        )


# =========================================================
# VERIFY PAYMENT — NOT IMPLEMENTED YET
# =========================================================

@dp.callback_query(F.data == "verify")
async def verify_handler(callback: CallbackQuery):
    await callback.message.answer(
        "🔎 <b>PAYMENT VERIFICATION</b>\n\n"
        "Automated on-chain verification is not enabled yet.\n\n"
        "Your order will remain PENDING until "
        "a secure verification system is implemented.\n\n"
        "Please do not submit another payment "
        "just because verification is unavailable."
    )

    await callback.answer()


# =========================================================
# MY SUBSCRIPTION
# =========================================================

@dp.callback_query(F.data == "subscription")
async def subscription_handler(
    callback: CallbackQuery,
):
    user_id = callback.from_user.id

    try:
        orders = get_user_orders(user_id)

        if not orders:
            await callback.message.answer(
                "👤 <b>MY SUBSCRIPTION</b>\n\n"
                "No orders were found for your account."
            )

        else:
            lines = [
                "👤 <b>MY ORDERS</b>\n"
            ]

            for order in orders:
                lines.append(
                    f"🧾 <code>{order['order_id']}</code>\n"
                    f"💎 Plan: {order['plan_name']}\n"
                    f"⏳ Duration: "
                    f"{order['duration_days']} days\n"
                    f"💰 Amount: {order['amount_usdt']} USDT\n"
                    f"📌 Status: <b>{order['status']}</b>\n"
                )

            lines.append(
                "ℹ️ A pending order is not an active subscription."
            )

            await callback.message.answer(
                "\n".join(lines)
            )

    except Exception:
        logging.exception(
            "Failed to retrieve user orders"
        )

        await callback.message.answer(
            "❌ Could not retrieve your orders."
        )

    await callback.answer()


# =========================================================
# SUPPORT
# =========================================================

@dp.callback_query(F.data == "support")
async def support_handler(
    callback: CallbackQuery,
):
    await callback.message.answer(
        "🆘 <b>NOVARA SUPPORT</b>\n\n"
        "For support, please contact the administrator."
    )

    await callback.answer()


# =========================================================
# MAIN MENU CALLBACK
# =========================================================

@dp.callback_query(F.data == "main_menu")
async def main_menu_handler(
    callback: CallbackQuery,
):
    await callback.message.answer(
        "✨ <b>NOVARA ACCESS</b>\n\n"
        "Choose an option below:",
        reply_markup=main_menu(),
    )

    await callback.answer()


# =========================================================
# VIP CHANNEL DETECTION
# =========================================================

@dp.channel_post()
async def detect_channel_id(message: Message):
    logging.info(
        "NOVARA_CHANNEL_DETECTED | "
        "chat_id=%s | title=%s",
        message.chat.id,
        message.chat.title,
    )


# =========================================================
# STARTUP
# =========================================================

async def main():
    init_database()

    logging.info("NOVARA_BOT_STARTING")

    expiry_task = asyncio.create_task(trial_expiry_worker())
    try:
        await dp.start_polling(
            bot,
            allowed_updates=dp.resolve_used_update_types(),
        )
    finally:
        expiry_task.cancel()
        try:
            await expiry_task
        except asyncio.CancelledError:
            pass
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
