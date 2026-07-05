// ============================================================
// bot.js — Telegram Button Bot (Single File) | Vercel Deploy
// ============================================================
// Admin ID: 1651487511
// Deploy: push this folder to GitHub → import on vercel.com
// Set env vars in Vercel dashboard:
//   BOT_TOKEN = your telegram bot token
//   ADMIN_ID  = 1651487511
//   ADMIN_PASS = your chosen admin panel password
//   KV_REST_API_URL / KV_REST_API_TOKEN = from Vercel KV dashboard
// ============================================================

const BOT_TOKEN = process.env.BOT_TOKEN || "8477156849:AAEcwk7nhNJtn5tAPfxQ3L_3NDcrN8b_-zU";
const ADMIN_ID  = parseInt(process.env.ADMIN_ID  || "1651487511");
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── KV Storage (Vercel KV / upstash redis) ─────────────────
// Falls back to in-memory if KV not configured (data resets on cold start)
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
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

// ─── Helpers ─────────────────────────────────────────────────
async function getButtons() { return (await kvGet("buttons")) || {}; }
async function setButtons(b) { await kvSet("buttons", b); }
async function getChannels() { return (await kvGet("channels")) || []; }
async function setChannels(c) { await kvSet("channels", c); }
async function getUsers() { return (await kvGet("users")) || []; }
async function addUser(id) {
  const users = await getUsers();
  if (!users.includes(id)) { users.push(id); await kvSet("users", users); }
}
async function getBotInfo() { return (await kvGet("botinfo")) || { welcome: "أهلاً بك! اختر من القائمة:", name: "البوت" }; }
async function setBotInfo(i) { await kvSet("botinfo", i); }

async function tg(method, body = {}) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}

function slugify(str) {
  return str.trim().replace(/\s+/g, "_").replace(/[^\w\u0600-\u06FF]/g, "").substring(0, 30);
}

function isAdmin(id) { return parseInt(id) === ADMIN_ID; }

// ─── Check mandatory channel subscription ────────────────────
async function checkSubscription(userId) {
  const channels = await getChannels();
  const notJoined = [];
  for (const ch of channels) {
    try {
      const r = await tg("getChatMember", { chat_id: ch, user_id: userId });
      const status = r.result?.status;
      if (!["member","administrator","creator"].includes(status)) notJoined.push(ch);
    } catch { notJoined.push(ch); }
  }
  return notJoined;
}

async function sendSubscriptionPrompt(chatId, pending, payload) {
  const keyboard = pending.map(ch => ([{ text: `📢 اشترك في ${ch}`, url: `https://t.me/${ch.replace("@","")}` }]));
  keyboard.push([{ text: "✅ تحققت من الاشتراك", callback_data: `recheck:${payload}` }]);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "⚠️ يجب الاشتراك في القنوات التالية للمتابعة:",
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ─── Send button content ─────────────────────────────────────
async function sendButtonContent(chatId, btn, messageId) {
  const { type, content, caption = "" } = btn;

  if (type === "text") {
    await tg("sendMessage", { chat_id: chatId, text: content, parse_mode: "HTML" });
  } else if (type === "photo") {
    await tg("sendPhoto", { chat_id: chatId, photo: content, caption, parse_mode: "HTML" });
  } else if (type === "video") {
    await tg("sendVideo", { chat_id: chatId, video: content, caption, parse_mode: "HTML" });
  } else if (type === "audio") {
    await tg("sendAudio", { chat_id: chatId, audio: content, caption, parse_mode: "HTML" });
  } else if (type === "document") {
    await tg("sendDocument", { chat_id: chatId, document: content, caption, parse_mode: "HTML" });
  } else if (type === "animation") {
    await tg("sendAnimation", { chat_id: chatId, animation: content, caption, parse_mode: "HTML" });
  }
}

// ─── Build main menu keyboard ────────────────────────────────
function buildMenu(buttons, botUsername) {
  const keys = Object.keys(buttons);
  if (!keys.length) return null;
  const rows = [];
  for (let i = 0; i < keys.length; i += 2) {
    const row = [{ text: buttons[keys[i]].label, callback_data: `btn:${keys[i]}` }];
    if (keys[i+1]) row.push({ text: buttons[keys[i+1]].label, callback_data: `btn:${keys[i+1]}` });
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

// ─── Handle /start ────────────────────────────────────────────
async function handleStart(msg, payload) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  await addUser(userId);

  const pending = await checkSubscription(userId);
  if (pending.length) { await sendSubscriptionPrompt(chatId, pending, payload || ""); return; }

  if (payload && payload.startsWith("btn_")) {
    const key = payload.substring(4);
    const buttons = await getButtons();
    if (buttons[key]) {
      await sendButtonContent(chatId, buttons[key], null);
      return;
    }
  }

  const info = await getBotInfo();
  const buttons = await getButtons();
  const me = await tg("getMe");
  const keyboard = buildMenu(buttons, me.result?.username);
  await tg("sendMessage", {
    chat_id: chatId,
    text: info.welcome,
    parse_mode: "HTML",
    reply_markup: keyboard || undefined
  });
}

// ─── Admin command handler ────────────────────────────────────
async function handleAdminCommand(msg) {
  const chatId = msg.chat.id;
  const text   = msg.text || "";
  const parts  = text.split(/\s+/);
  const cmd    = parts[0].toLowerCase();

  if (!isAdmin(msg.from.id)) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ ليس لديك صلاحية." });
    return;
  }

  // /addbutton label|type|content[|caption]
  if (cmd === "/addbutton") {
    const rest = text.substring(cmd.length).trim();
    const segs = rest.split("|").map(s => s.trim());
    if (segs.length < 3) {
      await tg("sendMessage", { chat_id: chatId,
        text: "📝 الصيغة:\n/addbutton الاسم|النوع|المحتوى|التعليق(اختياري)\n\nالأنواع: text, photo, video, audio, document, animation\n\nمثال:\n/addbutton ترحيب|text|مرحباً بك!\n/addbutton صورتي|photo|https://...|وصف الصورة"
      });
      return;
    }
    const [label, type, content, caption] = segs;
    const validTypes = ["text","photo","video","audio","document","animation"];
    if (!validTypes.includes(type)) {
      await tg("sendMessage", { chat_id: chatId, text: `❌ نوع غير صحيح. الأنواع المتاحة: ${validTypes.join(", ")}` });
      return;
    }
    const key = slugify(label);
    const buttons = await getButtons();
    const me = await tg("getMe");
    buttons[key] = { label, type, content, caption: caption || "", createdAt: Date.now() };
    await setButtons(buttons);
    const link = `https://t.me/${me.result.username}?start=btn_${key}`;
    await tg("sendMessage", {
      chat_id: chatId,
      text: `✅ تم إضافة الزر "<b>${label}</b>"\n\n🔑 المفتاح: <code>${key}</code>\n🔗 الرابط المباشر:\n${link}`,
      parse_mode: "HTML"
    });
    return;
  }

  // /removebutton key
  if (cmd === "/removebutton") {
    const key = parts[1]?.trim();
    if (!key) { await tg("sendMessage", { chat_id: chatId, text: "الصيغة: /removebutton المفتاح" }); return; }
    const buttons = await getButtons();
    if (!buttons[key]) { await tg("sendMessage", { chat_id: chatId, text: "❌ الزر غير موجود." }); return; }
    const label = buttons[key].label;
    delete buttons[key];
    await setButtons(buttons);
    await tg("sendMessage", { chat_id: chatId, text: `✅ تم حذف الزر "${label}"` });
    return;
  }

  // /listbuttons
  if (cmd === "/listbuttons") {
    const buttons = await getButtons();
    const keys = Object.keys(buttons);
    if (!keys.length) { await tg("sendMessage", { chat_id: chatId, text: "📭 لا توجد أزرار حالياً." }); return; }
    const me = await tg("getMe");
    let msg2 = "📋 <b>الأزرار المتاحة:</b>\n\n";
    for (const k of keys) {
      const b = buttons[k];
      msg2 += `🔘 <b>${b.label}</b>\n   النوع: ${b.type}\n   المفتاح: <code>${k}</code>\n   الرابط: https://t.me/${me.result.username}?start=btn_${k}\n\n`;
    }
    await tg("sendMessage", { chat_id: chatId, text: msg2, parse_mode: "HTML" });
    return;
  }

  // /addchannel @channel
  if (cmd === "/addchannel") {
    let ch = parts[1]?.trim();
    if (!ch) { await tg("sendMessage", { chat_id: chatId, text: "الصيغة: /addchannel @قناتك" }); return; }
    if (!ch.startsWith("@")) ch = "@" + ch;
    const channels = await getChannels();
    if (channels.includes(ch)) { await tg("sendMessage", { chat_id: chatId, text: "⚠️ القناة مضافة مسبقاً." }); return; }
    channels.push(ch);
    await setChannels(channels);
    await tg("sendMessage", { chat_id: chatId, text: `✅ تم إضافة القناة ${ch} للاشتراك الإجباري.\n\n⚠️ تأكد أن البوت مشرف في القناة.` });
    return;
  }

  // /removechannel @channel
  if (cmd === "/removechannel") {
    let ch = parts[1]?.trim();
    if (!ch) { await tg("sendMessage", { chat_id: chatId, text: "الصيغة: /removechannel @قناتك" }); return; }
    if (!ch.startsWith("@")) ch = "@" + ch;
    let channels = await getChannels();
    if (!channels.includes(ch)) { await tg("sendMessage", { chat_id: chatId, text: "❌ القناة غير موجودة." }); return; }
    channels = channels.filter(c => c !== ch);
    await setChannels(channels);
    await tg("sendMessage", { chat_id: chatId, text: `✅ تم إزالة القناة ${ch}` });
    return;
  }

  // /listchannels
  if (cmd === "/listchannels") {
    const channels = await getChannels();
    if (!channels.length) { await tg("sendMessage", { chat_id: chatId, text: "📭 لا توجد قنوات اشتراك إجباري." }); return; }
    await tg("sendMessage", { chat_id: chatId, text: `📢 <b>قنوات الاشتراك الإجباري:</b>\n\n${channels.join("\n")}`, parse_mode: "HTML" });
    return;
  }

  // /setwelcome رسالة الترحيب
  if (cmd === "/setwelcome") {
    const welcome = text.substring(cmd.length).trim();
    if (!welcome) { await tg("sendMessage", { chat_id: chatId, text: "الصيغة: /setwelcome نص الرسالة" }); return; }
    const info = await getBotInfo();
    info.welcome = welcome;
    await setBotInfo(info);
    await tg("sendMessage", { chat_id: chatId, text: "✅ تم تعديل رسالة الترحيب." });
    return;
  }

  // /broadcast رسالة
  if (cmd === "/broadcast") {
    const bcastText = text.substring(cmd.length).trim();
    if (!bcastText) { await tg("sendMessage", { chat_id: chatId, text: "الصيغة: /broadcast الرسالة" }); return; }
    const users = await getUsers();
    await tg("sendMessage", { chat_id: chatId, text: `📤 جاري إرسال الرسالة لـ ${users.length} مستخدم...` });
    let ok = 0, fail = 0;
    for (const uid of users) {
      try {
        const res = await tg("sendMessage", { chat_id: uid, text: bcastText, parse_mode: "HTML" });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
      await new Promise(r => setTimeout(r, 50));
    }
    await tg("sendMessage", { chat_id: chatId, text: `✅ تم الإرسال\n✔️ نجح: ${ok}\n❌ فشل: ${fail}` });
    return;
  }

  // /stats
  if (cmd === "/stats") {
    const users = await getUsers();
    const buttons = await getButtons();
    const channels = await getChannels();
    await tg("sendMessage", {
      chat_id: chatId,
      text: `📊 <b>إحصائيات البوت</b>\n\n👤 المستخدمون: ${users.length}\n🔘 الأزرار: ${Object.keys(buttons).length}\n📢 القنوات: ${channels.length}`,
      parse_mode: "HTML"
    });
    return;
  }

  // /help
  if (cmd === "/help" || cmd === "/start") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `🤖 <b>أوامر الأدمن:</b>

<b>الأزرار:</b>
/addbutton الاسم|النوع|المحتوى|التعليق
/removebutton المفتاح
/listbuttons

<b>أنواع المحتوى:</b>
text — نص
photo — صورة (رابط أو file_id)
video — فيديو (رابط أو file_id)
audio — صوت
document — ملف
animation — gif

<b>القنوات:</b>
/addchannel @قناة
/removechannel @قناة
/listchannels

<b>أخرى:</b>
/setwelcome رسالة الترحيب
/broadcast رسالة للجميع
/stats إحصائيات`,
      parse_mode: "HTML"
    });
  }
}

// ─── Handle callback queries ──────────────────────────────────
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data   = query.data || "";

  await tg("answerCallbackQuery", { callback_query_id: query.id });

  if (data.startsWith("recheck:")) {
    const payload = data.substring(8);
    const pending = await checkSubscription(userId);
    if (pending.length) {
      await sendSubscriptionPrompt(chatId, pending, payload);
    } else {
      if (payload && payload.startsWith("btn_")) {
        const key = payload.substring(4);
        const buttons = await getButtons();
        if (buttons[key]) { await sendButtonContent(chatId, buttons[key], null); return; }
      }
      const info = await getBotInfo();
      const buttons = await getButtons();
      const me = await tg("getMe");
      const keyboard = buildMenu(buttons, me.result?.username);
      await tg("sendMessage", {
        chat_id: chatId,
        text: info.welcome,
        parse_mode: "HTML",
        reply_markup: keyboard || undefined
      });
    }
    return;
  }

  if (data.startsWith("btn:")) {
    const key = data.substring(4);
    const pending = await checkSubscription(userId);
    if (pending.length) { await sendSubscriptionPrompt(chatId, pending, `btn_${key}`); return; }
    const buttons = await getButtons();
    if (buttons[key]) {
      await sendButtonContent(chatId, buttons[key], null);
    } else {
      await tg("sendMessage", { chat_id: chatId, text: "❌ الزر غير موجود." });
    }
  }
}

// ─── Admin Web Panel HTML ─────────────────────────────────────
function adminHTML(data) {
  const { buttons = {}, channels = [], users = [], info = {}, botUsername = "", error = "", success = "" } = data;
  const btnRows = Object.entries(buttons).map(([k, b]) => `
    <tr>
      <td><b>${b.label}</b><br><small>${k}</small></td>
      <td>${b.type}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${b.content.substring(0,60)}${b.content.length>60?"…":""}</td>
      <td><a href="https://t.me/${botUsername}?start=btn_${k}" target="_blank">🔗 رابط</a></td>
      <td>
        <form method="POST" style="display:inline">
          <input type="hidden" name="action" value="removebutton">
          <input type="hidden" name="key" value="${k}">
          <button class="btn danger" onclick="return confirm('حذف ${b.label}؟')">🗑 حذف</button>
        </form>
      </td>
    </tr>`).join("");

  const chRows = channels.map(c => `
    <tr>
      <td>${c}</td>
      <td>
        <form method="POST" style="display:inline">
          <input type="hidden" name="action" value="removechannel">
          <input type="hidden" name="channel" value="${c}">
          <button class="btn danger" onclick="return confirm('إزالة ${c}؟')">🗑 إزالة</button>
        </form>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>لوحة تحكم البوت</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #0f0f23; color: #e0e0e0; min-height: 100vh; }
  .header { background: linear-gradient(135deg, #1a1a3e 0%, #0d47a1 100%); padding: 20px 30px; display: flex; align-items: center; gap: 15px; }
  .header h1 { font-size: 1.5rem; color: #fff; }
  .header .badge { background: #4caf50; color: #fff; padding: 3px 10px; border-radius: 20px; font-size: 0.8rem; }
  .stats { display: flex; gap: 15px; padding: 20px 30px; flex-wrap: wrap; }
  .stat { background: #1e1e3a; border: 1px solid #333; border-radius: 12px; padding: 15px 20px; flex: 1; min-width: 120px; text-align: center; }
  .stat .num { font-size: 2rem; font-weight: bold; color: #5c6bc0; }
  .stat .lbl { font-size: 0.85rem; color: #999; margin-top: 4px; }
  .container { padding: 0 30px 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media(max-width: 768px) { .container { grid-template-columns: 1fr; } .stats { flex-direction: column; } }
  .card { background: #1e1e3a; border: 1px solid #333; border-radius: 14px; padding: 20px; }
  .card h2 { font-size: 1.1rem; margin-bottom: 15px; color: #7986cb; border-bottom: 1px solid #333; padding-bottom: 10px; }
  .form-group { margin-bottom: 12px; }
  label { display: block; font-size: 0.85rem; color: #aaa; margin-bottom: 4px; }
  input, select, textarea { width: 100%; padding: 9px 12px; background: #13132b; border: 1px solid #444; border-radius: 8px; color: #e0e0e0; font-size: 0.9rem; font-family: inherit; }
  textarea { resize: vertical; min-height: 70px; }
  .btn { padding: 9px 18px; border: none; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600; transition: 0.2s; }
  .btn.primary { background: #3f51b5; color: #fff; width: 100%; }
  .btn.primary:hover { background: #5c6bc0; }
  .btn.danger { background: #c62828; color: #fff; font-size: 0.8rem; padding: 5px 10px; }
  .btn.danger:hover { background: #e53935; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #333; text-align: right; }
  th { color: #7986cb; font-weight: 600; }
  .alert { padding: 10px 15px; border-radius: 8px; margin: 0 30px 15px; font-size: 0.9rem; }
  .alert.error { background: #c62828; color: #fff; }
  .alert.success { background: #2e7d32; color: #fff; }
  .hint { font-size: 0.78rem; color: #888; margin-top: 4px; }
  .full { grid-column: 1 / -1; }
  .link-box { background: #13132b; border: 1px solid #333; border-radius: 8px; padding: 8px 12px; font-family: monospace; font-size: 0.8rem; color: #81c784; word-break: break-all; }
</style>
</head>
<body>
<div class="header">
  <div>🤖</div>
  <div>
    <h1>لوحة تحكم البوت</h1>
    <div style="font-size:0.8rem;color:#aaa;margin-top:4px">@${botUsername || "..."}</div>
  </div>
  <div class="badge" style="margin-right:auto">مسجل دخول</div>
  <a href="/admin?logout=1" style="color:#ef9a9a;font-size:0.85rem;text-decoration:none">خروج</a>
</div>

<div class="stats">
  <div class="stat"><div class="num">${Object.keys(buttons).length}</div><div class="lbl">الأزرار</div></div>
  <div class="stat"><div class="num">${channels.length}</div><div class="lbl">القنوات</div></div>
  <div class="stat"><div class="num">${users.length}</div><div class="lbl">المستخدمون</div></div>
</div>

${error ? `<div class="alert error">❌ ${error}</div>` : ""}
${success ? `<div class="alert success">✅ ${success}</div>` : ""}

<div class="container">

  <!-- Add Button -->
  <div class="card">
    <h2>➕ إضافة زر جديد</h2>
    <form method="POST">
      <input type="hidden" name="action" value="addbutton">
      <div class="form-group">
        <label>اسم الزر (يظهر للمستخدم)</label>
        <input type="text" name="label" placeholder="مثال: قناتنا" required>
      </div>
      <div class="form-group">
        <label>نوع المحتوى</label>
        <select name="type" id="typeSelect" onchange="updateHint()">
          <option value="text">📝 نص</option>
          <option value="photo">🖼 صورة</option>
          <option value="video">🎬 فيديو</option>
          <option value="audio">🎵 صوت</option>
          <option value="document">📁 ملف</option>
          <option value="animation">🎞 GIF</option>
        </select>
      </div>
      <div class="form-group">
        <label>المحتوى</label>
        <textarea name="content" id="contentField" placeholder="أدخل النص هنا..." required></textarea>
        <div class="hint" id="contentHint">أدخل النص الذي سيظهر عند الضغط على الزر</div>
      </div>
      <div class="form-group" id="captionGroup">
        <label>تعليق (للصور/الفيديوهات)</label>
        <input type="text" name="caption" placeholder="وصف اختياري للوسائط">
      </div>
      <button type="submit" class="btn primary">➕ إضافة الزر</button>
    </form>
  </div>

  <!-- Welcome Message -->
  <div class="card">
    <h2>👋 رسالة الترحيب</h2>
    <form method="POST">
      <input type="hidden" name="action" value="setwelcome">
      <div class="form-group">
        <label>نص رسالة الترحيب</label>
        <textarea name="welcome" rows="5">${info.welcome || ""}</textarea>
        <div class="hint">يدعم HTML: &lt;b&gt;عريض&lt;/b&gt; &lt;i&gt;مائل&lt;/i&gt;</div>
      </div>
      <button type="submit" class="btn primary">💾 حفظ الرسالة</button>
    </form>

    <hr style="border-color:#333;margin:20px 0">

    <h2 style="margin-bottom:15px">📢 إضافة قناة اشتراك إجباري</h2>
    <form method="POST">
      <input type="hidden" name="action" value="addchannel">
      <div class="form-group">
        <label>معرّف القناة</label>
        <input type="text" name="channel" placeholder="@قناتك">
        <div class="hint">تأكد أن البوت مشرف في القناة</div>
      </div>
      <button type="submit" class="btn primary">➕ إضافة القناة</button>
    </form>
  </div>

  <!-- Buttons List -->
  <div class="card full">
    <h2>🔘 قائمة الأزرار</h2>
    ${btnRows ? `<div style="overflow-x:auto"><table>
      <thead><tr><th>الزر</th><th>النوع</th><th>المحتوى</th><th>الرابط</th><th>حذف</th></tr></thead>
      <tbody>${btnRows}</tbody>
    </table></div>` : '<p style="color:#888;text-align:center;padding:20px">لا توجد أزرار حتى الآن</p>'}
  </div>

  <!-- Channels List -->
  ${chRows ? `<div class="card full">
    <h2>📢 قنوات الاشتراك الإجباري</h2>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>القناة</th><th>إزالة</th></tr></thead>
      <tbody>${chRows}</tbody>
    </table></div>
  </div>` : ""}

  <!-- Broadcast -->
  <div class="card full">
    <h2>📤 بث رسالة للمستخدمين (${users.length} مستخدم)</h2>
    <form method="POST">
      <input type="hidden" name="action" value="broadcast">
      <div class="form-group">
        <textarea name="message" rows="3" placeholder="اكتب رسالتك هنا..."></textarea>
      </div>
      <button type="submit" class="btn primary" onclick="return confirm('إرسال للجميع؟')">📤 إرسال للجميع</button>
    </form>
  </div>

  <!-- Bot Setup Info -->
  <div class="card full">
    <h2>⚙️ إعداد الويب هوك</h2>
    <p style="margin-bottom:10px;color:#aaa;font-size:0.9rem">بعد النشر على Vercel، اضغط الرابط التالي مرة واحدة لتفعيل البوت:</p>
    <div class="link-box">https://your-vercel-url.vercel.app/api/bot?setup=1</div>
    <p style="margin-top:10px;color:#aaa;font-size:0.9rem">استبدل "your-vercel-url" بعنوان مشروعك على Vercel</p>
  </div>

</div>

<script>
function updateHint() {
  const t = document.getElementById('typeSelect').value;
  const hints = {
    text: 'أدخل النص الذي سيظهر عند الضغط على الزر (يدعم HTML)',
    photo: 'الصق رابط الصورة أو file_id من تيليغرام',
    video: 'الصق رابط الفيديو أو file_id من تيليغرام',
    audio: 'الصق رابط الصوت أو file_id من تيليغرام',
    document: 'الصق رابط الملف أو file_id من تيليغرام',
    animation: 'الصق رابط الـ GIF أو file_id من تيليغرام',
  };
  const placeholders = {
    text: 'أدخل النص هنا...',
    photo: 'https://example.com/image.jpg',
    video: 'https://example.com/video.mp4',
    audio: 'https://example.com/audio.mp3',
    document: 'https://example.com/file.pdf',
    animation: 'https://example.com/anim.gif',
  };
  document.getElementById('contentHint').textContent = hints[t] || '';
  document.getElementById('contentField').placeholder = placeholders[t] || '';
  document.getElementById('captionGroup').style.display = t === 'text' ? 'none' : '';
}
updateHint();
</script>
</body>
</html>`;
}

// ─── Session helpers (cookie-based) ──────────────────────────
function getCookie(req, name) {
  const h = req.headers.cookie || "";
  const m = h.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// ─── Main Vercel Handler ──────────────────────────────────────
module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname;

  // ── Setup webhook ──
  if (url.searchParams.get("setup") === "1") {
    const webhookUrl = `https://${req.headers.host}/api/bot`;
    const r = await tg("setWebhook", { url: webhookUrl });
    res.status(200).json({ ok: r.ok, webhook: webhookUrl });
    return;
  }

  // ── Admin panel ──
  if (path === "/admin" || path === "/admin/") {
    const session = getCookie(req, "admin_session");
    const loggedIn = session === ADMIN_PASS;

    // Logout
    if (url.searchParams.get("logout") === "1") {
      res.setHeader("Set-Cookie", "admin_session=; Max-Age=0; Path=/");
      res.setHeader("Location", "/admin");
      res.status(302).end();
      return;
    }

    // Login page
    if (!loggedIn) {
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const params = new URLSearchParams(body);
        if (params.get("password") === ADMIN_PASS) {
          res.setHeader("Set-Cookie", `admin_session=${ADMIN_PASS}; Max-Age=86400; Path=/; HttpOnly`);
          res.setHeader("Location", "/admin");
          res.status(302).end();
          return;
        }
        res.status(200).send(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تسجيل الدخول</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f23;color:#e0e0e0;font-family:'Segoe UI',Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#1e1e3a;border:1px solid #333;border-radius:16px;padding:40px;width:340px;text-align:center}
h2{color:#7986cb;margin-bottom:25px;font-size:1.3rem}
input{width:100%;padding:10px 14px;background:#13132b;border:1px solid #444;border-radius:8px;color:#e0e0e0;font-size:1rem;margin-bottom:15px}
button{width:100%;padding:11px;background:#3f51b5;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer}
.err{color:#ef9a9a;font-size:0.9rem;margin-bottom:12px}</style></head><body>
<div class="box"><div style="font-size:3rem;margin-bottom:15px">🤖</div><h2>لوحة تحكم البوت</h2>
<form method="POST"><p class="err">❌ كلمة المرور خاطئة</p><input type="password" name="password" placeholder="كلمة المرور" required autofocus><button>دخول</button></form></div></body></html>`);
        return;
      }
      res.status(200).send(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تسجيل الدخول</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f23;color:#e0e0e0;font-family:'Segoe UI',Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#1e1e3a;border:1px solid #333;border-radius:16px;padding:40px;width:340px;text-align:center}
h2{color:#7986cb;margin-bottom:25px;font-size:1.3rem}
input{width:100%;padding:10px 14px;background:#13132b;border:1px solid #444;border-radius:8px;color:#e0e0e0;font-size:1rem;margin-bottom:15px}
button{width:100%;padding:11px;background:#3f51b5;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer}</style></head><body>
<div class="box"><div style="font-size:3rem;margin-bottom:15px">🤖</div><h2>لوحة تحكم البوت</h2>
<form method="POST"><input type="password" name="password" placeholder="كلمة المرور" required autofocus><button>دخول</button></form></div></body></html>`);
      return;
    }

    // Logged in — handle POST actions
    let error = "", success = "";
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      const action = params.get("action");

      if (action === "addbutton") {
        const label = params.get("label")?.trim();
        const type  = params.get("type");
        const content = params.get("content")?.trim();
        const caption = params.get("caption")?.trim() || "";
        const validTypes = ["text","photo","video","audio","document","animation"];
        if (!label || !content) { error = "الاسم والمحتوى مطلوبان"; }
        else if (!validTypes.includes(type)) { error = "نوع غير صحيح"; }
        else {
          const key = slugify(label);
          const buttons = await getButtons();
          buttons[key] = { label, type, content, caption, createdAt: Date.now() };
          await setButtons(buttons);
          success = `تم إضافة الزر "${label}"`;
        }
      } else if (action === "removebutton") {
        const key = params.get("key");
        const buttons = await getButtons();
        if (buttons[key]) { const lbl = buttons[key].label; delete buttons[key]; await setButtons(buttons); success = `تم حذف الزر "${lbl}"`; }
        else error = "الزر غير موجود";
      } else if (action === "addchannel") {
        let ch = params.get("channel")?.trim() || "";
        if (!ch.startsWith("@")) ch = "@" + ch;
        if (!ch || ch === "@") { error = "أدخل معرّف القناة"; }
        else {
          const channels = await getChannels();
          if (channels.includes(ch)) { error = "القناة مضافة مسبقاً"; }
          else { channels.push(ch); await setChannels(channels); success = `تمت إضافة ${ch}`; }
        }
      } else if (action === "removechannel") {
        let ch = params.get("channel");
        let channels = await getChannels();
        channels = channels.filter(c => c !== ch);
        await setChannels(channels);
        success = `تمت إزالة ${ch}`;
      } else if (action === "setwelcome") {
        const welcome = params.get("welcome")?.trim();
        if (!welcome) { error = "الرسالة فارغة"; }
        else { const info = await getBotInfo(); info.welcome = welcome; await setBotInfo(info); success = "تم حفظ رسالة الترحيب"; }
      } else if (action === "broadcast") {
        const message = params.get("message")?.trim();
        if (!message) { error = "الرسالة فارغة"; }
        else {
          const users = await getUsers();
          let ok = 0, fail = 0;
          for (const uid of users) {
            try { const r = await tg("sendMessage", { chat_id: uid, text: message, parse_mode: "HTML" }); if (r.ok) ok++; else fail++; } catch { fail++; }
            await new Promise(r => setTimeout(r, 50));
          }
          success = `تم الإرسال: ✔️ ${ok} نجح | ❌ ${fail} فشل`;
        }
      }
    }

    const [buttons, channels, users, info] = await Promise.all([getButtons(), getChannels(), getUsers(), getBotInfo()]);
    const me = await tg("getMe");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(adminHTML({ buttons, channels, users, info, botUsername: me.result?.username || "", error, success }));
    return;
  }

  // ── Telegram Webhook ──
  if (req.method === "POST" && (path === "/api/bot" || path === "/")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    let update;
    try { update = JSON.parse(body); } catch { res.status(200).end(); return; }

    if (update.message) {
      const msg = update.message;
      const text = msg.text || "";

      if (text.startsWith("/start")) {
        const payload = text.split(" ")[1] || "";
        await handleStart(msg, payload);
      } else if (isAdmin(msg.from?.id) && text.startsWith("/")) {
        await handleAdminCommand(msg);
      } else if (!isAdmin(msg.from?.id)) {
        const pending = await checkSubscription(msg.from.id);
        if (pending.length) { await sendSubscriptionPrompt(msg.chat.id, pending, ""); return res.status(200).end(); }
        await addUser(msg.from.id);
        const info = await getBotInfo();
        const buttons = await getButtons();
        const me = await tg("getMe");
        const keyboard = buildMenu(buttons, me.result?.username);
        await tg("sendMessage", {
          chat_id: msg.chat.id,
          text: info.welcome,
          parse_mode: "HTML",
          reply_markup: keyboard || undefined
        });
      }
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

    res.status(200).end();
    return;
  }

  res.status(200).send("Bot is running ✅");
};
