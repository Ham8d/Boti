// bot.js — Telegram Button Bot | Vercel + JSONBin.io (no Upstash)

const BOT_TOKEN  = process.env.BOT_TOKEN  || "8477156849:AAEcwk7nhNJtn5tAPfxQ3L_3NDcrN8b_-zU";
const ADMIN_ID   = parseInt(process.env.ADMIN_ID  || "1651487511");
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";
const API        = "https://api.telegram.org/bot" + BOT_TOKEN;

// ─── JSONBin.io Storage ───────────────────────────────────────
const JBKEY = process.env.JSONBIN_KEY || "";
const JBID  = process.env.JSONBIN_ID  || "";
const JBURL = "https://api.jsonbin.io/v3/b";

const DEFAULT_DATA = {
  btns:  {},
  chs:   [],
  users: [],
  info:  { welcome: "أهلاً بك! 👋\nاختر من القائمة:" }
};

let MEM_DATA = null; // cache per warm instance

async function getAll() {
  if (MEM_DATA) return MEM_DATA;
  if (!JBKEY || !JBID) return JSON.parse(JSON.stringify(DEFAULT_DATA));
  try {
    const r = await fetch(JBURL + "/" + JBID + "/latest", {
      headers: { "X-Master-Key": JBKEY, "X-Bin-Meta": "false" }
    });
    const j = await r.json();
    MEM_DATA = Object.assign({}, DEFAULT_DATA, j);
    return MEM_DATA;
  } catch(e) {
    console.error("getAll error:", e.message);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

async function setAll(data) {
  MEM_DATA = data;
  if (!JBKEY || !JBID) return;
  try {
    const r = await fetch(JBURL + "/" + JBID, {
      method: "PUT",
      headers: { "X-Master-Key": JBKEY, "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const j = await r.json();
    if (!j.record) console.error("setAll error:", JSON.stringify(j));
  } catch(e) { console.error("setAll error:", e.message); }
}

// ─── Data helpers ─────────────────────────────────────────────
async function getButtons()  { return (await getAll()).btns  || {}; }
async function setButtons(v) { const d = await getAll(); d.btns = v;  await setAll(d); }
async function getChannels() { return (await getAll()).chs   || []; }
async function setChannels(v){ const d = await getAll(); d.chs  = v;  await setAll(d); }
async function getUsers()    { return (await getAll()).users || []; }
async function getBotInfo()  { return (await getAll()).info  || DEFAULT_DATA.info; }
async function setBotInfo(v) { const d = await getAll(); d.info = v;  await setAll(d); }
async function addUser(id) {
  const d = await getAll();
  if (!d.users.includes(id)) { d.users.push(id); await setAll(d); }
}

// ─── State embedded in message text ──────────────────────────
function embedState(prompt, state) {
  return prompt + "\n\n<code>【" + JSON.stringify(state) + "】</code>";
}
function extractState(text) {
  if (!text) return null;
  const m = text.match(/【(\{[\s\S]+?\})】/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────
function makeKey() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
const isAdmin = id => parseInt(id) === ADMIN_ID;

async function tg(method, body) {
  const r = await fetch(API + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return r.json();
}
function send(chatId, text, kb, extra) {
  const body = { chat_id: chatId, text, parse_mode: "HTML", ...extra };
  if (kb) body.reply_markup = { inline_keyboard: kb };
  return tg("sendMessage", body);
}
function forceReply(chatId, text) {
  return tg("sendMessage", {
    chat_id: chatId, text, parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true }
  });
}
function editMsg(chatId, msgId, text, kb) {
  const body = { chat_id: chatId, message_id: msgId, text, parse_mode: "HTML" };
  if (kb) body.reply_markup = { inline_keyboard: kb };
  return tg("editMessageText", body);
}

// ─── Subscription ─────────────────────────────────────────────
async function checkSub(userId) {
  const chs = await getChannels();
  const out = [];
  for (const ch of chs) {
    try {
      const r = await tg("getChatMember", { chat_id: ch, user_id: userId });
      if (!["member","administrator","creator"].includes(r.result && r.result.status)) out.push(ch);
    } catch { out.push(ch); }
  }
  return out;
}
async function sendSubPrompt(chatId, pending, payload) {
  const kb = pending.map(ch => [{ text: "📢 اشترك في " + ch, url: "https://t.me/" + ch.replace("@","") }]);
  kb.push([{ text: "✅ تحققت من الاشتراك", callback_data: "recheck:" + payload }]);
  await send(chatId, "⚠️ يجب الاشتراك في القنوات التالية أولاً:", kb);
}

// ─── Send button content ──────────────────────────────────────
async function sendContent(chatId, btn) {
  const { type, content, caption } = btn;
  const cap = caption || "";
  if (type === "text")       await send(chatId, content);
  else if (type === "photo")     await tg("sendPhoto",    { chat_id: chatId, photo: content,    caption: cap, parse_mode: "HTML" });
  else if (type === "video")     await tg("sendVideo",    { chat_id: chatId, video: content,    caption: cap, parse_mode: "HTML" });
  else if (type === "audio")     await tg("sendAudio",    { chat_id: chatId, audio: content,    caption: cap, parse_mode: "HTML" });
  else if (type === "document")  await tg("sendDocument", { chat_id: chatId, document: content, caption: cap, parse_mode: "HTML" });
  else if (type === "animation") await tg("sendAnimation",{ chat_id: chatId, animation: content,caption: cap, parse_mode: "HTML" });
}

// ─── User menu ────────────────────────────────────────────────
function buildMenu(buttons) {
  const keys = Object.keys(buttons);
  if (!keys.length) return null;
  const rows = [];
  for (let i = 0; i < keys.length; i += 2) {
    const row = [{ text: buttons[keys[i]].label, callback_data: "btn:" + keys[i] }];
    if (keys[i+1]) row.push({ text: buttons[keys[i+1]].label, callback_data: "btn:" + keys[i+1] });
    rows.push(row);
  }
  return rows;
}

// ─── Admin menu ───────────────────────────────────────────────
async function adminMenu(chatId, msgId) {
  const [buttons, chs, users] = await Promise.all([getButtons(), getChannels(), getUsers()]);
  const text = "🛠 <b>لوحة تحكم الأدمن</b>\n\n" +
    "👤 المستخدمون: <b>" + users.length + "</b>\n" +
    "🔘 الأزرار: <b>" + Object.keys(buttons).length + "</b>\n" +
    "📢 القنوات: <b>" + chs.length + "</b>";
  const kb = [
    [{ text: "➕ إضافة زر",       callback_data: "adm:add"     }, { text: "🗑 حذف زر",       callback_data: "adm:del"     }],
    [{ text: "📋 الأزرار",         callback_data: "adm:list"    }, { text: "🔗 روابط الأزرار", callback_data: "adm:links"   }],
    [{ text: "📢 إضافة قناة",      callback_data: "adm:addch"   }, { text: "🗑 حذف قناة",      callback_data: "adm:delch"   }],
    [{ text: "👋 رسالة الترحيب",   callback_data: "adm:welcome" }, { text: "📤 بث رسالة",      callback_data: "adm:bcast"   }],
    [{ text: "📊 إحصائيات",        callback_data: "adm:stats"   }]
  ];
  if (msgId) {
    await editMsg(chatId, msgId, text, kb).catch(() => send(chatId, text, kb));
  } else {
    await send(chatId, text, kb);
  }
}

// ─── Handle /start ────────────────────────────────────────────
async function handleStart(msg, payload) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  await addUser(userId);

  const pending = await checkSub(userId);
  if (pending.length) { await sendSubPrompt(chatId, pending, payload); return; }

  if (payload && payload.startsWith("btn_")) {
    const key = payload.slice(4);
    const btns = await getButtons();
    if (btns[key]) { await sendContent(chatId, btns[key]); return; }
  }

  const info = await getBotInfo();
  const btns = await getButtons();
  const kb = buildMenu(btns) || [];
  if (isAdmin(userId)) kb.push([{ text: "🛠 لوحة التحكم", callback_data: "adm:open" }]);
  await send(chatId, info.welcome, kb.length ? kb : null);
}

// ─── Admin reply handler ───────────────────────────────────────
async function handleAdminReply(msg, state) {
  const chatId = msg.chat.id;
  const text   = msg.text || "";

  if (state.step === "label") {
    const label = text.trim();
    if (!label) { await send(chatId, "❌ الاسم لا يمكن أن يكون فارغاً. أرسل الاسم مجدداً:"); return; }
    const kb = [
      [{ text: "📝 نص",    callback_data: "adm:t:text:"    + label }, { text: "🖼 صورة",  callback_data: "adm:t:photo:"   + label }],
      [{ text: "🎬 فيديو", callback_data: "adm:t:video:"   + label }, { text: "🎵 صوت",   callback_data: "adm:t:audio:"   + label }],
      [{ text: "📁 ملف",   callback_data: "adm:t:document:"+ label }, { text: "🎞 GIF",   callback_data: "adm:t:animation:"+ label }],
      [{ text: "❌ إلغاء", callback_data: "adm:open" }]
    ];
    await send(chatId, "✅ الاسم: <b>" + label + "</b>\n\nاختر <b>نوع المحتوى</b>:", kb);
    return;
  }

  if (state.step === "content") {
    let content = text.trim();
    if (!content) {
      if (msg.photo)     content = msg.photo[msg.photo.length - 1].file_id;
      if (msg.video)     content = msg.video.file_id;
      if (msg.audio)     content = msg.audio.file_id;
      if (msg.document)  content = msg.document.file_id;
      if (msg.animation) content = msg.animation.file_id;
    }
    if (!content) { await send(chatId, "❌ لم يُتعرف على المحتوى. أعد الإرسال:"); return; }

    if (state.type === "text") {
      await saveButton(chatId, state.label, state.type, content, "");
    } else {
      const capState = { step: "caption", label: state.label, type: state.type, content };
      await forceReply(chatId, embedState(
        "✏️ <b>الخطوة 3/3 — التعليق</b>\n\nاكتب تعليقاً للوسائط أو اكتب <code>-</code> للتخطي:",
        capState
      ));
    }
    return;
  }

  if (state.step === "caption") {
    const caption = text.trim() === "-" ? "" : text.trim();
    await saveButton(chatId, state.label, state.type, state.content, caption);
    return;
  }

  if (state.step === "welcome") {
    const info = await getBotInfo();
    info.welcome = text.trim();
    await setBotInfo(info);
    await send(chatId, "✅ تم تحديث رسالة الترحيب.", [[{ text: "↩️ القائمة", callback_data: "adm:open" }]]);
    return;
  }

  if (state.step === "bcast") {
    const users = await getUsers();
    await send(chatId, "📤 جاري الإرسال لـ " + users.length + " مستخدم...");
    let ok = 0, fail = 0;
    for (const uid of users) {
      try { (await tg("sendMessage", { chat_id: uid, text, parse_mode: "HTML" })).ok ? ok++ : fail++; }
      catch { fail++; }
      await new Promise(r => setTimeout(r, 55));
    }
    await send(chatId, "✅ <b>اكتمل الإرسال</b>\n✔️ نجح: " + ok + " | ❌ فشل: " + fail,
      [[{ text: "↩️ القائمة", callback_data: "adm:open" }]]);
    return;
  }

  if (state.step === "addch") {
    let ch = text.trim();
    if (!ch.startsWith("@")) ch = "@" + ch;
    const chs = await getChannels();
    if (chs.includes(ch)) { await send(chatId, "⚠️ القناة مضافة مسبقاً.", [[{ text: "↩️ القائمة", callback_data: "adm:open" }]]); return; }
    chs.push(ch);
    await setChannels(chs);
    await send(chatId, "✅ تمت إضافة القناة <b>" + ch + "</b>.\n\n⚠️ تأكد أن البوت مشرف في القناة.",
      [[{ text: "↩️ القائمة", callback_data: "adm:open" }]]);
    return;
  }
}

async function saveButton(chatId, label, type, content, caption) {
  const key  = makeKey();
  const btns = await getButtons();
  btns[key]  = { label, type, content, caption, createdAt: Date.now() };
  await setButtons(btns);
  const me   = await tg("getMe");
  const link = "https://t.me/" + me.result.username + "?start=btn_" + key;
  await send(chatId,
    "✅ <b>تم حفظ الزر بنجاح!</b>\n\n" +
    "🔘 الاسم: <b>" + label + "</b>\n" +
    "📎 النوع: " + type + "\n\n" +
    "🔗 <b>الرابط المباشر للزر:</b>\n<code>" + link + "</code>",
    [[{ text: "↩️ القائمة", callback_data: "adm:open" }]]
  );
}

// ─── Callback handler ─────────────────────────────────────────
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const msgId  = query.message.message_id;
  const data   = query.data || "";

  await tg("answerCallbackQuery", { callback_query_id: query.id });

  if (data.startsWith("adm:")) {
    if (!isAdmin(userId)) return;

    if (data === "adm:open" || data === "adm:back") { await adminMenu(chatId, msgId); return; }

    if (data === "adm:add") {
      await forceReply(chatId, embedState(
        "🔘 <b>إضافة زر — الخطوة 1/3</b>\n\nاضغط ↩️ <b>رد (Reply)</b> على هذه الرسالة وأرسل <b>اسم الزر</b>:",
        { step: "label" }
      ));
      return;
    }

    if (data.startsWith("adm:t:")) {
      const parts = data.split(":");
      const type  = parts[2];
      const label = parts.slice(3).join(":");
      const hints = {
        text: "أرسل النص الذي سيظهر (يدعم HTML)",
        photo: "أرسل رابط URL للصورة أو أرسل الصورة مباشرةً",
        video: "أرسل رابط URL للفيديو أو أرسل الفيديو مباشرةً",
        audio: "أرسل رابط URL للصوت أو أرسل الصوت مباشرةً",
        document: "أرسل رابط URL للملف أو أرسل الملف مباشرةً",
        animation: "أرسل رابط URL للـ GIF أو أرسل الـ GIF مباشرةً"
      };
      await forceReply(chatId, embedState(
        "📎 <b>إضافة زر — الخطوة 2/3</b>\n\n" +
        "✅ الاسم: <b>" + label + "</b>\n✅ النوع: <b>" + type + "</b>\n\n" +
        "اضغط ↩️ <b>رد (Reply)</b> وأرسل <b>المحتوى</b>:\n" + hints[type],
        { step: "content", label, type }
      ));
      return;
    }

    if (data === "adm:list") {
      const btns = await getButtons(); const keys = Object.keys(btns);
      if (!keys.length) { await editMsg(chatId, msgId, "📭 لا توجد أزرار.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]); return; }
      let t = "📋 <b>الأزرار:</b>\n\n";
      keys.forEach(k => { t += "🔘 <b>" + btns[k].label + "</b> — " + btns[k].type + "\n"; });
      await editMsg(chatId, msgId, t, [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
      return;
    }

    if (data === "adm:links") {
      const btns = await getButtons(); const me = await tg("getMe"); const u = me.result && me.result.username;
      const keys = Object.keys(btns);
      if (!keys.length) { await editMsg(chatId, msgId, "📭 لا توجد أزرار.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]); return; }
      let t = "🔗 <b>روابط الأزرار المباشرة:</b>\n\n";
      keys.forEach(k => { t += "🔘 <b>" + btns[k].label + "</b>\n<code>https://t.me/" + u + "?start=btn_" + k + "</code>\n\n"; });
      await editMsg(chatId, msgId, t, [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
      return;
    }

    if (data === "adm:del") {
      const btns = await getButtons(); const keys = Object.keys(btns);
      if (!keys.length) { await editMsg(chatId, msgId, "📭 لا توجد أزرار.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]); return; }
      const kb = keys.map(k => [{ text: "🗑 " + btns[k].label, callback_data: "adm:delkey:" + k }]);
      kb.push([{ text: "↩️ رجوع", callback_data: "adm:back" }]);
      await editMsg(chatId, msgId, "اختر الزر للحذف:", kb);
      return;
    }

    if (data.startsWith("adm:delkey:")) {
      const key = data.slice("adm:delkey:".length);
      const btns = await getButtons();
      const label = btns[key] ? btns[key].label : key;
      delete btns[key]; await setButtons(btns);
      await editMsg(chatId, msgId, "✅ تم حذف الزر \"<b>" + label + "</b>\".", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
      return;
    }

    if (data === "adm:addch") {
      await forceReply(chatId, embedState(
        "📢 <b>إضافة قناة اشتراك إجباري</b>\n\nاضغط ↩️ <b>رد</b> وأرسل معرّف القناة (مثال: @mychannel)\n\n⚠️ يجب أن يكون البوت مشرفاً في القناة:",
        { step: "addch" }
      ));
      return;
    }

    if (data === "adm:delch") {
      const chs = await getChannels();
      if (!chs.length) { await editMsg(chatId, msgId, "📭 لا توجد قنوات.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]); return; }
      const kb = chs.map(c => [{ text: "🗑 " + c, callback_data: "adm:delchkey:" + c }]);
      kb.push([{ text: "↩️ رجوع", callback_data: "adm:back" }]);
      await editMsg(chatId, msgId, "اختر القناة للإزالة:", kb);
      return;
    }

    if (data.startsWith("adm:delchkey:")) {
      const ch = data.slice("adm:delchkey:".length);
      await setChannels((await getChannels()).filter(c => c !== ch));
      await editMsg(chatId, msgId, "✅ تمت إزالة القناة <b>" + ch + "</b>.", [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]);
      return;
    }

    if (data === "adm:welcome") {
      const info = await getBotInfo();
      await forceReply(chatId, embedState(
        "👋 <b>تعديل رسالة الترحيب</b>\n\nالحالية:\n<i>" + info.welcome + "</i>\n\nاضغط ↩️ <b>رد</b> وأرسل الرسالة الجديدة:",
        { step: "welcome" }
      ));
      return;
    }

    if (data === "adm:bcast") {
      const users = await getUsers();
      await forceReply(chatId, embedState(
        "📤 <b>بث رسالة</b>\n(" + users.length + " مستخدم)\n\nاضغط ↩️ <b>رد</b> وأرسل الرسالة:",
        { step: "bcast" }
      ));
      return;
    }

    if (data === "adm:stats") {
      const [users, btns, chs] = await Promise.all([getUsers(), getButtons(), getChannels()]);
      await editMsg(chatId, msgId,
        "📊 <b>إحصائيات البوت</b>\n\n" +
        "👤 المستخدمون: <b>" + users.length + "</b>\n" +
        "🔘 الأزرار: <b>" + Object.keys(btns).length + "</b>\n" +
        "📢 القنوات: <b>" + chs.length + "</b>",
        [[{ text: "↩️ رجوع", callback_data: "adm:back" }]]
      );
      return;
    }
    return;
  }

  if (data.startsWith("recheck:")) {
    const payload = data.slice(8);
    const pending = await checkSub(userId);
    if (pending.length) { await sendSubPrompt(chatId, pending, payload); return; }
    if (payload.startsWith("btn_")) {
      const key = payload.slice(4); const btns = await getButtons();
      if (btns[key]) { await sendContent(chatId, btns[key]); return; }
    }
    const info = await getBotInfo(); const btns = await getButtons();
    await send(chatId, info.welcome, buildMenu(btns));
    return;
  }

  if (data.startsWith("btn:")) {
    const key = data.slice(4);
    const pending = await checkSub(userId);
    if (pending.length) { await sendSubPrompt(chatId, pending, "btn_" + key); return; }
    const btns = await getButtons();
    if (btns[key]) await sendContent(chatId, btns[key]);
    else await send(chatId, "❌ هذا الزر لم يعد متاحاً.");
  }
}

// ─── Web admin panel ──────────────────────────────────────────
function loginHTML(err) {
  return "<!DOCTYPE html><html dir='rtl' lang='ar'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>دخول</title>" +
    "<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f23;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}" +
    ".b{background:#1e1e3a;border:1px solid #333;border-radius:16px;padding:40px;width:320px;text-align:center}h2{color:#7986cb;margin-bottom:20px}" +
    "input{width:100%;padding:10px;background:#13132b;border:1px solid #444;border-radius:8px;color:#e0e0e0;margin-bottom:12px}" +
    "button{width:100%;padding:11px;background:#3f51b5;color:#fff;border:none;border-radius:8px;cursor:pointer}" +
    ".e{color:#ef9a9a;font-size:.85rem;margin-bottom:10px}</style></head><body>" +
    "<div class='b'><div style='font-size:2.5rem;margin-bottom:12px'>🤖</div><h2>لوحة تحكم البوت</h2>" +
    "<form method='POST'>" + (err ? "<p class='e'>❌ كلمة المرور خاطئة</p>" : "") +
    "<input type='password' name='password' placeholder='كلمة المرور' autofocus required><button>دخول</button></form></div></body></html>";
}

async function adminWebHTML(u) {
  const [btns, chs, users, info] = await Promise.all([getButtons(), getChannels(), getUsers(), getBotInfo()]);
  const bRows = Object.entries(btns).map(function(e) {
    const k = e[0]; const b = e[1];
    return "<tr><td><b>" + b.label + "</b></td><td>" + b.type + "</td>" +
      "<td><code style='font-size:.72rem'>https://t.me/" + u + "?start=btn_" + k + "</code></td>" +
      "<td><form method='POST' style='display:inline'><input type='hidden' name='action' value='del'><input type='hidden' name='key' value='" + k + "'><button class='db' onclick=\"return confirm('حذف?')\">🗑</button></form></td></tr>";
  }).join("");
  const cRows = chs.map(function(c) {
    return "<tr><td>" + c + "</td><td><form method='POST' style='display:inline'><input type='hidden' name='action' value='delch'><input type='hidden' name='ch' value='" + c + "'><button class='db' onclick=\"return confirm('إزالة?')\">🗑</button></form></td></tr>";
  }).join("");
  const css = "<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f23;color:#e0e0e0;font-family:sans-serif}" +
    ".hdr{background:linear-gradient(135deg,#1a1a3e,#0d47a1);padding:16px 24px;display:flex;align-items:center;gap:12px}.hdr h1{flex:1;color:#fff;font-size:1.1rem}" +
    ".lo{color:#ef9a9a;font-size:.85rem;text-decoration:none}.stats{display:flex;gap:12px;padding:16px 24px;flex-wrap:wrap}" +
    ".st{background:#1e1e3a;border:1px solid #333;border-radius:10px;padding:12px 18px;flex:1;min-width:90px;text-align:center}" +
    ".st .n{font-size:1.8rem;font-weight:bold;color:#5c6bc0}.st .l{font-size:.78rem;color:#999}" +
    ".g{padding:0 24px 24px;display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:600px){.g{grid-template-columns:1fr}}" +
    ".card{background:#1e1e3a;border:1px solid #333;border-radius:12px;padding:18px}" +
    ".card h2{font-size:.92rem;color:#7986cb;border-bottom:1px solid #333;padding-bottom:8px;margin-bottom:12px}" +
    "label{display:block;font-size:.78rem;color:#aaa;margin-bottom:3px}" +
    "input,select,textarea{width:100%;padding:8px 10px;background:#13132b;border:1px solid #444;border-radius:7px;color:#e0e0e0;font-size:.83rem;font-family:inherit;margin-bottom:8px}" +
    "textarea{resize:vertical;min-height:60px}.btn{padding:8px;border:none;border-radius:7px;cursor:pointer;font-size:.83rem;font-weight:600;width:100%;background:#3f51b5;color:#fff}" +
    ".db{background:#c62828;color:#fff;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:.76rem}" +
    "table{width:100%;border-collapse:collapse;font-size:.78rem}th,td{padding:7px 8px;border-bottom:1px solid #333;text-align:right}th{color:#7986cb}.full{grid-column:1/-1}</style>";
  return "<!DOCTYPE html><html dir='rtl' lang='ar'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>لوحة التحكم</title>" + css + "</head><body>" +
    "<div class='hdr'><div>🤖</div><h1>لوحة تحكم البوت @" + u + "</h1><a href='/admin?logout=1' class='lo'>خروج</a></div>" +
    "<div class='stats'><div class='st'><div class='n'>" + Object.keys(btns).length + "</div><div class='l'>الأزرار</div></div>" +
    "<div class='st'><div class='n'>" + chs.length + "</div><div class='l'>القنوات</div></div>" +
    "<div class='st'><div class='n'>" + users.length + "</div><div class='l'>المستخدمون</div></div></div>" +
    "<div class='g'>" +
    "<div class='card'><h2>➕ إضافة زر</h2><form method='POST'><input type='hidden' name='action' value='add'>" +
    "<label>اسم الزر</label><input name='label' required>" +
    "<label>النوع</label><select name='type'><option value='text'>📝 نص</option><option value='photo'>🖼 صورة</option><option value='video'>🎬 فيديو</option><option value='audio'>🎵 صوت</option><option value='document'>📁 ملف</option><option value='animation'>🎞 GIF</option></select>" +
    "<label>المحتوى (نص أو رابط)</label><textarea name='content' required></textarea>" +
    "<label>تعليق (للوسائط - اختياري)</label><input name='caption'>" +
    "<button class='btn'>➕ إضافة الزر</button></form></div>" +
    "<div class='card'><h2>👋 رسالة الترحيب</h2><form method='POST'><input type='hidden' name='action' value='welcome'>" +
    "<textarea name='welcome' rows='3'>" + info.welcome + "</textarea>" +
    "<button class='btn'>💾 حفظ</button></form>" +
    "<br><br><h2>📢 إضافة قناة</h2><form method='POST'><input type='hidden' name='action' value='addch'>" +
    "<input name='ch' placeholder='@channel'><button class='btn'>➕ إضافة</button></form></div>" +
    "<div class='card full'><h2>🔘 الأزرار (" + Object.keys(btns).length + ")</h2>" +
    (bRows ? "<div style='overflow-x:auto'><table><thead><tr><th>الاسم</th><th>النوع</th><th>الرابط المباشر</th><th>حذف</th></tr></thead><tbody>" + bRows + "</tbody></table></div>" : "<p style='color:#888;text-align:center;padding:16px'>لا توجد أزرار بعد</p>") + "</div>" +
    (cRows ? "<div class='card full'><h2>📢 القنوات</h2><table><thead><tr><th>القناة</th><th>إزالة</th></tr></thead><tbody>" + cRows + "</tbody></table></div>" : "") +
    "<div class='card full'><h2>📤 بث رسالة للجميع</h2><form method='POST'><input type='hidden' name='action' value='bcast'>" +
    "<textarea name='msg' rows='3' placeholder='اكتب رسالتك...'></textarea>" +
    "<button class='btn' onclick=\"return confirm('إرسال للجميع؟')\">📤 إرسال للجميع</button></form></div>" +
    "</div></body></html>";
}

// ─── Main Vercel handler ──────────────────────────────────────
module.exports = async function handler(req, res) {
  MEM_DATA = null; // reset cache per request
  const url  = new URL(req.url, "https://" + req.headers.host);
  const path = url.pathname;

  // Setup: create webhook + create JSONBin if needed
  if (url.searchParams.get("setup") === "1") {
    const webhookUrl = "https://" + req.headers.host + "/api/bot";
    const wh = await tg("setWebhook", { url: webhookUrl, allowed_updates: ["message","callback_query"] });

    let binInfo = "";
    if (JBKEY && !JBID) {
      try {
        const r = await fetch(JBURL, {
          method: "POST",
          headers: { "X-Master-Key": JBKEY, "Content-Type": "application/json", "X-Bin-Name": "telegram-bot-data" },
          body: JSON.stringify(DEFAULT_DATA)
        });
        const j = await r.json();
        const newId = j.metadata && j.metadata.id;
        binInfo = newId
          ? "\n\n✅ تم إنشاء JSONBin!\nأضف هذا المتغير في Vercel:\nJSONBIN_ID = " + newId
          : "\n\n❌ فشل إنشاء JSONBin: " + JSON.stringify(j);
      } catch(e) { binInfo = "\n\n❌ خطأ JSONBin: " + e.message; }
    } else if (!JBKEY) {
      binInfo = "\n\n⚠️ أضف JSONBIN_KEY في Vercel أولاً ثم أعد زيارة هذه الصفحة";
    } else {
      binInfo = "\n\n✅ JSONBin مُعدَّل مسبقاً (ID: " + JBID + ")";
    }

    res.status(200).json({ ok: wh.ok, webhook: webhookUrl, storage: binInfo });
    return;
  }

  // Debug page
  if (path === "/debug" || url.searchParams.get("debug") === "1") {
    let storageTest = "لم يُختبر";
    if (JBKEY && JBID) {
      try {
        const d = await getAll();
        storageTest = "✅ يعمل — أزرار: " + Object.keys(d.btns || {}).length + " | مستخدمون: " + (d.users || []).length;
      } catch(e) { storageTest = "❌ خطأ: " + e.message; }
    }
    const html = "<!DOCTYPE html><html dir='rtl'><head><meta charset='UTF-8'><title>تشخيص</title>" +
      "<style>body{font-family:monospace;background:#111;color:#eee;padding:24px}h2{color:#7986cb}.ok{color:#81c784}.err{color:#e57373}.warn{color:#ffb74d}table{border-collapse:collapse;width:100%}td{padding:8px;border-bottom:1px solid #333}</style></head><body>" +
      "<h2>🔧 تشخيص البوت</h2><table>" +
      "<tr><td>BOT_TOKEN</td><td class='" + (process.env.BOT_TOKEN ? "ok'>✅ مُعدَّل" : "warn'>⚠️ افتراضي") + "</td></tr>" +
      "<tr><td>ADMIN_ID</td><td class='ok'>✅ " + ADMIN_ID + "</td></tr>" +
      "<tr><td>JSONBIN_KEY</td><td class='" + (JBKEY ? "ok'>✅ مُعدَّل" : "err'>❌ غير مُعدَّل — الأزرار لن تُحفظ!") + "</td></tr>" +
      "<tr><td>JSONBIN_ID</td><td class='" + (JBID ? "ok'>✅ " + JBID : "err'>❌ غير مُعدَّل — الأزرار لن تُحفظ!") + "</td></tr>" +
      "<tr><td>اختبار التخزين</td><td>" + storageTest + "</td></tr>" +
      "</table>" +
      (!JBKEY || !JBID ? "<div style='margin-top:20px;padding:16px;background:#2a1010;border:1px solid #c62828;border-radius:8px'>" +
        "<b style='color:#ef9a9a'>⚠️ إعداد مطلوب:</b><br><br>" +
        "1. سجّل في <a href='https://jsonbin.io' style='color:#7986cb'>jsonbin.io</a> (مجاني)<br>" +
        "2. أنشئ API Key من صفحة API Keys<br>" +
        "3. أضف <code>JSONBIN_KEY</code> في Vercel → Settings → Environment Variables<br>" +
        "4. افتح <code>/api/bot?setup=1</code> لإنشاء البين تلقائياً<br>" +
        "5. انسخ الـ JSONBIN_ID المعروض وأضفه في Vercel<br>" +
        "6. أعد النشر (Redeploy)" +
        "</div>" : "") +
      "</body></html>";
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.status(200).send(html); return;
  }

  // Web admin
  if (path === "/admin" || path === "/admin/") {
    function gc(name) {
      const m = (req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : null;
    }
    if (url.searchParams.get("logout") === "1") {
      res.setHeader("Set-Cookie","admin_session=; Max-Age=0; Path=/");
      res.setHeader("Location","/admin"); res.status(302).end(); return;
    }
    const loggedIn = gc("admin_session") === ADMIN_PASS;
    if (!loggedIn) {
      if (req.method === "POST") {
        let b = ""; for await (const c of req) b += c;
        const p = new URLSearchParams(b);
        if (p.get("password") === ADMIN_PASS) {
          res.setHeader("Set-Cookie","admin_session=" + ADMIN_PASS + "; Max-Age=86400; Path=/; HttpOnly");
          res.setHeader("Location","/admin"); res.status(302).end(); return;
        }
        res.status(200).send(loginHTML(true)); return;
      }
      res.status(200).send(loginHTML(false)); return;
    }
    if (req.method === "POST") {
      let b = ""; for await (const c of req) b += c;
      const p = new URLSearchParams(b);
      const action = p.get("action");
      if (action === "add") {
        const label = (p.get("label") || "").trim(), type = p.get("type"), content = (p.get("content") || "").trim(), caption = (p.get("caption") || "").trim();
        if (label && content) { const btns = await getButtons(); btns[makeKey()] = { label, type, content, caption, createdAt: Date.now() }; await setButtons(btns); }
      } else if (action === "del") {
        const btns = await getButtons(); delete btns[p.get("key")]; await setButtons(btns);
      } else if (action === "addch") {
        let ch = (p.get("ch") || "").trim(); if (!ch.startsWith("@")) ch = "@" + ch;
        const chs = await getChannels(); if (!chs.includes(ch)) { chs.push(ch); await setChannels(chs); }
      } else if (action === "delch") {
        await setChannels((await getChannels()).filter(c => c !== p.get("ch")));
      } else if (action === "welcome") {
        const info = await getBotInfo(); info.welcome = (p.get("welcome") || "").trim() || info.welcome; await setBotInfo(info);
      } else if (action === "bcast") {
        const msg = (p.get("msg") || "").trim();
        if (msg) { const users = await getUsers(); for (const uid of users) { try { await tg("sendMessage",{chat_id:uid,text:msg,parse_mode:"HTML"}); } catch {} await new Promise(r=>setTimeout(r,55)); } }
      }
    }
    const me = await tg("getMe");
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.status(200).send(await adminWebHTML(me.result && me.result.username || "")); return;
  }

  // Telegram webhook
  if (req.method === "POST") {
    let b = ""; for await (const c of req) b += c;
    let update;
    try { update = JSON.parse(b); } catch { res.status(200).end(); return; }
    try {
      if (update.message) {
        const msg    = update.message;
        const userId = msg.from && msg.from.id;
        const text   = msg.text || "";
        if (text.startsWith("/start")) {
          await handleStart(msg, text.split(" ")[1] || "");
        } else if (text === "/admin" && isAdmin(userId)) {
          await adminMenu(msg.chat.id, null);
        } else if (isAdmin(userId) && msg.reply_to_message) {
          const replyText = (msg.reply_to_message.text || msg.reply_to_message.caption || "");
          const state = extractState(replyText);
          if (state) await handleAdminReply(msg, state);
        } else if (!isAdmin(userId)) {
          const pending = await checkSub(userId);
          if (pending.length) {
            await sendSubPrompt(msg.chat.id, pending, "");
          } else {
            await addUser(userId);
            const info = await getBotInfo();
            const btns = await getButtons();
            await send(msg.chat.id, info.welcome, buildMenu(btns));
          }
        }
      } else if (update.callback_query) {
        await handleCallback(update.callback_query);
      }
    } catch(e) { console.error("Bot error:", e.message); }
    res.status(200).end(); return;
  }

  res.status(200).send("Bot is running ✅");
};
