const { Telegraf, Markup, session } = require('telegraf');
const QRCode = require('qrcode');
const { format } = require('date-fns');

// Importing local modules (presumed structure based on Python code)
const db = require('./database');
const ox = require('./oxapay');
const {
    BOT_TOKEN, ADMIN_ID,
    REQUIRED_CHANNELS,
    PRESALE_GTC_REWARD, GTC_PRICE_USDT,
    PRESALE_PRICE_USDT, TGE_PRICE_USDT,
    TGE_WITHDRAWAL_PERCENT, PRESALE_WITHDRAWAL_PERCENT,
} = require('./config');

// Logging setup
const logger = {
    info: (msg) => console.log(`${new Date().toISOString()} - INFO - ${msg}`),
    error: (msg) => console.error(`${new Date().toISOString()} - ERROR - ${msg}`)
};

const bot = new Telegraf(BOT_TOKEN);

// ── Conversation states ────────────────────────────────────────────────────────
const ONBOARD_EMOJI = 'ONBOARD_EMOJI';
const ONBOARD_CHANNELS = 'ONBOARD_CHANNELS';
const ONBOARD_COMMENT = 'ONBOARD_COMMENT';
const ONBOARD_SCREENSHOT = 'ONBOARD_SCREENSHOT';

const ROCKET = "🚀";
const ALL_EMOJIS = ["🚀", "🌙", "⭐", "💎", "🔥", "💰", "🎯", "⚡", "🎁"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function gtc_usdt(gtc) {
    const formattedGtc = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(gtc);
    const formattedUsdt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(gtc * GTC_PRICE_USDT);
    return `\`${formattedGtc} GTC\` ≈ \`$${formattedUsdt} USDT\``;
}

function fmt_earn(gtc) {
    const formattedGtc = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(gtc);
    const formattedUsdt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(gtc * GTC_PRICE_USDT);
    return `*${formattedGtc} GTC* ≈ \`$${formattedUsdt} USDT\``;
}

function main_kb() {
    return Markup.keyboard([
        ["💰 Balance", "👥 Refer"],
        ["⛏️ Mine", "💸 Withdrawal"],
        ["👤 Profile"]
    ]).resize();
}

function admin_kb() {
    return Markup.keyboard([
        ["📋 Pending TGE", "📋 Pending Presale"],
        ["💸 Withdrawals", "📢 Announce"],
        ["📊 Distribution", "⚙️ Settings"],
        ["🏠 Main Menu"]
    ]).resize();
}

function channels_keyboard(extra_button = true) {
    /** Inline keyboard with all 4 join buttons + optional verify button. */
    const rows = REQUIRED_CHANNELS.map(ch => [Markup.button.url(ch.name, ch.url)]);
    if (extra_button) {
        rows.push([Markup.button.callback("✅ I've Joined All — Verify", "ob_verify_ch")]);
    }
    return Markup.inlineKeyboard(rows);
}

async function is_member(ctx, user_id, tg_id) {
    try {
        const member = await ctx.telegram.getChatMember(tg_id, user_id);
        return ["member", "administrator", "creator"].includes(member.status);
    } catch (error) {
        return false;
    }
}

// ── State Handling ────────────────────────────────────────────────────────────
bot.use(session());

// ── Onboarding ────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
    const user = ctx.from;
    const args = ctx.startPayload;

    let referred_by = null;
    if (args) {
        try {
            const ref = parseInt(args);
            if (!isNaN(ref) && ref !== user.id) {
                referred_by = ref;
            }
        } catch (e) {}
    }

    if (!db.get_user(user.id)) {
        db.create_user(user.id, user.username || "", `${user.first_name} ${user.last_name || ""}`.trim(), referred_by);
    }

    const ud = db.get_user(user.id);
    if (ud && ud.verified) {
        await ctx.replyWithMarkdown(
            `👋 Welcome back, *${user.first_name}*!\nUse the menu below.`,
            main_kb()
        );
        ctx.session = null;
        return;
    }

    await _send_emoji_step(ctx);
    ctx.session = { state: ONBOARD_EMOJI };
});

bot.command('verify', async (ctx) => {
    /** Allow re-entry for users who haven't finished onboarding. */
    const ud = db.get_user(ctx.from.id);
    if (ud && ud.verified) {
        await ctx.replyWithMarkdown(
            "✅ *Verification Successful!*\n\nWelcome to GTC Mining. Use the panel below.",
            main_kb()
        );
        ctx.session = null;
        return;
    }
    if (!ud) {
        db.create_user(ctx.from.id, ctx.from.username || "", `${ctx.from.first_name} ${ctx.from.last_name || ""}`.trim());
    }
    await _send_emoji_step(ctx);
    ctx.session = { state: ONBOARD_EMOJI };
});

async function _send_emoji_step(ctx) {
    const emojis = [...ALL_EMOJIS].sort(() => Math.random() - 0.5);
    const rows = [];
    for (let i = 0; i < 9; i += 3) {
        rows.push(emojis.slice(i, i + 3).map(e => Markup.button.callback(e, `ob_emoji_${e}`)));
    }
    await ctx.replyWithMarkdown(
        "🔐 *Anti-Bot Verification*\n\nTap the *🚀 Rocket* emoji to continue!",
        Markup.inlineKeyboard(rows)
    );
}

bot.action(/ob_emoji_(.+)/, async (ctx) => {
    const chosen = ctx.match[1];
    if (chosen !== ROCKET) {
        await ctx.answerCbQuery("❌ Wrong! Find the 🚀 Rocket.", { show_alert: true });
        const emojis = [...ALL_EMOJIS].sort(() => Math.random() - 0.5);
        const rows = [];
        for (let i = 0; i < 9; i += 3) {
            rows.push(emojis.slice(i, i + 3).map(e => Markup.button.callback(e, `ob_emoji_${e}`)));
        }
        await ctx.editMessageReplyMarkup(Markup.inlineKeyboard(rows).reply_markup);
        return;
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText("✅ Verified! Now join our communities 👇");
    await ctx.replyWithMarkdown(
        "📢 *Join All Our Channels*\n\n" +
        "You must join all 4 to continue.\n" +
        "After joining, tap ✅ Verify below.",
        channels_keyboard()
    );
    ctx.session.state = ONBOARD_CHANNELS;
});

bot.action("ob_verify_ch", async (ctx) => {
    await ctx.answerCbQuery("🔄 Checking membership…");
    const user_id = ctx.from.id;

    for (const ch of REQUIRED_CHANNELS) {
        if (ch.verifiable && ch.tg_id) {
            const joined = await is_member(ctx, user_id, ch.tg_id);
            if (!joined) {
                await ctx.answerCbQuery(
                    `❌ You haven't joined ${ch.name} yet!\nPlease join and try again.`,
                    { show_alert: true }
                );
                await ctx.editMessageReplyMarkup(channels_keyboard().reply_markup);
                return;
            }
        }
    }

    await ctx.editMessageText("✅ All channels joined!");
    await _send_comment_step(ctx.chat.id, ctx);
    ctx.session.state = ONBOARD_COMMENT;
});

async function _send_comment_step(chat_id, ctx) {
    const post_url = db.get_setting("comment_post_url") || "https://x.com";
    await ctx.telegram.sendMessage(
        chat_id,
        "📝 *Comment Task*\n\n" +
        "Copy this text and post it as a comment on the link below:\n\n" +
        "```\nGTC to moon\n```\n\n" +
        `👉 [Open Post](${post_url})\n\n` +
        "After commenting, tap *Done* below.",
        {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.url("📝 Open Post", post_url)],
                [Markup.button.callback("✅ Done — I Commented!", "ob_comment_done")]
            ]).reply_markup
        }
    );
}

bot.action("ob_comment_done", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
        "📸 *Screenshot Required*\n\nSend a screenshot of your comment as proof.",
        { parse_mode: 'Markdown' }
    );
    ctx.session.state = ONBOARD_SCREENSHOT;
});

bot.on('photo', async (ctx) => {
    if (ctx.session && ctx.session.state === ONBOARD_SCREENSHOT) {
        const user = ctx.from;
        const file_id = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        
        db.save_screenshot(user.id, file_id);
        db.update_user(user.id, { verified: 1 });

        // Referral reward
        const ud = db.get_user(user.id);
        if (ud && ud.referred_by) {
            const amt = parseFloat(db.get_setting("refer_amount") || 50);
            const ref_id = ud.referred_by;
            const ref_ud = db.get_user(ref_id);
            if (ref_ud) {
                db.add_balance(ref_id, amt);
                db.update_user(ref_id, { referral_count: (ref_ud.referral_count || 0) + 1 });
                try {
                    await ctx.telegram.sendMessage(
                        ref_id,
                        `🎉 *Referral Reward!*\n\nSomeone joined via your link!\nYou earned ${fmt_earn(amt)}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (e) {}
            }
        }

        // Notify admin
        try {
            await ctx.telegram.sendPhoto(
                ADMIN_ID,
                file_id,
                { caption: `📸 New verified user screenshot\n@${user.username || user.first_name} (ID: ${user.id})` }
            );
        } catch (e) {}

        await ctx.replyWithMarkdown(
            "🎉 *Verification Successful!*\n\n" +
            "Welcome to GTC Mining. Use the panel below to manage your account.",
            main_kb()
        );
        ctx.session = null;
    }
});

bot.on('message', async (ctx, next) => {
    if (ctx.session && ctx.session.state === ONBOARD_SCREENSHOT && !ctx.message.photo) {
        await ctx.reply("❌ Please send a photo screenshot.");
        return;
    }
    return next();
});

// ── Guard ─────────────────────────────────────────────────────────────────────

async function _require_verified(ctx) {
    /** Returns user dict if verified, else sends a message and returns null. */
    const ud = db.get_user(ctx.from.id);
    if (!ud) {
        await ctx.reply("Please use /start to register first.");
        return null;
    }
    if (!ud.verified) {
        await ctx.reply(
            "⚠️ Please complete verification first.\nSend /start or /verify to begin."
        );
        return null;
    }
    return ud;
}

// ── User menu ─────────────────────────────────────────────────────────────────

bot.hears("💰 Balance", async (ctx) => {
    const ud = await _require_verified(ctx);
    if (!ud) return;
    const bal = ud.balance;
    await ctx.replyWithMarkdown(
        `💰 *Your Balance*\n\n` +
        `GTC: ${gtc_usdt(bal)}\n` +
        `Rate: 1 GTC = $${GTC_PRICE_USDT} USDT\n\n` +
        `TGE: ${ud.tge_joined ? '✅ Joined' : '❌ Not joined'}\n` +
        `Presale: ${ud.presale_joined ? '✅ Joined' : '❌ Not joined'}`,
        main_kb()
    );
});

bot.hears("👥 Refer", async (ctx) => {
    const ud = await _require_verified(ctx);
    if (!ud) return;
    const user = ctx.from;
    const amt = parseFloat(db.get_setting("refer_amount") || 50);
    const bot_me = await ctx.telegram.getMe();
    const link = `https://t.me/${bot_me.username}?start=${user.id}`;
    await ctx.replyWithMarkdown(
        `👥 *Referral Program*\n\n` +
        `Earn ${fmt_earn(amt)} for every friend who joins!\n\n` +
        `Your link:\n\`${link}\`\n\n` +
        `Total referrals: *${ud.referral_count || 0}*`,
        main_kb()
    );
});

bot.hears("⛏️ Mine", async (ctx) => {
    const ud = await _require_verified(ctx);
    if (!ud) return;
    const user = ctx.from;
    const cooldown = parseInt(db.get_setting("mine_cooldown") || 86400);
    const last = ud.last_mine || 0;
    const now = Math.floor(Date.now() / 1000);
    const remaining = cooldown - (now - last);
    
    if (remaining > 0) {
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        const nxtDate = new Date((last + cooldown) * 1000);
        const nxt = format(nxtDate, "HH:mm 'UTC'");
        await ctx.replyWithMarkdown(
            `⛏️ *Mining Cooldown*\n\n` +
            `You can mine once every 24 hours.\n` +
            `⏰ Next mine in: *${h}h ${m}m*\n` +
            `🕐 Available at: ${nxt}`,
            main_kb()
        );
        return;
    }
    
    const amt = parseFloat(db.get_setting("mine_amount") || 10);
    db.add_balance(user.id, amt);
    db.update_user(user.id, { last_mine: now });
    const new_bal = ud.balance + amt;
    await ctx.replyWithMarkdown(
        `⛏️ *Daily Mining Successful!*\n\n` +
        `Mined: ${fmt_earn(amt)}\n\n` +
        `💰 New balance: ${gtc_usdt(new_bal)}\n\n` +
        `⏰ Come back in 24 hours!`,
        main_kb()
    );
});

bot.hears("👤 Profile", async (ctx) => {
    const ud = await _require_verified(ctx);
    if (!ud) return;
    const user = ctx.from;
    const bal = ud.balance;
    const joined = format(new Date((ud.joined_at || 0) * 1000), "yyyy-MM-dd");
    await ctx.replyWithMarkdown(
        `👤 *Your Profile*\n\n` +
        `Name: ${user.first_name} ${user.last_name || ""}\n` +
        `Username: @${user.username || 'N/A'}\n` +
        `ID: \`${user.id}\`\n` +
        `Joined: ${joined}\n` +
        `Referrals: ${ud.referral_count || 0}\n` +
        `Balance: ${gtc_usdt(bal)}\n` +
        `TGE: ${ud.tge_joined ? '✅' : '❌'}\n` +
        `Presale: ${ud.presale_joined ? '✅' : '❌'}`,
        main_kb()
    );
});

// ── Withdrawal ────────────────────────────────────────────────────────────────

bot.hears("💸 Withdrawal", async (ctx) => {
    const ud = await _require_verified(ctx);
    if (!ud) return;
    const bal = ud.balance;
    const min_wd = parseFloat(db.get_setting("min_withdrawal") || 1000);

    if (bal < min_wd) {
        const formattedMin = new Intl.NumberFormat('en-US').format(min_wd);
        const formattedDiff = new Intl.NumberFormat('en-US').format(min_wd - bal);
        await ctx.replyWithMarkdown(
            `💰 *Keep Mining!*\n\n` +
            `Your balance: ${gtc_usdt(bal)}\n` +
            `Required to withdraw: \`${formattedMin} GTC\`\n\n` +
            `You need *${formattedDiff} more GTC*. Keep mining daily! ⛏️`,
            main_kb()
        );
        return;
    }

    if (ud.presale_joined) {
        const amt_gtc = bal;
        const amt_usdt = amt_gtc * GTC_PRICE_USDT;
        ctx.session = { awaiting_bnb: { type: "presale", amount_gtc: amt_gtc, amount_usdt: amt_usdt } };
        await ctx.replyWithMarkdown(
            `💎 *Presale Withdrawal*\n\n` +
            `Withdrawable: ${gtc_usdt(amt_gtc)}\n` +
            `(100% of your balance)\n\n` +
            `Please send your *BNB (BEP-20) wallet address*:`,
            Markup.removeKeyboard()
        );
        return;
    }

    if (ud.tge_joined) {
        const amt_gtc = bal * TGE_WITHDRAWAL_PERCENT / 100;
        const amt_usdt = amt_gtc * GTC_PRICE_USDT;
        ctx.session = { awaiting_bnb: { type: "tge", amount_gtc: amt_gtc, amount_usdt: amt_usdt } };
        await ctx.replyWithMarkdown(
            `🏆 *TGE Withdrawal*\n\n` +
            `Total balance: ${gtc_usdt(bal)}\n` +
            `Withdrawable (40%): ${gtc_usdt(amt_gtc)}\n\n` +
            `Please send your *BNB (BEP-20) wallet address*:`,
            Markup.removeKeyboard()
        );
        return;
    }

    await ctx.replyWithMarkdown(
        `💸 *Withdrawal Options*\n\n` +
        `Your balance: ${gtc_usdt(bal)}\n\n` +
        `Choose how you'd like to withdraw:`,
        Markup.inlineKeyboard([
            [Markup.button.callback("🏆 Join TGE — Withdraw 40%", "wd_join_tge")],
            [Markup.button.callback("💎 Join Presale — Withdraw 100%", "wd_join_presale")],
        ])
    );
});

// ── TGE join flow ────────────────────────────────────────────────────────────

async function tge_join_prompt(chat_id, user_id, ctx) {
    const ud = db.get_user(user_id);
    const req = db.get_user_tge_request(user_id);
    if (ud && ud.tge_joined) {
        await ctx.telegram.sendMessage(chat_id, "✅ You have already joined TGE!");
        return;
    }
    if (req && req.status === "pending") {
        await ctx.telegram.sendMessage(chat_id, "⏳ Your TGE request is pending admin approval.");
        return;
    }
    const bal = ud ? ud.balance : 0;
    const amt40 = bal * TGE_WITHDRAWAL_PERCENT / 100;
    const order_id = `tge_${user_id}_${Math.floor(Date.now() / 1000)}`;
    const result = await ox.create_invoice(TGE_PRICE_USDT, order_id);
    if (!result.success) {
        await ctx.telegram.sendMessage(chat_id, `❌ Payment gateway error: ${result.error}\nTry again later.`);
        return;
    }
    const pay_data = result.data;
    const pay_link = pay_data.payLink || "";
    const track_id = pay_data.trackId || "";
    db.create_tge_request(user_id, track_id);
    
    const qrBuffer = await QRCode.toBuffer(pay_link);
    const caption = (
        `🏆 *Join TGE — Only $${TGE_PRICE_USDT.toFixed(0)}!*\n\n` +
        `🔥 *Unlock 40% of your balance for withdrawal!*\n\n` +
        `Your balance: ${gtc_usdt(bal)}\n` +
        `💸 You'll be able to withdraw: *${gtc_usdt(amt40)}*\n\n` +
        `💳 One-time fee: *$${TGE_PRICE_USDT.toFixed(0)} USDT*\n` +
        `Track ID: \`${track_id}\`\n\n` +
        `⚡ *Don't miss out — pay once, withdraw forever!*\n\n` +
        `Scan the QR or tap *Pay Now*, then verify your payment.`
    );
    await ctx.telegram.sendPhoto(
        chat_id, 
        { source: qrBuffer }, 
        {
            caption,
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.url("💳 Pay Now", pay_link)],
                [Markup.button.callback("✅ Verify Payment", `wd_verify_tge_${track_id}`)],
                [Markup.button.callback("📋 I have a TX Hash", `wd_paste_hash_${user_id}`)],
            ]).reply_markup
        }
    );
}

bot.action("wd_join_tge", async (ctx) => {
    await ctx.answerCbQuery();
    await tge_join_prompt(ctx.chat.id, ctx.from.id, ctx);
});

bot.command('tge', async (ctx) => {
    const ud = await _require_verified(ctx);
    if (!ud) return;
    await tge_join_prompt(ctx.chat.id, ctx.from.id, ctx);
});

bot.action(/wd_verify_tge_(.+)/, async (ctx) => {
    await ctx.answerCbQuery("🔄 Checking payment…");
    const track_id = ctx.match[1];
    const user = ctx.from;
    const ud = db.get_user(user.id);
    const result = await ox.verify_payment(track_id);
    
    if (result.paid) {
        const req = db.get_user_tge_request(user.id);
        if (req) {
            db.update_tge_request(req.id, "approved");
        }
        db.update_user(user.id, { tge_joined: 1, withdrawal_percent: TGE_WITHDRAWAL_PERCENT });
        const bal = ud ? ud.balance : 0;
        const amt40 = bal * TGE_WITHDRAWAL_PERCENT / 100;
        try {
            await ctx.telegram.sendMessage(
                ADMIN_ID,
                `🏆 *TGE Payment Confirmed*\n\n` +
                `User: @${user.username || user.first_name}\n` +
                `ID: \`${user.id}\`\n` +
                `Track: \`${track_id}\`\n` +
                `Balance: ${gtc_usdt(bal)}\n` +
                `Withdrawable (40%): ${gtc_usdt(amt40)}`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {}
        await ctx.editMessageCaption(
            `✅ *TGE Payment Confirmed!*\n\n` +
            `You can now withdraw *40%* of your balance!\n` +
            `💸 Go to Withdrawal and send your BNB address.`,
            { parse_mode: 'Markdown' }
        );
    } else {
        await ctx.answerCbQuery("❌ Payment not confirmed yet. Try again shortly.", { show_alert: true });
    }
});

// ── Presale join flow ────────────────────────────────────────────────────────

async function presale_join_prompt(chat_id, user_id, ctx) {
    const ud = db.get_user(user_id);
    const req = db.get_user_presale_request(user_id);
    if (ud && ud.presale_joined) {
        await ctx.telegram.sendMessage(chat_id, "✅ You have already joined Presale!");
        return;
    }
    if (req && ["pending", "pending_admin"].includes(req.status)) {
        await ctx.telegram.sendMessage(chat_id, "⏳ Your presale request is pending review.");
        return;
    }
    const amount_usdt = PRESALE_PRICE_USDT;
    const order_id = `presale_${user_id}_${Math.floor(Date.now() / 1000)}`;
    const result = await ox.create_invoice(amount_usdt, order_id);
    if (!result.success) {
        await ctx.telegram.sendMessage(chat_id, `❌ Payment gateway error: ${result.error}\nTry again later.`);
        return;
    }
    const pay_data = result.data;
    const pay_link = pay_data.payLink || "";
    const track_id = pay_data.trackId || "";
    db.create_presale_request(user_id, track_id);
    
    const qrBuffer = await QRCode.toBuffer(pay_link);
    const bonus_usdt = PRESALE_GTC_REWARD * GTC_PRICE_USDT;
    const caption = (
        `💎 *Join Presale — Only $${amount_usdt.toFixed(0)}!*\n\n` +
        `🚀 *Get FULL access to withdraw ALL your funds!*\n\n` +
        `✨ *What you get:*\n` +
        `   🎁 *${new Intl.NumberFormat().format(PRESALE_GTC_REWARD)} GTC Bonus* ≈ \`$${new Intl.NumberFormat().format(bonus_usdt)} USDT\`\n` +
        `   💸 Withdraw *100%* of your total balance\n` +
        `   🔓 Lifetime withdrawal access — forever!\n\n` +
        `💳 One-time fee: *$${amount_usdt.toFixed(0)} USDT*\n` +
        `Track ID: \`${track_id}\`\n\n` +
        `⚡ *Don't miss this — pay once, earn forever!*\n\n` +
        `Scan the QR or tap *Pay Now*, then verify below.`
    );
    const buttons = Markup.inlineKeyboard([
        [Markup.button.url("💳 Pay Now", pay_link)],
        [Markup.button.callback("✅ Verify Payment", `wd_verify_presale_${track_id}`)],
        [Markup.button.callback("📋 I have a TX Hash", `wd_paste_hash_${user_id}`)],
    ]);
    await ctx.telegram.sendPhoto(chat_id, { source: qrBuffer }, { caption, parse_mode: 'Markdown', reply_markup: buttons.reply_markup });
}

bot.action("wd_join_presale", async (ctx) => {
    await ctx.answerCbQuery();
    await presale_join_prompt(ctx.chat.id, ctx.from.id, ctx);
});

bot.command('presale', async (ctx) => {
    const ud = await _require_verified(ctx);
    if (!ud) return;
    await presale_join_prompt(ctx.chat.id, ctx.from.id, ctx);
});

bot.action(/wd_verify_presale_(.+)/, async (ctx) => {
    await ctx.answerCbQuery("🔄 Checking…");
    const track_id = ctx.match[1];
    const user_id = ctx.from.id;
    const result = await ox.verify_payment(track_id);
    
    if (result.paid) {
        db.update_user(user_id, { presale_joined: 1, withdrawal_percent: PRESALE_WITHDRAWAL_PERCENT });
        db.add_balance(user_id, PRESALE_GTC_REWARD);
        const req = db.get_user_presale_request(user_id);
        if (req) {
            db.update_presale_request(req.id, "approved");
        }
        try {
            await ctx.telegram.sendMessage(
                ADMIN_ID,
                `✅ *Presale Auto-Verified*\n\nUser: @${ctx.from.username || ctx.from.first_name}\n` +
                `ID: \`${user_id}\`\nTrack: \`${track_id}\`\nRewarded: ${new Intl.NumberFormat().format(PRESALE_GTC_REWARD)} GTC`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {}
        await ctx.editMessageCaption(
            `✅ *Payment Confirmed!*\n\n` +
            `Credited ${fmt_earn(PRESALE_GTC_REWARD)}!\n` +
            `You can now withdraw 100% of your balance. Go to 💸 Withdrawal.`,
            { parse_mode: 'Markdown' }
        );
    } else {
        await ctx.answerCbQuery("❌ Payment not confirmed yet. Try again shortly.", { show_alert: true });
    }
});

bot.action(/wd_paste_hash_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session = { awaiting_hash: true };
    await ctx.reply("📋 Send your transaction (TX) hash:");
});

// ── Admin ─────────────────────────────────────────────────────────────────────

bot.command('admin', async (ctx) => {
    if (ctx.from.id != ADMIN_ID) {
        await ctx.reply("❌ Unauthorized.");
        return;
    }
    const s = db.get_distribution_stats();
    await ctx.replyWithMarkdown(
        `🔧 *Admin Panel*\n\n` +
        `👥 Users: ${s.total_users} total · ${s.verified} verified\n` +
        `💰 Circulation: ${gtc_usdt(s.total_balance)}\n` +
        `⛏️ Mined today: ${s.mine_today} users\n` +
        `💸 Pending withdrawals: ${s.pending_wd}`,
        admin_kb()
    );
});

bot.hears("📋 Pending TGE", async (ctx) => {
    if (ctx.from.id != ADMIN_ID) return;
    const reqs = db.get_pending_tge_requests();
    if (!reqs || reqs.length === 0) {
        await ctx.reply("✅ No pending TGE requests.", admin_kb());
        return;
    }
    for (const r of reqs.slice(0, 10)) {
        const bal = r.balance || 0;
        const amt40 = bal * TGE_WITHDRAWAL_PERCENT / 100;
        const d = format(new Date(r.created_at * 1000), "yyyy-MM-dd HH:mm 'UTC'");
        // Translation ends here as the source code was truncated.
    }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
