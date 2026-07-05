const { Telegraf, Markup } = require('telegraf');

// ===== الإعدادات — غيّرها حسب الحاجة =====
const BOT_TOKEN = '8477156849:AAEcwk7nhNJtn5tAPfxQ3L_3NDcrN8b_-zU';
const ADMIN_ID  = 1651487511;
let CHANNEL     = '@your_channel'; // غيّر هذا لمعرّف قناتك أو استخدم /setchannel
// ==========================================

const bot = new Telegraf(BOT_TOKEN);

// ===== الاشتراك الإجباري =====
bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.id === ADMIN_ID) return next();
    if (ctx.chat?.type !== 'private') return next();
    if (CHANNEL === '@your_channel') return next(); // لم تُعيَّن قناة بعد

    try {
        const member = await ctx.telegram.getChatMember(CHANNEL, ctx.from.id);
        if (['left', 'kicked'].includes(member.status)) {
            return ctx.reply(
                '⚠️ يجب الاشتراك في القناة أولاً للمتابعة:',
                Markup.inlineKeyboard([
                    [Markup.button.url('📢 اشترك الآن', `https://t.me/${CHANNEL.replace('@', '')}`)],
                    [Markup.button.callback('✅ اشتركت، تحقق', 'check_sub')]
                ])
            );
        }
    } catch (e) {
        console.error('Subscription check failed:', e.message);
    }

    return next();
});

// ===== التحقق من الاشتراك =====
bot.action('check_sub', async (ctx) => {
    try {
        const member = await ctx.telegram.getChatMember(CHANNEL, ctx.from.id);
        if (['left', 'kicked'].includes(member.status)) {
            return ctx.answerCbQuery('❌ لم تشترك بعد!', { show_alert: true });
        }
        await ctx.answerCbQuery('✅ تم التحقق!');
        await ctx.deleteMessage();
        ctx.reply('مرحباً بك! 👋');
    } catch (e) {
        ctx.answerCbQuery('حدث خطأ، حاول مجدداً');
    }
});

// ===== أمر /start =====
bot.start((ctx) => {
    ctx.reply('مرحباً بك! 👋');
});

// ===== لوحة الأدمن =====
bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply(
        `🛠️ لوحة التحكم\n📢 القناة الحالية: ${CHANNEL}`,
        Markup.inlineKeyboard([
            [Markup.button.callback('📢 تغيير القناة', 'set_channel')]
        ])
    );
});

bot.action('set_channel', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('أرسل معرّف القناة الجديدة:\n\nمثال: `@mychannel`', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

bot.on('text', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const text = ctx.message.text.trim();
    if (text.startsWith('@')) {
        try {
            const chat = await ctx.telegram.getChat(text);
            CHANNEL = text;
            ctx.reply(`✅ تم تغيير القناة إلى: ${CHANNEL}\n📛 ${chat.title}\n\n⚠️ ملاحظة: سيُعاد التعيين عند إعادة تشغيل البوت. لجعله دائماً، غيّر CHANNEL في الكود مباشرة.`);
        } catch (e) {
            ctx.reply('❌ القناة غير موجودة أو البوت ليس مشرفاً فيها.');
        }
    }
});

// ===== Webhook لـ Vercel =====
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body, res);
        } else {
            res.status(200).send('Bot is running ✅');
        }
    } catch (e) {
        console.error(e);
        res.status(500).send('Error');
    }
};
