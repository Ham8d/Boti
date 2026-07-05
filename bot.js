const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = '8477156849:AAEcwk7nhNJtn5tAPfxQ3L_3NDcrN8b_-zU';
const ADMIN_ID = 1651487511;
const CHANNEL_USERNAME = '@turath_st';

const bot = new Telegraf(BOT_TOKEN);

// مصفوفة لتخزين الأزرار (تذكر أن Vercel يمسحها عند السكون، للنسخة النهائية يُفضل استخدام قاعدة بيانات)
let dynamicButtons = [];
// متغير للتحقق مما إذا كان الإدمن في وضع "إضافة زر"
let waitingForAdd = false;

// === 1. التحقق من الاشتراك الإجباري ===
bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.id === ADMIN_ID) {
        return next();
    }

    if (ctx.from && ctx.chat?.type === 'private') {
        try {
            const member = await ctx.telegram.getChatMember(CHANNEL_USERNAME, ctx.from.id);
            if (['left', 'kicked'].includes(member.status)) {
                return ctx.reply(
                    'عذراً، يجب عليك الاشتراك في قناة البوت أولاً 🌹',
                    Markup.inlineKeyboard([
                        [Markup.button.url('اضغط هنا للاشتراك 📢', 'https://t.me/turath_st')]
                    ])
                );
            }
        } catch (error) {
            console.error('Error:', error);
            return ctx.reply('تأكد من رفع البوت كمشرف في قناة الاشتراك الإجباري.');
        }
    }
    return next();
});

// === 2. لوحة تحكم الإدمن (بصيغة أزرار) ===
bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    // إيقاف أي عملية إضافة سابقة احتياطياً
    waitingForAdd = false; 

    ctx.reply('مرحباً بك في لوحة التحكم 🛠️\nاختر الإجراء المطلوب:', 
        Markup.inlineKeyboard([
            [Markup.button.callback('➕ إضافة زر جديد', 'action_add_btn')],
            [Markup.button.callback('🗑️ مسح جميع الأزرار', 'action_clear_btns')]
        ])
    );
});

// === 3. التعامل مع ضغطات أزرار الإدارة ===
bot.action('action_add_btn', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    waitingForAdd = true;
    ctx.reply('حسناً، أرسل الآن اسم الزر والرابط بهذا الشكل:\n\nاسم الزر - الرابط\n\n(مثال: متجرنا - https://atrath-store.vercel.app/)');
    ctx.answerCbQuery();
});

bot.action('action_clear_btns', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    dynamicButtons = [];
    waitingForAdd = false;
    ctx.reply('تم مسح جميع الأزرار بنجاح 🗑️');
    ctx.answerCbQuery();
});

// === 4. استقبال النصوص (لإضافة الزر وتوليد الرابط الخاص) ===
bot.on('text', (ctx, next) => {
    // إذا كان المستخدم هو الإدمن والبوت ينتظر منه بيانات الزر
    if (ctx.from.id === ADMIN_ID && waitingForAdd) {
        const text = ctx.message.text;
        
        if (!text.includes('-')) {
            return ctx.reply('صيغة خاطئة ❌. يرجى إرسالها بالشكل: اسم الزر - الرابط');
        }

        const parts = text.split('-');
        const btnText = parts[0].trim();
        const btnUrl = parts.slice(1).join('-').trim(); 

        if (btnText && btnUrl.startsWith('http')) {
            // توليد معرّف (ID) فريد وعشوائي لهذا الزر
            const btnId = Math.random().toString(36).substring(2, 8);
            
            dynamicButtons.push({ id: btnId, text: btnText, url: btnUrl });
            waitingForAdd = false; // إنهاء وضع الإضافة
            
            // استخراج يوزر البوت لتكوين رابط المشاركة
            const botUsername = ctx.botInfo.username;
            const shareLink = `https://t.me/${botUsername}?start=${btnId}`;

            ctx.reply(`تمت إضافة الزر "${btnText}" بنجاح ✅\n\n🔗 رابط المشاركة الخاص بهذا الزر:\n${shareLink}`);
        } else {
            ctx.reply('تأكد من أن الرابط يبدأ بـ http أو https ❌');
        }
    } else {
        return next();
    }
});

// === 5. الاستجابة للأوامر والروابط العميقة (Deep Links) ===
bot.start((ctx) => {
    // ctx.startPayload يحتوي على الكود الذي يأتي بعد كلمة start= في الرابط
    const payload = ctx.startPayload; 

    // إذا دخل المستخدم عبر رابط مخصص لزر معين
    if (payload) {
        const specificBtn = dynamicButtons.find(b => b.id === payload);
        if (specificBtn) {
            return ctx.reply('إليك المحتوى المطلوب:', Markup.inlineKeyboard([
                [Markup.button.url(specificBtn.text, specificBtn.url)]
            ]));
        } else {
            return ctx.reply('عذراً، هذا الرابط غير صالح أو تم حذف الزر ❌');
        }
    }

    // إذا دخل المستخدم بشكل طبيعي (بدون رابط مخصص)
    if (dynamicButtons.length === 0) {
        return ctx.reply('مرحباً بك! لا توجد أزرار مضافة حالياً.');
    }

    const keyboard = dynamicButtons.map(btn => [Markup.button.url(btn.text, btn.url)]);
    ctx.reply('مرحباً بك! تفضل باختيار ما تريد:', Markup.inlineKeyboard(keyboard));
});

// === إعداد Webhook ليتوافق مع Vercel ===
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body, res);
        }
        res.status(200).send('Bot is running with Deep Links on Vercel!');
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Error');
    }
};
