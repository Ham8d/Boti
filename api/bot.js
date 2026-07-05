// ============================================================
// bot.js — Telegram Button Bot | لوحة تحكم داخل التيليغرام
// ============================================================

const BOT_TOKEN  = process.env.BOT_TOKEN  || "8477156849:AAEcwk7nhNJtn5tAPfxQ3L_3NDcrN8b_-zU";
const ADMIN_ID   = parseInt(process.env.ADMIN_ID || "1651487511");
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── KV Storage ──────────────────────────────────────────────
const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = {};

async function kvGet(key) {
  if (!KV_URL) return mem[key] ?? null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const j = await r.json();
  if (j.result == null) return null;
  try { return JSON.parse(j.result); } catch { return j.result; }
}
async function kvSet(key, value) {
  if (!KV_URL) { mem[key] = value; return; }
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(JSON.stringify(value))
  });
}
async function kvDel(key) {
  if (!KV_URL) { delete mem[key]; return; }
  await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
}

// ─── Data helpers ─────────────────────────────────────────────
const getButtons  = async () => (await kvGet("buttons"))  || {};
const setButtons  = async b  => kvSet("buttons", b);
const getChannels = async () => (await kvGet("channels")) || [];
const setChannels = async c  => kvSet("channels", c);
const getUsers    = async () => (await kvGet("users"))    || [];
const getBotInfo  = async () => (await kvGet("botinfo"))  || { welcome: "أهلاً بك! 👋\nاختر من القائمة أدناه:" };
const setBotInfo  = async i  => kvSet("botinfo", i);
const getState    = async id => (await kvGet(`state:${id}`)) || null;
const setState    = async (id, s) => kvSet(`state:${id}`, s);
const clearState  = async id => kvDel(`state:${id}`);

async function addUser(id) {
  const users = await getUsers();
  if (!users.includes(id)) { users.push(id); await kvSet("users", users); }
}

function slugify(str) {
  return str.trim().replace(/\s+/g, "_").replace(/[^\w\u0600-\u06FF]/g, "").substring(0, 30);
}
const isAdmin = id => parseInt(id) === ADMIN_ID;

// ─── Telegram API ─────────────────────────────────────────────
async function tg(method, body = {}) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}
async function editMsg(chatId, msgId, text, keyboard) {
  return tg("editMessageText", {
    chat_id: chatId, message_id: msgId,
    text, parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
  });
}
async function send(chatId, text, keyboard, extra = {}) {
  return tg("sendMessage", {
    chat_id: chatId, text, parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    ...extra
  });
}

// ─── Subscription check ───────────────────────────────────────
async function checkSubscription(userId) {
  const channels = await getChannels();
  const notJoined = [];
  for (const ch of channels) {
    try {
      const r = await tg("getChatMember", { chat_id: ch, user_id: userId });
      if (!["member","administrator","creator"].includes(r.result?.status)) notJoined.push(ch);
    } catch { notJoined.push(ch); }
  }
  return notJoined;
}
async function sendSubPrompt(chatId, pending, payload) {
  const kb = pending.map(ch => ([{ text: `📢 اشترك في ${ch}`, url: `https://t.me/${ch.replace("@","")}` }]));
  kb.push([{ text: "✅ تحققت من الاشتراك", callback_data: `recheck:${payload}` }]);
  await send(chatId, "⚠️ يجب الاشتراك في القنوات التالية أولاً:", kb);
}

// ─── Send button content ──────────────────────────────────────
async function sendContent(chatId, btn) {
  const { type, content, caption = "" } = btn;
  const map = { photo:"sendPhoto", video:"sendVideo", audio:"sendAudio", document:"sendDocument", animation:"sendAnimation" };
  if (type === "text") {
    await send(chatId, content);
  } else {
    await tg(map[type], { chat_id: chatId, [type]: content, caption, parse_mode: "HTML" });
  }
}

// ─── Build user menu ──────────────────────────────────────────
function buildMenu(buttons) {
  const keys = Object.keys(buttons);
  if (!keys.length) return null;
  const rows = [];
  for (let i = 0; i < keys.length; i += 2) {
    const row = [{ text: buttons[keys[i]].label, callback_data: `btn:${keys[i]}` }];
    if (keys[i+1]) row.push({ text: buttons[keys[i+1]].label, callback_data: `btn:${keys[i+1]}` });
    rows.push(row);
  }
  return rows;
}

// ─── ADMIN PANEL (inside Telegram) ───────────────────────────
async function adminMenu(chatId, msgId = null) {
  const buttons  = await getButtons();
  const channels = await getChannels();
  const users    = await getUsers();
  const text = `🛠 <b>لوحة تحكم الأدمن</b>\n\n👤 المستخدمون: <b>${users.length}</b>\n🔘 الأزرار: <b>${Object.keys(buttons).length}</b>\n📢 القنوات: <b>${channels.length}</b>`;
  const kb = [
    [{ text: "➕ إضافة زر",    callback_data: "adm:addbutton"  }, { text: "🗑 حذف زر",    callback_data: "adm:delbutton"  }],
    [{ text: "📋 الأزرار",      callback_data: "adm:listbuttons"}, { text: "🔗 روابط الأزرار", callback_data: "adm:links"   }],
    [{ text: "📢 إضافة قناة",   callback_data: "adm:addchannel" }, { text: "🗑 حذف قناة",  callback_data: "adm:delchannel" }],
    [{ text: "👋 رسالة الترحيب", callback_data: "adm:welcome"   }, { text: "📤 بث رسالة",  callback_data: "adm:broadcast"  }],
    [{ text: "📊 إحصائيات",     callback_data: "adm:stats"      }]
  ];
  if (msgId) await editMsg(chatId, msgId, text, kb);
  else       await send(chatId, text, kb);
}

async function showButtonLinks(chatId, msgId) {
  const buttons = await getButtons();
  const me = await tg("getMe");
  const u = me.result?.username;
  const keys = Object.keys(buttons);
  if (!keys.length) {
    await editMsg(chatId, msgId, "📭 لا توجد أزرار حتى الآن.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
    return;
  }
  let text = "🔗 <b>روابط الأزرار المباشرة:</b>\n\n";
  for (const k of keys) {
    text += `🔘 <b>${buttons[k].label}</b>\n<code>https://t.me/${u}?start=btn_${k}</code>\n\n`;
  }
  await editMsg(chatId, msgId, text, [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
}

async function showButtonsList(chatId, msgId) {
  const buttons = await getButtons();
  const me = await tg("getMe");
  const u = me.result?.username;
  const keys = Object.keys(buttons);
  if (!keys.length) {
    await editMsg(chatId, msgId, "📭 لا توجد أزرار حتى الآن.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
    return;
  }
  let text = "📋 <b>الأزرار الموجودة:</b>\n\n";
  for (const k of keys) {
    const b = buttons[k];
    text += `🔘 <b>${b.label}</b>\n   النوع: ${b.type} | المفتاح: <code>${k}</code>\n   🔗 https://t.me/${u}?start=btn_${k}\n\n`;
  }
  await editMsg(chatId, msgId, text, [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
}

async function showDeleteButtons(chatId, msgId) {
  const buttons = await getButtons();
  const keys = Object.keys(buttons);
  if (!keys.length) {
    await editMsg(chatId, msgId, "📭 لا توجد أزرار للحذف.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
    return;
  }
  const kb = keys.map(k => ([{ text: `🗑 ${buttons[k].label}`, callback_data: `adm:confirmdelete:${k}` }]));
  kb.push([{ text: "↩️ رجوع", callback_data: "adm:back" }]);
  await editMsg(chatId, msgId, "اختر الزر الذي تريد حذفه:", kb);
}

async function showDeleteChannels(chatId, msgId) {
  const channels = await getChannels();
  if (!channels.length) {
    await editMsg(chatId, msgId, "📭 لا توجد قنوات.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
    return;
  }
  const kb = channels.map(c => ([{ text: `🗑 ${c}`, callback_data: `adm:confirmdelch:${c}` }]));
  kb.push([{ text: "↩️ رجوع", callback_data: "adm:back" }]);
  await editMsg(chatId, msgId, "اختر القناة التي تريد إزالتها:", kb);
}

// ─── Handle /start ────────────────────────────────────────────
async function handleStart(msg, payload) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  await addUser(userId);

  if (isAdmin(userId) && !payload) {
    await clearState(userId);
    const info = await getBotInfo();
    const buttons = await getButtons();
    const kb = buildMenu(buttons);
    const admBtn = [[{ text: "🛠 لوحة التحكم", callback_data: "adm:open" }]];
    await send(chatId, info.welcome, kb ? [...kb, ...admBtn] : admBtn);
    return;
  }

  const pending = await checkSubscription(userId);
  if (pending.length) { await sendSubPrompt(chatId, pending, payload || ""); return; }

  if (payload && payload.startsWith("btn_")) {
    const key = payload.substring(4);
    const buttons = await getButtons();
    if (buttons[key]) { await sendContent(chatId, buttons[key]); return; }
  }

  const info = await getBotInfo();
  const buttons = await getButtons();
  const kb = buildMenu(buttons);
  if (isAdmin(userId)) {
    const admBtn = [[{ text: "🛠 لوحة التحكم", callback_data: "adm:open" }]];
    await send(chatId, info.welcome, kb ? [...kb, ...admBtn] : admBtn);
  } else {
    await send(chatId, info.welcome, kb);
  }
}

// ─── Handle admin callback actions ───────────────────────────
async function handleAdminCallback(chatId, userId, msgId, data) {
  if (!isAdmin(userId)) return;

  // رجوع للقائمة الرئيسية
  if (data === "adm:open" || data === "adm:back") {
    await clearState(userId);
    await adminMenu(chatId, msgId);
    return;
  }

  // إضافة زر — خطوة 1
  if (data === "adm:addbutton") {
    await setState(userId, { step: "add_label" });
    await editMsg(chatId, msgId, "🔘 <b>إضافة زر جديد</b>\n\nأرسل <b>اسم الزر</b> كما سيظهر للمستخدم:", [[{ text: "❌ إلغاء", callback_data: "adm:back" }]]);
    return;
  }

  // قائمة الأزرار
  if (data === "adm:listbuttons") { await showButtonsList(chatId, msgId); return; }

  // روابط الأزرار
  if (data === "adm:links") { await showButtonLinks(chatId, msgId); return; }

  // حذف زر
  if (data === "adm:delbutton") { await showDeleteButtons(chatId, msgId); return; }

  // تأكيد حذف زر
  if (data.startsWith("adm:confirmdelete:")) {
    const key = data.split(":")[2];
    const buttons = await getButtons();
    const label = buttons[key]?.label || key;
    delete buttons[key];
    await setButtons(buttons);
    await editMsg(chatId, msgId, `✅ تم حذف الزر "<b>${label}</b>" بنجاح.`, [[{ text: "↩️ رجوع للقائمة", callback_data: "adm:back" }]]);
    return;
  }

  // إضافة قناة
  if (data === "adm:addchannel") {
    await setState(userId, { step: "add_channel" });
    await editMsg(chatId, msgId, "📢 أرسل <b>معرّف القناة</b> (مثال: @mychannel)\n\n⚠️ تأكد أن البوت مشرف في القناة أولاً:", [[{ text: "❌ إلغاء", callback_data: "adm:back" }]]);
    return;
  }

  // حذف قناة
  if (data === "adm:delchannel") { await showDeleteChannels(chatId, msgId); return; }

  // تأكيد حذف قناة
  if (data.startsWith("adm:confirmdelch:")) {
    const ch = data.substring("adm:confirmdelch:".length);
    let channels = await getChannels();
    channels = channels.filter(c => c !== ch);
    await setChannels(channels);
    await editMsg(chatId, msgId, `✅ تمت إزالة القناة <b>${ch}</b>.`, [[{ text: "↩️ رجوع للقائمة", callback_data: "adm:back" }]]);
    return;
  }

  // رسالة الترحيب
  if (data === "adm:welcome") {
    const info = await getBotInfo();
    await setState(userId, { step: "set_welcome" });
    await editMsg(chatId, msgId,
      `👋 <b>رسالة الترحيب الحالية:</b>\n\n${info.welcome}\n\n<i>أرسل الرسالة الجديدة:</i>`,
      [[{ text: "❌ إلغاء", callback_data: "adm:back" }]]
    );
    return;
  }

  // بث رسالة
  if (data === "adm:broadcast") {
    await setState(userId, { step: "broadcast" });
    await editMsg(chatId, msgId, "📤 <b>بث رسالة</b>\n\nأرسل الرسالة التي تريد إرسالها لجميع المستخدمين:", [[{ text: "❌ إلغاء", callback_data: "adm:back" }]]);
    return;
  }

  // إحصائيات
  if (data === "adm:stats") {
    const users = await getUsers();
    const buttons = await getButtons();
    const channels = await getChannels();
    await editMsg(chatId, msgId,
      `📊 <b>إحصائيات البوت</b>\n\n👤 إجمالي المستخدمين: <b>${users.length}</b>\n🔘 عدد الأزرار: <b>${Object.keys(buttons).length}</b>\n📢 قنوات الاشتراك: <b>${channels.length}</b>`,
      [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]
    );
    return;
  }

  // اختيار نوع المحتوى عند إضافة زر
  if (data.startsWith("adm:type:")) {
    const type = data.split(":")[2];
    const state = await getState(userId);
    if (!state) return;
    state.type = type;
    state.step = "add_content";
    await setState(userId, state);
    const hints = { text:"أرسل النص (يدعم HTML)", photo:"أرسل رابط الصورة أو أرسل الصورة مباشرة", video:"أرسل رابط الفيديو أو أرسل الفيديو مباشرة", audio:"أرسل رابط الصوت أو أرسل الصوت مباشرة", document:"أرسل رابط الملف أو أرسل الملف مباشرة", animation:"أرسل رابط الـ GIF أو أرسل الـ GIF مباشرة" };
    await editMsg(chatId, msgId, `✅ النوع: <b>${type}</b>\n\n📎 <b>أرسل المحتوى:</b>\n${hints[type]}`, [[{ text: "❌ إلغاء", callback_data: "adm:back" }]]);
  }
}

// ─── Handle admin states (text input) ────────────────────────
async function handleAdminState(msg, state) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = msg.text || "";

  // خطوة 1: اسم الزر
  if (state.step === "add_label") {
    state.label = text.trim();
    state.step = "add_type";
    await setState(userId, state);
    const kb = [
      [{ text: "📝 نص",    callback_data: "adm:type:text"      }, { text: "🖼 صورة",  callback_data: "adm:type:photo"    }],
      [{ text: "🎬 فيديو", callback_data: "adm:type:video"     }, { text: "🎵 صوت",   callback_data: "adm:type:audio"    }],
      [{ text: "📁 ملف",   callback_data: "adm:type:document"  }, { text: "🎞 GIF",   callback_data: "adm:type:animation"}],
      [{ text: "❌ إلغاء", callback_data: "adm:back" }]
    ];
    await send(chatId, `✅ اسم الزر: <b>${state.label}</b>\n\nاختر <b>نوع المحتوى</b>:`, kb);
    return;
  }

  // خطوة 3: المحتوى (نص أو file_id)
  if (state.step === "add_content") {
    let content = text.trim();
    // إذا أرسل الأدمن ميديا مباشرة، نأخذ file_id
    if (!content) {
      if (msg.photo)     content = msg.photo[msg.photo.length - 1].file_id;
      else if (msg.video)     content = msg.video.file_id;
      else if (msg.audio)     content = msg.audio.file_id;
      else if (msg.document)  content = msg.document.file_id;
      else if (msg.animation) content = msg.animation.file_id;
    }
    if (!content) { await send(chatId, "❌ لم أتمكن من قراءة المحتوى، حاول مرة أخرى."); return; }

    state.content = content;

    // إذا النوع نص، احفظ مباشرة
    if (state.type === "text") {
      await saveButton(chatId, userId, state, "");
    } else {
      state.step = "add_caption";
      await setState(userId, state);
      await send(chatId, "📝 أرسل <b>تعليقاً</b> للصورة/الفيديو (أو أرسل <code>-</code> لتخطي):", [[{ text: "⏭ تخطي", callback_data: "adm:type:skip_caption" }]]);
    }
    return;
  }

  // خطوة 4: التعليق
  if (state.step === "add_caption") {
    const caption = text === "-" ? "" : text.trim();
    await saveButton(chatId, userId, state, caption);
    return;
  }

  // تغيير رسالة الترحيب
  if (state.step === "set_welcome") {
    const info = await getBotInfo();
    info.welcome = text.trim();
    await setBotInfo(info);
    await clearState(userId);
    await send(chatId, "✅ تم تحديث رسالة الترحيب.", [[{ text: "↩️ رجوع للقائمة", callback_data: "adm:open" }]]);
    return;
  }

  // بث رسالة
  if (state.step === "broadcast") {
    await clearState(userId);
    const users = await getUsers();
    await send(chatId, `📤 جاري الإرسال لـ ${users.length} مستخدم...`);
    let ok = 0, fail = 0;
    for (const uid of users) {
      try { const r = await tg("sendMessage", { chat_id: uid, text, parse_mode: "HTML" }); r.ok ? ok++ : fail++; }
      catch { fail++; }
      await new Promise(r => setTimeout(r, 50));
    }
    await send(chatId, `✅ <b>اكتمل الإرسال</b>\n\n✔️ نجح: ${ok}\n❌ فشل: ${fail}`, [[{ text: "↩️ رجوع للقائمة", callback_data: "adm:open" }]]);
    return;
  }

  // إضافة قناة
  if (state.step === "add_channel") {
    let ch = text.trim();
    if (!ch.startsWith("@")) ch = "@" + ch;
    const channels = await getChannels();
    if (channels.includes(ch)) {
      await send(chatId, "⚠️ هذه القناة مضافة مسبقاً.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
    } else {
      channels.push(ch);
      await setChannels(channels);
      await clearState(userId);
      await send(chatId, `✅ تمت إضافة القناة <b>${ch}</b>.`, [[{ text: "↩️ رجوع للقائمة", callback_data: "adm:open" }]]);
    }
    return;
  }
}

async function saveButton(chatId, userId, state, caption) {
  const key = slugify(state.label);
  const buttons = await getButtons();
  buttons[key] = { label: state.label, type: state.type, content: state.content, caption, createdAt: Date.now() };
  await setButtons(buttons);
  await clearState(userId);
  const me = await tg("getMe");
  const link = `https://t.me/${me.result.username}?start=btn_${key}`;
  await send(chatId,
    `✅ <b>تم إضافة الزر بنجاح!</b>\n\n🔘 الاسم: <b>${state.label}</b>\n📎 النوع: ${state.type}\n\n🔗 <b>الرابط المباشر للزر:</b>\n<code>${link}</code>`,
    [[{ text: "↩️ رجوع للقائمة", callback_data: "adm:open" }]]
  );
}

// ─── Handle callback queries ──────────────────────────────────
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const msgId  = query.message.message_id;
  const data   = query.data || "";

  await tg("answerCallbackQuery", { callback_query_id: query.id });

  // Admin panel callbacks
  if (data.startsWith("adm:")) {
    if (!isAdmin(userId)) { await tg("answerCallbackQuery", { callback_query_id: query.id, text: "❌ ليس لديك صلاحية" }); return; }
    // تخطي التعليق
    if (data === "adm:type:skip_caption") {
      const state = await getState(userId);
      if (state?.step === "add_caption") await saveButton(chatId, userId, state, "");
      return;
    }
    await handleAdminCallback(chatId, userId, msgId, data);
    return;
  }

  // إعادة التحقق من الاشتراك
  if (data.startsWith("recheck:")) {
    const payload = data.substring(8);
    const pending = await checkSubscription(userId);
    if (pending.length) { await sendSubPrompt(chatId, pending, payload); return; }
    if (payload.startsWith("btn_")) {
      const key = payload.substring(4);
      const buttons = await getButtons();
      if (buttons[key]) { await sendContent(chatId, buttons[key]); return; }
    }
    const info = await getBotInfo();
    const buttons = await getButtons();
    const kb = buildMenu(buttons);
    await send(chatId, info.welcome, kb);
    return;
  }

  // ضغط زر من القائمة
  if (data.startsWith("btn:")) {
    const key = data.substring(4);
    const pending = await checkSubscription(userId);
    if (pending.length) { await sendSubPrompt(chatId, pending, `btn_${key}`); return; }
    const buttons = await getButtons();
    if (buttons[key]) await sendContent(chatId, buttons[key]);
    else await send(chatId, "❌ هذا الزر لم يعد متاحاً.");
  }
}

// ─── Admin web panel HTML ─────────────────────────────────────
function loginHTML(error = false) {
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>دخول</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f23;color:#e0e0e0;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#1e1e3a;border:1px solid #333;border-radius:16px;padding:40px;width:320px;text-align:center}
h2{color:#7986cb;margin-bottom:20px}input{width:100%;padding:10px;background:#13132b;border:1px solid #444;border-radius:8px;color:#e0e0e0;margin-bottom:12px}
button{width:100%;padding:11px;background:#3f51b5;color:#fff;border:none;border-radius:8px;cursor:pointer}
.err{color:#ef9a9a;font-size:.85rem;margin-bottom:10px}</style></head><body>
<div class="box"><div style="font-size:2.5rem;margin-bottom:12px">🤖</div><h2>لوحة تحكم البوت</h2>
<form method="POST">${error?'<p class="err">❌ كلمة المرور خاطئة</p>':''}<input type="password" name="password" placeholder="كلمة المرور" autofocus required><button>دخول</button></form></div></body></html>`;
}

async function adminWebHTML(botUsername) {
  const [buttons, channels, users, info] = await Promise.all([getButtons(), getChannels(), getUsers(), getBotInfo()]);
  const btnRows = Object.entries(buttons).map(([k, b]) => `<tr><td><b>${b.label}</b><br><small style="color:#888">${k}</small></td><td>${b.type}</td><td><code style="font-size:.75rem">https://t.me/${botUsername}?start=btn_${k}</code></td><td><form method="POST" style="display:inline"><input type="hidden" name="action" value="removebutton"><input type="hidden" name="key" value="${k}"><button class="dbtn" onclick="return confirm('حذف?')">🗑</button></form></td></tr>`).join("");
  const chRows  = channels.map(c => `<tr><td>${c}</td><td><form method="POST" style="display:inline"><input type="hidden" name="action" value="removechannel"><input type="hidden" name="channel" value="${c}"><button class="dbtn" onclick="return confirm('إزالة?')">🗑</button></form></td></tr>`).join("");
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>لوحة التحكم</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f23;color:#e0e0e0;font-family:'Segoe UI',sans-serif}
.hdr{background:linear-gradient(135deg,#1a1a3e,#0d47a1);padding:16px 24px;display:flex;align-items:center;gap:12px}
.hdr h1{font-size:1.2rem;color:#fff;flex:1}.logout{color:#ef9a9a;font-size:.85rem;text-decoration:none}
.stats{display:flex;gap:12px;padding:16px 24px;flex-wrap:wrap}
.stat{background:#1e1e3a;border:1px solid #333;border-radius:10px;padding:12px 18px;flex:1;min-width:100px;text-align:center}
.stat .n{font-size:1.8rem;font-weight:bold;color:#5c6bc0}.stat .l{font-size:.8rem;color:#999;margin-top:2px}
.container{padding:0 24px 24px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:600px){.container{grid-template-columns:1fr}}
.card{background:#1e1e3a;border:1px solid #333;border-radius:12px;padding:18px}
.card h2{font-size:1rem;color:#7986cb;border-bottom:1px solid #333;padding-bottom:8px;margin-bottom:14px}
label{display:block;font-size:.82rem;color:#aaa;margin-bottom:3px}
input,select,textarea{width:100%;padding:8px 10px;background:#13132b;border:1px solid #444;border-radius:7px;color:#e0e0e0;font-size:.88rem;font-family:inherit;margin-bottom:10px}
textarea{resize:vertical;min-height:60px}
.btn{padding:8px 16px;border:none;border-radius:7px;cursor:pointer;font-size:.88rem;font-weight:600;width:100%}
.btn.p{background:#3f51b5;color:#fff}.btn.p:hover{background:#5c6bc0}
.dbtn{background:#c62828;color:#fff;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:.8rem}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th,td{padding:7px 8px;border-bottom:1px solid #333;text-align:right}
th{color:#7986cb}.full{grid-column:1/-1}
.alert{padding:9px 14px;border-radius:7px;margin:0 24px 12px;font-size:.88rem}
.alert.e{background:#c62828}.alert.s{background:#2e7d32}</style></head><body>
<div class="hdr"><div>🤖</div><h1>لوحة تحكم البوت <span style="font-size:.8rem;opacity:.7">@${botUsername}</span></h1><a href="/admin?logout=1" class="logout">خروج</a></div>
<div class="stats">
  <div class="stat"><div class="n">${Object.keys(buttons).length}</div><div class="l">الأزرار</div></div>
  <div class="stat"><div class="n">${channels.length}</div><div class="l">القنوات</div></div>
  <div class="stat"><div class="n">${users.length}</div><div class="l">المستخدمون</div></div>
</div>
<div class="container">
  <div class="card"><h2>➕ إضافة زر</h2>
    <form method="POST"><input type="hidden" name="action" value="addbutton">
    <label>اسم الزر</label><input name="label" required>
    <label>النوع</label><select name="type"><option value="text">📝 نص</option><option value="photo">🖼 صورة</option><option value="video">🎬 فيديو</option><option value="audio">🎵 صوت</option><option value="document">📁 ملف</option><option value="animation">🎞 GIF</option></select>
    <label>المحتوى (نص أو رابط)</label><textarea name="content" required></textarea>
    <label>تعليق (للوسائط)</label><input name="caption">
    <button class="btn p">➕ إضافة</button></form></div>
  <div class="card"><h2>👋 رسالة الترحيب</h2>
    <form method="POST"><input type="hidden" name="action" value="setwelcome">
    <textarea name="welcome" rows="4">${info.welcome}</textarea>
    <button class="btn p">💾 حفظ</button></form>
    <br><h2>📢 إضافة قناة</h2>
    <form method="POST"><input type="hidden" name="action" value="addchannel">
    <input name="channel" placeholder="@channel">
    <button class="btn p">➕ إضافة</button></form></div>
  <div class="card full"><h2>🔘 الأزرار</h2>
    ${btnRows ? `<div style="overflow-x:auto"><table><thead><tr><th>الزر</th><th>النوع</th><th>الرابط المباشر</th><th>حذف</th></tr></thead><tbody>${btnRows}</tbody></table></div>` : '<p style="color:#888;text-align:center;padding:20px">لا توجد أزرار</p>'}</div>
  ${chRows ? `<div class="card full"><h2>📢 القنوات</h2><table><thead><tr><th>القناة</th><th>إزالة</th></tr></thead><tbody>${chRows}</tbody></table></div>` : ""}
  <div class="card full"><h2>📤 بث رسالة (${users.length} مستخدم)</h2>
    <form method="POST"><input type="hidden" name="action" value="broadcast">
    <textarea name="message" rows="3" placeholder="اكتب رسالتك..."></textarea>
    <button class="btn p" onclick="return confirm('إرسال للجميع؟')">📤 إرسال</button></form></div>
</div></body></html>`;
}

// ─── Main handler ─────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const url  = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname;

  // تفعيل الويب هوك
  if (url.searchParams.get("setup") === "1") {
    const webhookUrl = `https://${req.headers.host}/api/bot`;
    const r = await tg("setWebhook", { url: webhookUrl, allowed_updates: ["message","callback_query"] });
    res.status(200).json({ ok: r.ok, webhook: webhookUrl });
    return;
  }

  // لوحة التحكم الويب
  if (path === "/admin" || path === "/admin/") {
    const getCookie = name => { const m = (req.headers.cookie || "").match(new RegExp(`(?:^|; )${name}=([^;]*)`)); return m ? decodeURIComponent(m[1]) : null; };
    if (url.searchParams.get("logout") === "1") {
      res.setHeader("Set-Cookie", "admin_session=; Max-Age=0; Path=/");
      res.setHeader("Location", "/admin"); res.status(302).end(); return;
    }
    const loggedIn = getCookie("admin_session") === ADMIN_PASS;
    if (!loggedIn) {
      if (req.method === "POST") {
        let body = ""; for await (const c of req) body += c;
        const p = new URLSearchParams(body);
        if (p.get("password") === ADMIN_PASS) {
          res.setHeader("Set-Cookie", `admin_session=${ADMIN_PASS}; Max-Age=86400; Path=/; HttpOnly`);
          res.setHeader("Location", "/admin"); res.status(302).end(); return;
        }
        res.status(200).send(loginHTML(true)); return;
      }
      res.status(200).send(loginHTML()); return;
    }
    if (req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      const p = new URLSearchParams(body);
      const action = p.get("action");
      if (action === "addbutton") {
        const label = p.get("label")?.trim(), type = p.get("type"), content = p.get("content")?.trim(), caption = p.get("caption")?.trim() || "";
        if (label && content) { const buttons = await getButtons(); buttons[slugify(label)] = { label, type, content, caption, createdAt: Date.now() }; await setButtons(buttons); }
      } else if (action === "removebutton") {
        const buttons = await getButtons(); delete buttons[p.get("key")]; await setButtons(buttons);
      } else if (action === "addchannel") {
        let ch = p.get("channel")?.trim() || ""; if (!ch.startsWith("@")) ch = "@" + ch;
        const channels = await getChannels(); if (!channels.includes(ch)) { channels.push(ch); await setChannels(channels); }
      } else if (action === "removechannel") {
        let channels = await getChannels(); await setChannels(channels.filter(c => c !== p.get("channel")));
      } else if (action === "setwelcome") {
        const info = await getBotInfo(); info.welcome = p.get("welcome")?.trim() || info.welcome; await setBotInfo(info);
      } else if (action === "broadcast") {
        const msg = p.get("message")?.trim();
        if (msg) { const users = await getUsers(); for (const uid of users) { try { await tg("sendMessage", { chat_id: uid, text: msg, parse_mode: "HTML" }); } catch {} await new Promise(r => setTimeout(r, 50)); } }
      }
    }
    const me = await tg("getMe");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(await adminWebHTML(me.result?.username || ""));
    return;
  }

  // Telegram Webhook
  if (req.method === "POST") {
    let body = ""; for await (const c of req) body += c;
    let update; try { update = JSON.parse(body); } catch { res.status(200).end(); return; }

    if (update.message) {
      const msg    = update.message;
      const userId = msg.from?.id;
      const text   = msg.text || "";

      try {
        if (text.startsWith("/start")) {
          await handleStart(msg, text.split(" ")[1] || "");
        } else if (text === "/admin" && isAdmin(userId)) {
          await clearState(userId);
          await adminMenu(msg.chat.id);
        } else if (isAdmin(userId)) {
          const state = await getState(userId);
          if (state) {
            await handleAdminState(msg, state);
          } else {
            // أدمن بدون حالة — أظهر قائمة التحكم
            await adminMenu(msg.chat.id);
          }
        } else {
          // مستخدم عادي
          const pending = await checkSubscription(userId);
          if (pending.length) { await sendSubPrompt(msg.chat.id, pending, ""); }
          else {
            await addUser(userId);
            const info    = await getBotInfo();
            const buttons = await getButtons();
            await send(msg.chat.id, info.welcome, buildMenu(buttons));
          }
        }
      } catch (e) {
        console.error("msg handler error:", e);
        if (isAdmin(userId)) {
          await send(msg.chat.id, `⚠️ حدث خطأ: ${e.message}`, [[{ text: "↩️ القائمة الرئيسية", callback_data: "adm:open" }]]).catch(() => {});
        }
      }
    } else if (update.callback_query) {
      try {
        await handleCallback(update.callback_query);
      } catch (e) {
        console.error("callback handler error:", e);
      }
    }

    res.status(200).end();
    return;
  }

  res.status(200).send("Bot is running ✅");
};
