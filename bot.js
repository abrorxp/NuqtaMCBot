// ===================================================
// NuqtaMC Server Control Bot
// Hamma: Holat (/holat) + Yoqish tugmasi | Rank (/rank, /rankonf, /setpassword, /changepassword, tugmalar) FAQAT shaxsiy chatda | Faqat Admin: /on /off /restart + O'chirish/Qayta yuklash tugmalari
// MineStrator Public API orqali ishlaydi
// Render.com'da 24/7 ishlashi uchun kichik HTTP server bilan
// ===================================================

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// ---------------- SOZLAMALAR ----------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const MINESTRATOR_API_KEY = process.env.MINESTRATOR_API_KEY;
const SERVER_ID = process.env.SERVER_ID;
const PORT = process.env.PORT || 3000;

// Faqat shu Telegram ID(lar)ga ega odamlar O'chirish/Qayta yuklash qila oladi.
// Bir nechta admin qo'shish uchun vergul bilan ajrating: "123456789,987654321"
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

const API_BASE = 'https://mine.sttr.io';

// Suiiste'mol qilinmasligi uchun: bir amaldan keyin necha soniya kutish kerak
const COOLDOWN_SECONDS = 30;
let lastActionTime = 0;

// LuckPerms prefix qaysi "priority" bilan qo'yilsin (kattaroq raqam = ustunroq)
const PREFIX_PRIORITY = 100;

// Shaxsiy (o'yinchiga xos) prefikslar uchun ancha yuqori priority —
// bu prefiks har qanday guruh prefiksidan ustun chiqishi va boshqa
// o'sha guruhdagi o'yinchilarga ta'sir qilmasligi uchun kerak
const PERSONAL_PREFIX_PRIORITY = 1000;

// ---------------- HIMOYALANGAN RANKLAR (owner/admin) ----------------
// Bu guruhlardagi o'yinchilarga custom rank BERILMAYDI va ishlamaydi —
// ularning prefiksi doim guruhning o'zidagi (default) holatda turadi.
// .env orqali o'zgartirish mumkin: PROTECTED_GROUPS="owner,admin"
const PROTECTED_GROUPS = (process.env.PROTECTED_GROUPS || 'owner,admin')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Hozir himoyalangan guruhda turgan o'yinchilar (kichik harfda).
// Bot /lp user <ism> parent set <guruh> buyrug'ini konsoldan ko'rib, o'zi yangilab boradi.
// Bot yoqilishidan oldin owner/admin bo'lib qo'yilgan o'yinchilarni bot bila olmaydi,
// shuning uchun ularni .env'da PROTECTED_PLAYERS="Abror,Ali" deb ko'rsatib qo'ying.
const protectedPlayers = new Set(
    (process.env.PROTECTED_PLAYERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);

function isProtectedGroup(group) {
    return PROTECTED_GROUPS.includes(String(group).trim().toLowerCase());
}
function isProtectedPlayer(player) {
    return protectedPlayers.has(String(player).trim().toLowerCase());
}

// Konsolni kuzatish (parent set ni ushlash uchun) oralig'i, ms
const LOG_WATCH_INTERVAL_MS = 5000;

// ---------------- RANK SOTIB OLISH: BALANS TEKSHIRISH SOZLAMALARI ----------------

// Rank olish uchun kerak bo'lgan summa (2 milliard)
const REQUIRED_BALANCE = 2_000_000_000;

// O'yinchi balansini konsolga chiqarish uchun yuboriladigan buyruq.
// {player} avtomatik o'yinchi ismi bilan almashtiriladi.
// Kerak bo'lsa .env faylida BALANCE_CHECK_COMMAND orqali o'zgartirish mumkin.
// Masalan: "balance {player}", "money {player}", "eco see {player}"
const BALANCE_CHECK_COMMAND = process.env.BALANCE_CHECK_COMMAND || 'balance {player}';

// Balansni yechib olish uchun yuboriladigan buyruq.
// {player} va {amount} avtomatik almashtiriladi.
// Kerak bo'lsa .env faylida BALANCE_TAKE_COMMAND orqali o'zgartirish mumkin.
const BALANCE_TAKE_COMMAND = process.env.BALANCE_TAKE_COMMAND || 'eco take {player} {amount}';

// Konsol logidan raqamni "ushlab olish" uchun regex.
// DIQQAT: Bu economy plugin konsolga yozadigan matn formatiga bog'liq!
// Standart holatda har qanday son ko'rinishidagi (vergul/nuqta bilan) qatorni ushlaydi.
// Agar noto'g'ri ishlasa, botga real konsol chiqishini ko'rsating — moslab beramiz.
const BALANCE_REGEX = /([\d]+(?:[.,]\d+)?)/;

// Konsol buyruq yuborilgandan keyin javob chiqishini kutish vaqti (ms)
const BALANCE_CHECK_WAIT_MS = 1500;

// ---------------- RANK YARATISH: RANGLAR VA EFFEKTLAR ----------------

// Minecraft rang kodlari (LuckPerms/TAB'da ishlaydigan & formatlash kodlari)
const RANK_COLORS = [
    { code: '&4', label: '🔴 To\'q qizil' },
    { code: '&c', label: '🔴 Qizil' },
    { code: '&6', label: '🟠 Oltin' },
    { code: '&e', label: '🟡 Sariq' },
    { code: '&2', label: '🟢 Yashil' },
    { code: '&a', label: '🟢 Och yashil' },
    { code: '&3', label: '🔵 To\'q moviy' },
    { code: '&b', label: '🔵 Moviy' },
    { code: '&1', label: '🔵 To\'q ko\'k' },
    { code: '&9', label: '🔵 Ko\'k' },
    { code: '&5', label: '🟣 Binafsha' },
    { code: '&d', label: '🟣 Pushti' },
    { code: '&f', label: '⚪ Oq' },
    { code: '&7', label: '⚪ Kulrang' },
    { code: '&8', label: '⚫ To\'q kulrang' },
    { code: '&0', label: '⚫ Qora' }
];

const RANK_EFFECTS = [
    { code: '&l', label: '𝗕 Qalin (Bold)' },
    { code: '&o', label: '𝘐 Qiya (Italic)' },
    { code: '&n', label: 'U̲ Tagiga chiziq' },
    { code: '&m', label: 'S̶ Ustidan chiziq' },
    { code: '', label: '➖ Effektsiz' }
];

// Har bir o'yinchi uchun o'rnatilgan parol shu yerda saqlanadi (player nomi,
// kichik harfda -> parol). Bu — rank berishdan oldin "bu haqiqatan o'sha
// odamning akkounti" ekanini tekshirish uchun ishlatiladi, shu bilan admin
// (yoki botga kirgan boshqa odam) bexosdan yoki suiiste'mol qilib, boshqa
// birovning nomiga o'xshash/adashtirib boshqa akkountga rank bermasligi
// kerak.
const playerPasswords = new Map();

// Har bir foydalanuvchining rank yaratish jarayonidagi holati shu yerda saqlanadi
// { step, group, color, effect, magicBorder, word, player }
const rankSessions = new Map();

// Muvaffaqiyatli berilgan har bir custom rank shu yerda saqlanadi (player nomi, kichik harfda -> ma'lumot),
// shunday qilib keyinchalik "O'chirish"/"Yoqish" tugmalari orqali ranklarni qayta yaratmasdan
// vaqtincha o'chirib/qaytarib turish mumkin bo'ladi.
// { originalPlayer, group, prefix }
const playerRanks = new Map();

// O'chirish (off) / Yoqish (on) tugmalarini yasaydi. player nomi callback_data'ga
// to'g'ridan-to'g'ri qo'shiladi — Minecraft nicklari qisqa (<=16 belgi) bo'lgani uchun
// Telegramning 64 baytlik callback_data chegarasiga muammosiz sig'adi.
function rankToggleKeyboard(player) {
    return {
        reply_markup: {
            inline_keyboard: [[
                { text: '🔴 O\'chirish (off)', callback_data: `rank_off_${player}` },
                { text: '🟢 Yoqish (on)', callback_data: `rank_on_${player}` }
            ]]
        }
    };
}

function rankColorKeyboard() {
    const rows = [];
    for (let i = 0; i < RANK_COLORS.length; i += 4) {
        rows.push(RANK_COLORS.slice(i, i + 4).map((c, idx) => ({
            text: c.label,
            callback_data: `rank_color_${i + idx}`
        })));
    }
    rows.push([{ text: '❌ Bekor qilish', callback_data: 'rank_cancel' }]);
    return { reply_markup: { inline_keyboard: rows } };
}

function rankEffectKeyboard() {
    const rows = RANK_EFFECTS.map((e, idx) => ([{ text: e.label, callback_data: `rank_effect_${idx}` }]));
    rows.push([{ text: '⬅️ Ortga (rang)', callback_data: 'rank_back_color' }, { text: '❌ Bekor qilish', callback_data: 'rank_cancel' }]);
    return { reply_markup: { inline_keyboard: rows } };
}

function rankBorderKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✨ Ha, sehrli chegara (!!so\'z!!)', callback_data: 'rank_border_yes' }],
                [{ text: '➖ Yo\'q, oddiy', callback_data: 'rank_border_no' }],
                [{ text: '⬅️ Ortga (effekt)', callback_data: 'rank_back_effect' }, { text: '❌ Bekor qilish', callback_data: 'rank_cancel' }]
            ]
        }
    };
}

// Foydalanuvchi kiritgan matndan qo'shtirnoq belgilarini olib tashlaydi
// (to'g'ri " ' va egri " " ' ' turlari) — bu belgilar `setprefix "..."`
// konsol buyrug'i ichida qolib, buyruqni buzib yuborardi.
function stripQuotes(text) {
    return text.replace(/["'“”‘’]/g, '').trim();
}

// ESLATMA: probelni config.yml'dagi meta-formatting.prefix.end-spacer orqali
// GLOBAL qo'shish rejalashtirilgan edi, lekin serverdagi nametag/TAB
// formatida bu ishlamayapti (screenshot: "Itachi"+"Joniy" orasida probel yo'q).
// Shuning uchun probelni endi to'g'ridan-to'g'ri prefiks matniga, oxiriga
// qo'shib qo'yamiz — bu har doim, TAB konfiguratsiyasidan qat'i nazar ishlaydi.
function buildRankPrefix(session) {
    const color = session.color;
    const effect = session.effect || '';
    const word = session.word;
    if (session.magicBorder) {
        return `${color}${effect}&k!!&r${color}${effect}${word}&k!!&r `;
    }
    return `${color}${effect}${word} `;
}

function rankConfirmKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Tasdiqlash va serverga yuborish', callback_data: 'rank_confirm' }],
                [{ text: '❌ Bekor qilish', callback_data: 'rank_cancel' }]
            ]
        }
    };
}

if (!BOT_TOKEN || !MINESTRATOR_API_KEY || !SERVER_ID) {
    console.error('XATO: .env faylida (yoki Render Environment sozlamalarida) BOT_TOKEN, MINESTRATOR_API_KEY va SERVER_ID borligini tekshiring!');
    process.exit(1);
}

// polling: false — ma'lumotlar (parollar, ranklar) diskdan/bazadan yuklanib bo'lgach, pastda startPolling() bilan yoqiladi
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Telefon/Termux'da ishlaganda kutilmagan xato botni o'ldirib qo'ymasligi uchun
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err && err.message ? err.message : err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err && err.message ? err.message : err));

// Polling xatolarini (masalan 409 Conflict) bir xil qatorni takrorlamasdan, 1 daqiqada bir marta chiqaradi
let lastPollErr = '';
let lastPollErrAt = 0;
bot.on('polling_error', (err) => {
    const msg = String(err && err.message ? err.message : err);
    if (msg === lastPollErr && Date.now() - lastPollErrAt < 60000) return;
    lastPollErr = msg;
    lastPollErrAt = Date.now();
    if (msg.includes('409')) {
        console.error('⚠️ 409 Conflict: bot boshqa joyda ham ishlayapti (Render/laptop)! Faqat bitta nusxa qolishi kerak.');
    } else {
        console.error('[polling_error]', msg);
    }
});

function isAdmin(userId) {
    return ADMIN_IDS.includes(String(userId));
}

// ---------------- FAQAT SHAXSIY CHAT (guruhlarda rank ishlamaydi) ----------------

// Rank yaratish, /rankonf, /setpassword, /changepassword va rank tugmalari
// FAQAT botning shaxsiy chatida ishlaydi. Guruhda: "Rank yaratish" tugmasi
// umuman chiqmaydi, komandalar esa rad etiladi (parol yozilgan xabar bo'lsa,
// bot admin bo'lgan taqdirda o'chirib ham yuboriladi).
let BOT_USERNAME = null;
bot.getMe().then((me) => { BOT_USERNAME = me.username; }).catch(() => {});

function isPrivateChat(chat) {
    return !!chat && chat.type === 'private';
}

function privateOnlyText() {
    const link = BOT_USERNAME ? `\n\n👉 https://t.me/${BOT_USERNAME}` : '';
    return `🔒 Rank va parol funksiyalari faqat shaxsiy chatda ishlaydi. Botga shaxsan yozing.${link}`;
}

// Shaxsiy chat bo'lsa true qaytaradi. Aks holda foydalanuvchiga xabar beradi
// va false qaytaradi. sensitive=true bo'lsa (xabarda parol bor) — guruhdagi
// xabarni o'chirishga urinadi (bot guruhda admin bo'lmasa, jimgina o'tkazib yuboradi).
function requirePrivate(msg, sensitive = false) {
    if (isPrivateChat(msg.chat)) return true;
    if (sensitive) bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    bot.sendMessage(msg.chat.id, privateOnlyText());
    return false;
}

// ---------------- PAROLLARNI HASH QILISH ----------------

// Parollar endi ochiq matnda emas, "tuz" (salt) bilan scrypt hash sifatida saqlanadi —
// fayl yoki baza tasodifan ko'rinib qolsa ham parolni o'qib bo'lmaydi.
function hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(pw), salt, 32);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
    try {
        const [alg, saltHex, hashHex] = String(stored).split('$');
        if (alg !== 'scrypt') return false;
        const expected = Buffer.from(hashHex, 'hex');
        const actual = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
        return crypto.timingSafeEqual(actual, expected);
    } catch (e) {
        return false;
    }
}

// ---------------- KALICI SAQLASH (bot qayta ishga tushsa ham ma'lumot o'chmaydi) ----------------

// Saqlanadigan ma'lumotlar: parollar (hash), berilgan custom ranklar (on/off tugmalari uchun),
// va "himoyalangan" o'yinchilar ro'yxati.
//
// Ikki usul bor:
//  1) MONGODB_URI berilsa  -> MongoDB (Render kabi vaqtinchalik diskli hostinglarda TAVSIYA ETILADI;
//     Atlas'ning bepul tarifi yetadi). Buning uchun: npm install mongodb
//  2) MONGODB_URI yo'q      -> JSON fayl (DATA_FILE, standart: bot-data.json).
//     DIQQAT: Render'ning bepul tarifida disk har qayta ishga tushganda tozalanadi,
//     shuning uchun u yerda faqat MongoDB ishonchli. Kompyuter/VPS'da fayl yetarli.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'bot-data.json');
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'nuqtamc';
let mongoCol = null;

// Kalitlarda nuqta bo'lishi mumkin (masalan Bedrock nikleri) — shuning uchun obyekt emas,
// [kalit, qiymat] juftliklari massivi sifatida saqlaymiz.
function snapshotData() {
    return {
        passwords: [...playerPasswords.entries()],
        ranks: [...playerRanks.entries()],
        protectedPlayers: [...protectedPlayers]
    };
}

function applyData(d) {
    if (!d) return;
    for (const [k, v] of d.passwords || []) playerPasswords.set(k, v);
    for (const [k, v] of d.ranks || []) playerRanks.set(k, v);
    for (const k of d.protectedPlayers || []) protectedPlayers.add(k);
}

async function loadData() {
    if (MONGODB_URI) {
        // Bazaga ulanib bo'lmasa, bo'sh xotira bilan davom etmaymiz — aks holda keyingi
        // saqlash bazadagi haqiqiy ma'lumotni bo'sh holat bilan ustiga yozib yuborardi.
        try {
            const { MongoClient } = require('mongodb');
            const client = new MongoClient(MONGODB_URI);
            await client.connect();
            mongoCol = client.db(MONGODB_DB).collection('botdata');
            applyData(await mongoCol.findOne({ _id: 'state' }));
            console.log(`💾 MongoDB ulandi (${MONGODB_DB}.botdata): ${playerPasswords.size} parol, ${playerRanks.size} rank yuklandi`);
        } catch (e) {
            console.error(`❌ MongoDB'ga ulanib bo'lmadi: ${e.message}\n   (mongodb paketi o'rnatilganini — npm install mongodb — va MONGODB_URI to'g'riligini tekshiring)`);
            process.exit(1);
        }
        return;
    }

    try {
        if (fs.existsSync(DATA_FILE)) {
            applyData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
        }
        console.log(`💾 Ma'lumotlar fayldan yuklandi (${DATA_FILE}): ${playerPasswords.size} parol, ${playerRanks.size} rank`);
    } catch (e) {
        // Buzilgan faylni yo'qotmaymiz — nusxasini olib qo'yamiz
        try { fs.copyFileSync(DATA_FILE, `${DATA_FILE}.buzilgan-${Date.now()}`); } catch (e2) { /* ignore */ }
        console.error(`[SAQLASH] Fayl o'qilmadi (${e.message}) — nusxa olindi, bo'sh holatdan boshlanadi.`);
    }
    if (process.env.RENDER) {
        console.warn('⚠️ Render\'da fayl diski har qayta ishga tushganda tozalanadi — parollar/ranklar yo\'qoladi. MONGODB_URI sozlang (yoki Render\'da pullik "Persistent Disk" ulab, DATA_FILE ni shu diskka yo\'naltiring).');
    }
}

async function saveDataNow() {
    const data = snapshotData();
    try {
        if (mongoCol) {
            await mongoCol.updateOne({ _id: 'state' }, { $set: data }, { upsert: true });
        } else {
            const tmp = `${DATA_FILE}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(data));
            fs.renameSync(tmp, DATA_FILE); // atomik almashtirish — yozish o'rtasida uzilsa ham fayl butun qoladi
        }
    } catch (e) {
        console.error('[SAQLASH] Saqlab bo\'lmadi:', e.message);
    }
}

// Ketma-ket o'zgarishlarni bitta yozuvga jamlaydi (0.5 soniya ichida)
let saveTimer = null;
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        await saveDataNow();
    }, 500);
}

// Render qayta ishga tushirganda (SIGTERM) — kutilayotgan o'zgarishlarni darrov saqlab chiqamiz
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        await saveDataNow();
        process.exit(0);
    });
}

// ---------------- PAROL: NOTO'G'RI URINISHLARNI CHEKLASH ----------------

// Eski parolni topib olish uchun ketma-ket taxmin qilishni to'xtatadi:
// 10 daqiqada 5 marta xato qilgan foydalanuvchi 10 daqiqaga bloklanadi.
const PASSWORD_MAX_FAILS = 5;
const PASSWORD_LOCK_MS = 10 * 60 * 1000;
const passwordFails = new Map(); // telegram user id -> { count, lockedUntil, firstAt }

function passwordLockedSeconds(userId) {
    const rec = passwordFails.get(userId);
    if (!rec || !rec.lockedUntil) return 0;
    const left = rec.lockedUntil - Date.now();
    if (left <= 0) { passwordFails.delete(userId); return 0; }
    return Math.ceil(left / 1000);
}

function registerPasswordFail(userId) {
    const now = Date.now();
    let rec = passwordFails.get(userId);
    if (!rec || now - rec.firstAt > PASSWORD_LOCK_MS) rec = { count: 0, lockedUntil: 0, firstAt: now };
    rec.count += 1;
    if (rec.count >= PASSWORD_MAX_FAILS) rec.lockedUntil = now + PASSWORD_LOCK_MS;
    passwordFails.set(userId, rec);
}

// ---------------- RENDER UCHUN "TIRIKMAN" SERVERI ----------------

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NuqtaMC Bot ishlab turibdi ✅');
}).listen(PORT, () => {
    console.log(`🌐 Health-check server ${PORT}-portda ishga tushdi`);
});

// ---------------- MINESTRATOR API YORDAMCHI FUNKSIYALAR ----------------

async function apiRequest(method, path, body = null) {
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${MINESTRATOR_API_KEY}`,
            'Content-Type': 'application/json',
            'Origin': 'https://minestrator.com',
            'Referer': 'https://minestrator.com/'
        }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, options);
    const data = await res.json();

    if (!res.ok) {
        console.error(`[API XATO] ${method} ${path} -> ${res.status}`, JSON.stringify(data));
        throw new Error(data?.api?.description || `API xato: ${res.status}`);
    }
    return data?.api?.data;
}

async function getServerLive() {
    return apiRequest('GET', `/server/${SERVER_ID}/live`);
}

async function sendPowerAction(action) {
    return apiRequest('PUT', `/server/${SERVER_ID}/poweraction`, { poweraction: action });
}

async function sendServerCommand(command) {
    return apiRequest('PUT', `/server/${SERVER_ID}/command`, { command });
}

async function getConsoleLogs() {
    return apiRequest('GET', `/server/${SERVER_ID}/console/logs`);
}

// API konsol loglarini turli shaklda qaytarishi mumkin (matn, qatorlar massivi,
// {line/message/text...} obyektlar massivi yoki ichida massiv bor obyekt).
// Bu funksiya hammasini oddiy matn qatorlari ro'yxatiga aylantiradi.
// Avval faqat String(logs) ishlatilgani uchun obyektlar "[object Object]" bo'lib qolardi.
function normalizeLogs(logs) {
    const out = [];
    const textKeys = ['line', 'message', 'text', 'content', 'log', 'msg', 'output', 'logs', 'lines', 'data'];
    const visit = (v) => {
        if (v === null || v === undefined) return;
        if (typeof v === 'string') { v.split(/\r?\n/).forEach(l => { if (l.length) out.push(l); }); return; }
        if (Array.isArray(v)) { v.forEach(visit); return; }
        if (typeof v === 'object') {
            for (const k of textKeys) {
                if (k in v) { visit(v[k]); return; }
            }
            out.push(JSON.stringify(v)); // noma'lum shakl — diagnostika uchun ko'rinib turadi
            return;
        }
        out.push(String(v));
    };
    visit(logs);
    return out;
}

async function getConsoleLines() {
    return normalizeLogs(await getConsoleLogs()).map(stripAnsi);
}

// ANSI rang kodlarini konsol matnidan tozalaydi (regex bilan solishtirish oson bo'lishi uchun)
function stripAnsi(str) {
    return String(str).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

// Foydalanuvchi (admin) o'zi yozgan matnlarni (guruh nomi, so'z, o'yinchi ismi, buyruqlar)
// Telegram HTML xabariga qo'shishdan oldin xavfsiz qiladi.
// HTML rejimida faqat &, <, > belgilari muammo tug'diradi — shularni escape qilamiz.
// Bu Markdown'dan farqli o'laroq, entity juftlashish muammolarini butunlay yo'q qiladi:
// Markdown'da _, *, ` kabi juft bo'lishi kerak bo'lgan belgilar bo'lsa, foydalanuvchi
// matnida ular toq sonda uchrasa Telegram "can't parse entities" xatosini berardi.
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Oldingi va hozirgi konsol oynasini solishtirib, faqat YANGI qatorlarni qaytaradi
function diffNewLines(prev, cur) {
    let overlap = 0;
    for (let k = Math.min(prev.length, cur.length); k > 0; k--) {
        let same = true;
        for (let i = 0; i < k; i++) {
            if (prev[prev.length - k + i] !== cur[i]) { same = false; break; }
        }
        if (same) { overlap = k; break; }
    }
    return cur.slice(overlap);
}

// "$100,000,000,000" / "100B" ko'rinishidagi pulni songa aylantiradi (topilmasa null)
function moneyToNumber(numStr, suffix) {
    const base = parseFloat(String(numStr).replace(/,/g, ''));
    if (isNaN(base)) return null;
    const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(suffix || '').toLowerCase()] || 1;
    return base * mult;
}

// O'yinchi ismi YO'Q qatordan ham balansni topishga urinadi.
// Ba'zi economy pluginlar javobni "Balance: $100,000,000,000" deb yozadi (ism yo'q).
function parseAnonymousBalanceLine(line) {
    let m = line.match(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*([kmbt])?/i);
    if (m) return moneyToNumber(m[1], m[2]);
    m = line.match(/(?:balance|money)[^:\d]*:\s*(\d[\d,]*(?:\.\d+)?)\s*([kmbt])?/i);
    if (m) return moneyToNumber(m[1], m[2]);
    return null;
}

// O'yinchining balansini konsol orqali tekshiradi.
// Qaytaradi: { value, rawLine } — balans topilsa
//            { value: null, debugLines } — bir necha urinishdan keyin ham
//            topilmasa (diagnostika uchun oxirgi ko'rilgan qatorlar bilan)
async function checkPlayerBalance(player) {
    const cmd = BALANCE_CHECK_COMMAND.replace('{player}', player);

    // Buyruq yuborishdan OLDINGI konsol holati — keyin faqat yangi qatorlarni ko'ramiz
    let baseline = null;
    try {
        baseline = await getConsoleLines();
    } catch (e) { /* baseline bo'lmasa, eski usulda davom etamiz */ }

    await sendServerCommand(cmd);

    const maxAttempts = 4; // jami ~ maxAttempts * BALANCE_CHECK_WAIT_MS kutiladi
    let lastLines = [];
    let lastFresh = [];
    const lowerPlayer = player.toLowerCase();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, BALANCE_CHECK_WAIT_MS));

        const lines = await getConsoleLines();
        lastLines = lines;

        const fresh = baseline ? diffNewLines(baseline, lines) : lines;
        lastFresh = fresh;

        // 1) O'yinchi ismi bor qator (eng oxirgisidan boshlab)
        for (let i = fresh.length - 1; i >= 0; i--) {
            const line = fresh[i];
            const lowerLine = line.toLowerCase();
            if (!lowerLine.includes(lowerPlayer)) continue;

            // Raqamni butun qatordan emas, o'yinchi ismidan KEYINGI qismidan qidiramiz
            // (qator boshidagi "[19:11:24]" vaqti balans bo'lib qolmasligi uchun)
            const playerIdx = lowerLine.indexOf(lowerPlayer);
            const afterPlayer = line.slice(playerIdx + player.length).replace(/,/g, '');
            const match = afterPlayer.match(BALANCE_REGEX);
            if (match) {
                const value = parseFloat(match[1]);
                if (!isNaN(value)) return { value, rawLine: line };
            }
        }

        // 2) Zaxira: ism yo'q, lekin buyruqdan keyin paydo bo'lgan "Balance: $..." qatori
        if (baseline) {
            for (let i = fresh.length - 1; i >= 0; i--) {
                const value = parseAnonymousBalanceLine(fresh[i]);
                if (value !== null) return { value, rawLine: fresh[i] };
            }
        }
    }

    // Topilmadi — diagnostika uchun yangi qatorlarni (bo'lmasa oxirgilarini) qaytaramiz
    const debug = (lastFresh.length ? lastFresh : lastLines).slice(-6);
    return { value: null, debugLines: debug };
}

function stateLabel(state) {
    const map = {
        online: '🟢 Online',
        offline: '🔴 Offline',
        starting: '🟡 Ishga tushmoqda...',
        stopping: '🟠 O\'chmoqda...'
    };
    return map[state] || `❔ ${state}`;
}

function mainKeyboard(userId, chatType) {
    const rows = [
        [{ text: '🟢 Yoqish', callback_data: 'start_server' }]
    ];

    if (isAdmin(userId)) {
        rows.push([
            { text: '🔴 O\'chirish', callback_data: 'stop_server' },
            { text: '🔄 Qayta yuklash', callback_data: 'restart_server' }
        ]);
    }

    // Rank yaratish tugmasi FAQAT shaxsiy chatda chiqadi (guruhlarda ko'rinmaydi)
    if (chatType === 'private') {
        rows.push([{ text: '🎨 Rank yaratish', callback_data: 'rank_start' }]);
    }

    rows.push([{ text: '📊 Holatni ko\'rish', callback_data: 'check_status' }]);

    return { reply_markup: { inline_keyboard: rows } };
}

// ---------------- KOMANDALAR ----------------

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        '🎮 <b>NuqtaMC Server Boshqaruvi</b>\n\nKerakli amalni tanlang:\n\n/holat — server holati\n/on /off /restart — faqat adminlar uchun',
        { parse_mode: 'HTML', ...mainKeyboard(msg.from.id, msg.chat.type) }
    );
});

// Server holati — hamma uchun (/holat yoki /status)
bot.onText(/^\/(?:holat|status)(?:@\w+)?\s*$/, async (msg) => {
    await sendStatus(msg.chat.id, msg.from.id, msg.chat.type);
});

// Server boshqaruv buyruqlari — FAQAT adminlar (ADMIN_IDS) uchun: /on /off /restart
// Tugmalardagi kabi umumiy cooldown ishlaydi (tez-tez bosib yuborishdan saqlaydi).
const POWER_COMMANDS = {
    on:      { api: 'start',   done: (n) => `🟢 ${n} (admin) serverni yoqdi!\n\nBir necha soniyadan so'ng onlayn bo'ladi.` },
    off:     { api: 'stop',    done: (n) => `🔴 ${n} (admin) serverni o'chirdi!` },
    restart: { api: 'restart', done: (n) => `🔄 ${n} (admin) serverni qayta yukladi!` }
};

for (const [cmd, cfg] of Object.entries(POWER_COMMANDS)) {
    bot.onText(new RegExp(`^\\/${cmd}(?:@\\w+)?\\s*$`), async (msg) => {
        const userId = msg.from && msg.from.id;
        if (!userId || !isAdmin(userId)) {
            bot.sendMessage(msg.chat.id, '⛔ Bu buyruq faqat adminlar uchun!');
            return;
        }

        const waitLeft = Math.ceil(COOLDOWN_SECONDS - (Date.now() - lastActionTime) / 1000);
        if (waitLeft > 0) {
            bot.sendMessage(msg.chat.id, `⏳ Iltimos ${waitLeft} soniya kuting, tez-tez yubormang!`);
            return;
        }

        try {
            await sendPowerAction(cfg.api);
            lastActionTime = Date.now();
            const name = msg.from.first_name || msg.from.username || 'Admin';
            // parse_mode ishlatilmaydi — ismdagi maxsus belgilar xatoga sabab bo'lmaydi
            bot.sendMessage(msg.chat.id, cfg.done(name));
        } catch (err) {
            bot.sendMessage(msg.chat.id, `❌ Xato: ${err.message}`);
        }
    });
}

// Telegram ID'ingizni bilish uchun vaqtinchalik komanda
bot.onText(/\/myid/, (msg) => {
    bot.sendMessage(msg.chat.id, `Sizning Telegram ID'ingiz: <code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
});

// O'yinchi uchun BIRINCHI marta parol o'rnatadi (faqat shaxsiy chatda).
// Foydalanish: /setpassword <o'yinchi> <parol>
// Bu parol keyinchalik /rank jarayonida (o'yinchi ismi kiritilgandan keyin,
// tasdiqlashdan OLDIN) so'raladi — shu bilan admin haqiqatan o'sha odam
// bilan gaplashib (masalan uning o'zidan parolni so'rab) tasdiqlagandan
// keyingina rank beriladi, boshqa birovning akkountiga adashib/atayin
// rank berib qo'yilmaydi.
// MUHIM: parol allaqachon o'rnatilgan bo'lsa, bu komanda uni QAYTA YOZMAYDI —
// o'zgartirish uchun /changepassword (eski parol bilan) ishlatiladi.
bot.onText(/^\/setpassword(?:@\w+)?\s+(\S+)\s+(.+)$/, (msg, match) => {
    if (!requirePrivate(msg, true)) return;

    const player = match[1].trim();
    const password = match[2].trim();
    const key = player.toLowerCase();

    if (/\s/.test(password)) {
        bot.sendMessage(msg.chat.id, `⚠️ Parolda probel bo'lmasligi kerak (keyin /changepassword bilan o'zgartirish uchun).`);
        return;
    }

    if (playerPasswords.has(key)) {
        bot.sendMessage(
            msg.chat.id,
            `⚠️ «${player}» uchun parol allaqachon o'rnatilgan.\n\n` +
            `Parolni o'zgartirish uchun eski parolni bilishingiz kerak:\n/changepassword eski_parol yangi_parol`
        );
        return;
    }

    playerPasswords.set(key, hashPassword(password));
    scheduleSave();
    // parse_mode ishlatilmaydi — o'yinchi ismi/parol erkin matn bo'lgani uchun
    bot.sendMessage(msg.chat.id, `🔒 «${player}» uchun parol saqlandi.\n\nEndi bu o'yinchiga /rank orqali rank berilayotganda shu parol so'raladi.`);
});

// Parolni o'zgartirish — ESKI PAROLNI bilish shart (faqat shaxsiy chatda).
// Foydalanish: /changepassword eski_parol yangi_parol
// Agar bir nechta o'yinchida aynan bir xil parol bo'lsa, bot qaysi biri
// ekanini aniqlay olmaydi — shunda o'yinchi ismi ham yoziladi:
//   /changepassword o'yinchi eski_parol yangi_parol
// Ketma-ket ko'p marta noto'g'ri eski parol kiritilsa, vaqtincha bloklanadi.
bot.onText(/^\/changepassword(?:@\w+)?(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+.*)?$/, (msg, match) => {
    if (!requirePrivate(msg, true)) return;

    const args = [match[1], match[2], match[3]].filter(Boolean);
    const extra = /^\/changepassword(?:@\w+)?(?:\s+\S+){4,}/.test(msg.text);
    if (args.length < 2 || extra) {
        bot.sendMessage(
            msg.chat.id,
            `Foydalanish:\n/changepassword eski_parol yangi_parol\n\n` +
            `(Parolda probel bo'lmasligi kerak. Agar bir nechta o'yinchida bir xil parol bo'lsa: /changepassword o'yinchi eski_parol yangi_parol)`
        );
        return;
    }

    const userId = msg.from.id;
    const lockedFor = passwordLockedSeconds(userId);
    if (lockedFor > 0) {
        bot.sendMessage(msg.chat.id, `⛔ Juda ko'p noto'g'ri urinish. ${Math.ceil(lockedFor / 60)} daqiqadan keyin qayta urinib ko'ring.`);
        return;
    }

    let playerArg = null;
    let oldPass;
    let newPass;
    if (args.length === 3) [playerArg, oldPass, newPass] = args;
    else [oldPass, newPass] = args;

    // Eski parol mos keladigan o'yinchilarni topamiz
    let matches;
    if (playerArg) {
        const k = playerArg.toLowerCase();
        const stored = playerPasswords.get(k);
        matches = stored && verifyPassword(oldPass, stored) ? [k] : [];
    } else {
        matches = [...playerPasswords.entries()].filter(([, stored]) => verifyPassword(oldPass, stored)).map(([k]) => k);
    }

    if (matches.length === 0) {
        registerPasswordFail(userId);
        bot.sendMessage(msg.chat.id, `❌ Eski parol noto'g'ri (yoki bunday parol o'rnatilmagan). Parol o'zgartirilmadi.`);
        return;
    }

    if (matches.length > 1) {
        bot.sendMessage(
            msg.chat.id,
            `⚠️ Bu eski parol bir nechta o'yinchida bir xil, qaysi biri ekanini aniqlab bo'lmadi.\n\n` +
            `O'yinchi ismini ham yozing:\n/changepassword o'yinchi eski_parol yangi_parol`
        );
        return;
    }

    if (newPass === oldPass) {
        bot.sendMessage(msg.chat.id, `⚠️ Yangi parol eskisi bilan bir xil. Boshqa parol tanlang.`);
        return;
    }

    passwordFails.delete(userId);
    playerPasswords.set(matches[0], hashPassword(newPass));
    scheduleSave();
    bot.sendMessage(msg.chat.id, `✅ Parol o'zgartirildi. Endi rank berishda yangi parol so'raladi.`);
});

// Hamma uchun: istalgan payt (yaratish oqimidan tashqari ham) berilgan
// o'yinchi uchun "O'chirish (off)" / "Yoqish (on)" tugmalarini qayta chiqaradi.
// Foydalanish: /rankonf <o'yinchi>
// Bu ayniqsa avvalgi xabardagi tugma "ishlamay qolgan" (masalan bot qayta
// ishga tushgani yoki xabar juda eski bo'lgani uchun) holatlarda foydali —
// shunchaki shu komandani qayta yuborib, yangi (yangi ma'lumot bilan)
// tugmalarni olish mumkin.
bot.onText(/^\/rankonf(?:@\w+)?(?:\s+(\S+))?/, (msg, match) => {
    if (!requirePrivate(msg)) return;

    const player = match[1] ? match[1].trim() : null;
    if (!player) {
        bot.sendMessage(msg.chat.id, 'Foydalanish: /rankonf <o\'yinchi>\n\nMasalan: /rankonf Itachi');
        return;
    }

    const data = playerRanks.get(player.toLowerCase());
    if (!data) {
        bot.sendMessage(
            msg.chat.id,
            `⚠️ «${player}» uchun saqlangan custom rank topilmadi.\n\n` +
            `Bu o'yinchiga avval /rank orqali rank berilgan bo'lishi kerak — yoki bu rank bot saqlashni yoqishidan oldin berilgan bo'lishi mumkin.`
        );
        return;
    }

    bot.sendMessage(
        msg.chat.id,
        `🎨 <code>${escapeHtml(data.originalPlayer)}</code>ning custom ranki:\n\n` +
        `Kod: <code>${escapeHtml(data.prefix)}</code>\nGuruh: <code>${escapeHtml(data.group)}</code>`,
        { parse_mode: 'HTML', ...rankToggleKeyboard(data.originalPlayer) }
    );
});

// Hamma uchun: rank (prefix) yaratish jarayonini boshlaydi
bot.onText(/^\/rank(?:@\w+)?\s*$/, (msg) => {
    if (!requirePrivate(msg)) return;
    startRankFlow(msg.chat.id, msg.from.id);
});

function startRankFlow(chatId, userId) {
    rankSessions.set(userId, { step: 'group' });
    bot.sendMessage(
        chatId,
        '🎨 <b>Yangi rank yaratish</b>\n\n1-qadam: LuckPerms guruh nomini yozing (masalan: <code>uchiha</code>, <code>killer</code>, <code>imperator</code>).\n\nBu — sizda LuckPerms\'da allaqachon mavjud bo\'lgan guruh nomi bo\'lishi kerak.',
        { parse_mode: 'HTML' }
    );
}

async function sendStatus(chatId, userId, chatType) {
    try {
        const live = await getServerLive();
        const stats = live.stats;
        let text = `📊 <b>Server holati</b>\n\n`;
        text += `Holat: ${stateLabel(live.state)}\n`;

        if (live.state === 'online' && stats) {
            text += `Onlayn o'yinchilar: ${stats.players?.current ?? 0}/${stats.players?.limit ?? '?'}\n`;
            text += `CPU: ${stats.cpu?.percent ?? 0}%\n`;
            text += `RAM: ${stats.memory?.current ?? 0}/${stats.memory?.limit ?? '?'} MB\n`;
            text += `Ishlash vaqti: ${stats.uptime?.hours ?? 0}s ${stats.uptime?.minutes ?? 0}daq\n`;
        }

        bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...mainKeyboard(userId, chatType) });
    } catch (err) {
        bot.sendMessage(chatId, `❌ Xato: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
}

// ---------------- RANK YARATISH: MATN QADAMLARI (guruh nomi, so'z) ----------------

bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return; // komandalarga tegmaymiz
    if (!isPrivateChat(msg.chat)) return; // rank jarayoni faqat shaxsiy chatda

    const session = rankSessions.get(msg.from.id);
    if (!session) return; // rank jarayoni boshlanmagan bo'lsa, e'tiborsiz qoldiramiz

    if (session.step === 'group') {
        session.group = stripQuotes(msg.text);
        if (isProtectedGroup(session.group)) {
            rankSessions.delete(msg.from.id);
            bot.sendMessage(
                msg.chat.id,
                `⛔ «${session.group}» guruhi uchun custom rank yaratib bo'lmaydi — bu guruhning prefiksi o'zgarmas.\n\nBoshqa guruh bilan /rank ni qayta boshlang.`
            );
            return;
        }
        session.step = 'color';
        // parse_mode ishlatilmaydi — foydalanuvchi kiritgan matn xavfsiz chiqadi
        bot.sendMessage(
            msg.chat.id,
            `Guruh: «${session.group}»\n\n2-qadam: Rangni tanlang:`,
            { ...rankColorKeyboard() }
        );
        return;
    }

    if (session.step === 'word') {
        session.word = stripQuotes(msg.text);
        session.step = 'player';
        bot.sendMessage(
            msg.chat.id,
            `6-qadam: Rankni kimga berasiz? O'yinchining serverdagi (Minecraft) ismini yozing.`
        );
        return;
    }

    if (session.step === 'player') {
        session.player = msg.text.trim();

        if (isProtectedPlayer(session.player)) {
            rankSessions.delete(msg.from.id);
            bot.sendMessage(
                msg.chat.id,
                `⛔ «${session.player}» hozir himoyalangan rankda (${PROTECTED_GROUPS.join('/')}) — unga custom rank berib bo'lmaydi, prefiksi o'z holicha qoladi.`
            );
            return;
        }

        const savedPassword = playerPasswords.get(session.player.toLowerCase());

        if (savedPassword) {
            session.step = 'password';
            bot.sendMessage(
                msg.chat.id,
                `🔒 «${session.player}» uchun parol o'rnatilgan.\n\n7-qadam: Davom etish uchun parolni yozing (o'yinchining o'zidan so'rab tasdiqlang — bu boshqa birovning akkountiga adashib rank berib qo'yishning oldini oladi).`
            );
            return;
        }

        // Parol o'rnatilmagan — ogohlantiramiz, lekin jarayonni to'xtatmaymiz
        session.step = 'confirm';
        sendRankConfirmPreview(msg.chat.id, session, true);
        return;
    }

    if (session.step === 'password') {
        const entered = msg.text.trim();
        const savedPassword = playerPasswords.get(session.player.toLowerCase());

        if (!verifyPassword(entered, savedPassword)) {
            rankSessions.delete(msg.from.id);
            bot.sendMessage(
                msg.chat.id,
                `❌ Noto'g'ri parol! Rank berish bekor qilindi.\n\nQayta boshlash uchun /rank yozing.`
            );
            return;
        }

        session.step = 'confirm';
        bot.sendMessage(msg.chat.id, `✅ Parol to'g'ri.`);
        sendRankConfirmPreview(msg.chat.id, session, false);
        return;
    }
});

// "Tayyor! O'yinchi/Guruh/Kod..." tasdiqlash xabarini yuboradi (player va
// password bosqichlaridan keyin ikkalasida ham ishlatiladi).
// warnNoPassword=true bo'lsa, parol o'rnatilmaganligi haqida ogohlantirish qo'shiladi.
function sendRankConfirmPreview(chatId, session, warnNoPassword) {
    const preview = buildRankPrefix(session);
    let text = '';
    if (warnNoPassword) {
        text += `⚠️ Diqqat: «${session.player}» uchun parol o'rnatilmagan (/setpassword bilan hali qo'yilmagan) — akkount tasdiqlanmadi!\n\n`;
    }
    // parse_mode ishlatilmaydi — session.player/group/preview foydalanuvchi kiritgan
    // erkin matn bo'lgani uchun bu yerda Markdown/HTML formatlashdan qochamiz
    text += `✅ Tayyor!\n\nO'yinchi: «${session.player}»\nGuruh: «${session.group}»\nKod: «${preview}»\n\nO'yinda quyidagicha ko'rinadi (rang kodlari bilan): ${preview}\n\nTasdiqlasangiz, «${session.player}»ning balansi tekshiriladi, yetarli bo'lsa ${REQUIRED_BALANCE.toLocaleString()} yechiladi va rank beriladi.`;
    bot.sendMessage(chatId, text, { ...rankConfirmKeyboard() });
}

// ---------------- RANK YARATISH: TUGMA QADAMLARI (rang, effekt, border, tasdiq) ----------------

async function handleRankCallback(query, action) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const messageId = query.message.message_id;

    if (action === 'rank_cancel') {
        rankSessions.delete(userId);
        await bot.answerCallbackQuery(query.id, { text: 'Bekor qilindi' });
        await bot.editMessageText('❌ Rank yaratish bekor qilindi.', { chat_id: chatId, message_id: messageId });
        return;
    }

    const session = rankSessions.get(userId);
    if (!session) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ Sessiya topilmadi, /rank dan qayta boshlang', show_alert: true });
        return;
    }

    if (action.startsWith('rank_color_')) {
        const idx = parseInt(action.replace('rank_color_', ''), 10);
        session.color = RANK_COLORS[idx].code;
        session.step = 'effect';
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText(
            `Rang: ${RANK_COLORS[idx].label}\n\n3-qadam: Effektni tanlang:`,
            { chat_id: chatId, message_id: messageId, ...rankEffectKeyboard() }
        );
        return;
    }

    if (action === 'rank_back_color') {
        session.step = 'color';
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText('2-qadam: Rangni tanlang:', { chat_id: chatId, message_id: messageId, ...rankColorKeyboard() });
        return;
    }

    if (action.startsWith('rank_effect_')) {
        const idx = parseInt(action.replace('rank_effect_', ''), 10);
        session.effect = RANK_EFFECTS[idx].code;
        session.step = 'border';
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText(
            `Effekt: ${RANK_EFFECTS[idx].label}\n\n4-qadam: Sehrli chegara (!!so'z!!) qo'shilsinmi?`,
            { chat_id: chatId, message_id: messageId, ...rankBorderKeyboard() }
        );
        return;
    }

    if (action === 'rank_back_effect') {
        session.step = 'effect';
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText('3-qadam: Effektni tanlang:', { chat_id: chatId, message_id: messageId, ...rankEffectKeyboard() });
        return;
    }

    if (action === 'rank_border_yes' || action === 'rank_border_no') {
        session.magicBorder = action === 'rank_border_yes';
        session.step = 'word';
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText(
            `5-qadam: Endi rank matnini (so'zini) yozing (masalan: Uchiha, Killer).`,
            { chat_id: chatId, message_id: messageId }
        );
        return;
    }

    if (action === 'rank_confirm') {
        await bot.answerCallbackQuery(query.id, { text: '⏳ Balans tekshirilmoqda...' });
        try {
            await bot.editMessageText(
                `⏳ «${session.player}»ning balansi tekshirilmoqda, biroz kuting...`,
                { chat_id: chatId, message_id: messageId }
            );

            if (isProtectedGroup(session.group) || isProtectedPlayer(session.player)) {
                await bot.editMessageText(
                    `⛔ «${session.player}» / «${session.group}» himoyalangan rank — custom rank berilmadi, hech narsa yechilmadi.`,
                    { chat_id: chatId, message_id: messageId }
                );
                rankSessions.delete(userId);
                return;
            }

            // checkPlayerBalance { value, ... } obyektini qaytaradi — raqamning o'zini olamiz
            const balanceResult = await checkPlayerBalance(session.player);
            const balance = balanceResult.value;

            if (balance === null) {
                await bot.editMessageText(
                    `⚠️ «${session.player}»ning balansini konsoldan aniqlab bo'lmadi.\n\n` +
                    `Sabab: BALANCE_CHECK_COMMAND yoki BALANCE_REGEX serverdagi economy plaginning konsol chiqishi bilan mos kelmayotgan bo'lishi mumkin. ` +
                    `Konsolda ko'ringan qatorlar (menga ko'rsating — sozlab beraman):\n` +
                    `${(balanceResult.debugLines || []).map(l => String(l).slice(0, 200)).join('\n') || '(hech narsa)'}\n\n` +
                    `Rank berilmadi.`,
                    { chat_id: chatId, message_id: messageId }
                );
                rankSessions.delete(userId);
                return;
            }

            if (balance < REQUIRED_BALANCE) {
                // HTML rejimida faqat &, <, > escape qilinadi — entity juftlashish
                // muammosi (Markdown'dagi kabi) bu yerda umuman yuzaga kelmaydi
                await bot.editMessageText(
                    `❌ <code>${escapeHtml(session.player)}</code>da yetarli mablag' yo'q.\n\n` +
                    `Mavjud: ${balance.toLocaleString()}\nKerak: ${REQUIRED_BALANCE.toLocaleString()}\n\n` +
                    `Rank berilmadi, hech narsa yechilmadi.`,
                    { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
                );
                rankSessions.delete(userId);
                return;
            }

            // Mablag' yetarli: yechamiz, guruhga prefix qo'yamiz va o'yinchini guruhga qo'shamiz
            const takeCmd = BALANCE_TAKE_COMMAND
                .replace('{player}', session.player)
                .replace('{amount}', REQUIRED_BALANCE);
            await sendServerCommand(takeCmd);

            const prefix = buildRankPrefix(session);
            // MUHIM: prefiks endi GURUHGA emas, to'g'ridan-to'g'ri O'YINCHIGA
            // qo'yiladi (lp user ... meta setprefix). Avvalgi versiyada
            // "lp group <guruh> meta setprefix" ishlatilgani uchun, ikkita
            // turli o'yinchi bir xil guruhga (masalan "Uzumaki") qo'shilsa,
            // ikkalasi ham GURUHNING umumiy prefiksini ko'rsatardi — kim oxirgi
            // marta shu guruhga rank sotib olsa, uning rangi/so'zi guruh
            // prefiksini qayta yozib, avvalgi xaridor(lar)ning ko'rinishini ham
            // o'zgartirib yuborardi. Endi har bir xarid shaxsiy bo'ladi;
            // guruh esa faqat huquqlar (permissions) uchun ishlatiladi.
            const prefixCmd = `lp user ${session.player} meta setprefix ${PERSONAL_PREFIX_PRIORITY} "${prefix}"`;
            await sendServerCommand(prefixCmd);

            const addCmd = `lp user ${session.player} parent add ${session.group}`;
            await sendServerCommand(addCmd);

            // Keyinchalik "O'chirish (off)" / "Yoqish (on)" tugmalari shu ma'lumotdan
            // foydalanadi — rankni butunlay qaytadan yaratmasdan vaqtincha o'chirib/
            // qaytarib turish mumkin bo'lishi uchun.
            playerRanks.set(session.player.toLowerCase(), {
                originalPlayer: session.player,
                group: session.group,
                prefix
            });
            scheduleSave();

            await bot.editMessageText(
                `✅ Rank muvaffaqiyatli berildi!\n\n` +
                `O'yinchi: <code>${escapeHtml(session.player)}</code>\nGuruh: <code>${escapeHtml(session.group)}</code>\n` +
                `Yechildi: ${REQUIRED_BALANCE.toLocaleString()} (avvalgi balans: ${balance.toLocaleString()})\n` +
                `Kod: <code>${escapeHtml(prefix)}</code>\n\n` +
                `Yuborilgan buyruqlar:\n<code>${escapeHtml(takeCmd)}</code>\n<code>${escapeHtml(prefixCmd)}</code>\n<code>${escapeHtml(addCmd)}</code>\n\n` +
                `⚠️ Eslatma: agar TAB scoreboard'ingiz <code>%luckperms_prefix%</code> emas, guruh nomi bo'yicha qo'lda tuzilgan ro'yxat (switch) ishlatsa, yangi guruh o'sha ro'yxatga ham qo'shilishi kerak bo'ladi.\n\n` +
                `Pastdagi tugmalar orqali bu rankni istalgan payt vaqtincha o'chirib/yoqib turishingiz mumkin:`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...rankToggleKeyboard(session.player) }
            );
        } catch (err) {
            await bot.editMessageText(`❌ Xato: ${escapeHtml(err.message)}`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
        } finally {
            rankSessions.delete(userId);
        }
        return;
    }
}

// ---------------- RANKNI VAQTINCHA O'CHIRISH / YOQISH (ON-OFF) ----------------

// MUHIM: bu yerda o'yinchining LuckPerms GURUHIGA (parent) hech qachon
// tegilmaydi — faqat SHAXSIY (personal) prefiks o'chirilib/qaytariladi.
// "O'chirish" bosilganda o'yinchi guruhda (masalan "imperator", "askar")
// qolaveradi, faqat rangli/effektli maxsus prefiks olib tashlanadi — shu
// bilan o'yinchining prefiksi guruhning o'ziga tegishli oddiy holatiga
// (masalan guruhga LuckPerms'da o'rnatilgan oddiy "Imperator", "Askar" va
// hokazo) qaytadi, u "default"ga tushib qolmaydi.
async function handleRankToggle(query, action) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const isOff = action.startsWith('rank_off_');
    const player = action.replace(isOff ? 'rank_off_' : 'rank_on_', '');
    const data = playerRanks.get(player.toLowerCase());

    if (!data) {
        await bot.answerCallbackQuery(query.id, {
            text: '⚠️ Bu o\'yinchi uchun saqlangan custom rank topilmadi.',
            show_alert: true
        });
        // Alert popup ba'zan ko'zga tashlanmasligi mumkin — shuning uchun
        // xabarni chatga oddiy xabar sifatida ham yuboramiz.
        await bot.sendMessage(
            chatId,
            `⚠️ «${player}» uchun saqlangan custom rank ma'lumoti topilmadi — ehtimol bot qayta ishga tushgandan keyin xotira tozalangan.\n\n` +
            `/rankonf ${player} buyrug'i bilan qayta urinib ko'ring (agar bu ham topolmasa, rankni /rank orqali qayta berish kerak bo'ladi).`
        );
        return;
    }

    if (!isOff && isProtectedPlayer(data.originalPlayer)) {
        await bot.answerCallbackQuery(query.id, {
            text: '⛔ Bu o\'yinchi himoyalangan rankda — custom rank yoqib bo\'lmaydi.',
            show_alert: true
        });
        return;
    }

    await bot.answerCallbackQuery(query.id, { text: isOff ? '🔴 O\'chirilmoqda...' : '🟢 Yoqilmoqda...' });

    try {
        if (isOff) {
            // Faqat shaxsiy prefiksni o'chiramiz — guruh (parent) tegilmaydi,
            // shuning uchun o'yinchi guruhning o'z (oddiy) prefiksida qoladi.
            await sendServerCommand(`lp user ${data.originalPlayer} meta unsetprefix ${PERSONAL_PREFIX_PRIORITY}`);
        } else {
            // Faqat shaxsiy (rangli/effektli) prefiksni qaytaramiz — guruhga
            // qayta qo'shish shart emas, chunki u hech qachon olib tashlanmagan edi.
            await sendServerCommand(`lp user ${data.originalPlayer} meta setprefix ${PERSONAL_PREFIX_PRIORITY} "${data.prefix}"`);
        }

        await bot.editMessageText(
            `${isOff ? '🔴' : '🟢'} <code>${escapeHtml(data.originalPlayer)}</code>ning custom ranki ${isOff ? "o'chirildi" : 'yoqildi'}!\n\n` +
            (isOff
                ? `Endi guruhning (<code>${escapeHtml(data.group)}</code>) o'ziga tegishli oddiy prefiksi ko'rinadi.`
                : `Kod: <code>${escapeHtml(data.prefix)}</code>\nGuruh: <code>${escapeHtml(data.group)}</code>`),
            { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...rankToggleKeyboard(data.originalPlayer) }
        );
    } catch (err) {
        await bot.editMessageText(`❌ Xato: ${escapeHtml(err.message)}`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
    }
}

// ---------------- TUGMA BOSILGANDA ----------------

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const action = query.data;
    const userName = query.from.first_name || query.from.username || 'Kimdir';

    // Rank tugmalari (yaratish, on/off va h.k.) guruhlarda ishlamaydi —
    // guruhda oldindan yuborilgan eski xabarlardagi tugmalar ham rad etiladi.
    if (action.startsWith('rank_') && !isPrivateChat(query.message.chat)) {
        await bot.answerCallbackQuery(query.id, {
            text: '🔒 Rank faqat botning shaxsiy chatida ishlaydi.',
            show_alert: true
        });
        return;
    }

    // Rankni vaqtincha o'chirish/yoqish (on/off) — bu tekshiruv rank_ bilan
    // boshlanadigan umumiy blokdan OLDIN turishi kerak, chunki "rank_off_"
    // va "rank_on_" ham "rank_" bilan boshlanadi.
    if (action.startsWith('rank_off_') || action.startsWith('rank_on_')) {
        await handleRankToggle(query, action);
        return;
    }

    // Rank yaratish jarayoni uchun alohida yo'nalish (hamma uchun ochiq)
    if (action.startsWith('rank_')) {
        if (action === 'rank_start') {
            await bot.answerCallbackQuery(query.id);
            startRankFlow(chatId, userId);
            return;
        }
        await handleRankCallback(query, action);
        return;
    }

    // Admin-only amallarni tekshirish
    const adminOnlyActions = ['stop_server', 'restart_server'];
    if (adminOnlyActions.includes(action) && !isAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, {
            text: '⛔ Bu amal faqat admin uchun!',
            show_alert: true
        });
        return;
    }

    // Cooldown tekshiruvi (suiiste'molni oldini olish uchun)
    const now = Date.now();
    const secondsSinceLastAction = (now - lastActionTime) / 1000;

    if (['start_server', 'stop_server', 'restart_server'].includes(action) && secondsSinceLastAction < COOLDOWN_SECONDS) {
        const wait = Math.ceil(COOLDOWN_SECONDS - secondsSinceLastAction);
        await bot.answerCallbackQuery(query.id, {
            text: `⏳ Iltimos ${wait} soniya kuting, tez-tez bosmang!`,
            show_alert: true
        });
        return;
    }

    try {
        if (action === 'start_server') {
            await bot.answerCallbackQuery(query.id, { text: '🟢 Server yoqilmoqda...' });
            await sendPowerAction('start');
            lastActionTime = now;
            // userName Telegram foydalanuvchi ismi — parse_mode ishlatilmagani uchun
            // undagi _ * ` kabi belgilar xatoga sabab bo'lmaydi
            bot.sendMessage(chatId, `🟢 ${userName} serverni yoqdi!\n\nBir necha soniyadan so'ng onlayn bo'ladi.`);
        }

        else if (action === 'stop_server') {
            await bot.answerCallbackQuery(query.id, { text: '🔴 Server o\'chirilmoqda...' });
            await sendPowerAction('stop');
            lastActionTime = now;
            bot.sendMessage(chatId, `🔴 ${userName} (admin) serverni o'chirdi!`);
        }

        else if (action === 'restart_server') {
            await bot.answerCallbackQuery(query.id, { text: '🔄 Server qayta yuklanmoqda...' });
            await sendPowerAction('restart');
            lastActionTime = now;
            bot.sendMessage(chatId, `🔄 ${userName} (admin) serverni qayta yukladi!`);
        }

        else if (action === 'check_status') {
            await bot.answerCallbackQuery(query.id);
            await sendStatus(chatId, userId, query.message.chat.type);
        }

    } catch (err) {
        await bot.answerCallbackQuery(query.id, { text: `❌ Xato: ${err.message}`, show_alert: true });
    }
});


// ---------------- KONSOLNI KUZATISH: /lp user <ism> parent set <guruh> ----------------
// Owner/admin o'yinda yoki konsolda "lp user X parent set imperator" (yoki boshqa guruh)
// yozganda:
//  1) o'yinchining shaxsiy (custom) prefiksi olib tashlanadi — prefiks yangi
//     guruhning o'zidagi oddiy holatga qaytadi;
//  2) bot xotirasidagi custom rank yozuvi o'chiriladi;
//  3) guruh owner/admin bo'lsa, o'yinchi "himoyalangan" deb belgilanadi (custom rank ishlamaydi);
//     boshqa guruh bo'lsa, himoya olib tashlanadi.
// Botning o'zi rank berganda "parent add" ishlatadi, shuning uchun u bu yerga tushmaydi.
const PARENT_SET_REGEX = /\b(?:lp|luckperms)\s+user\s+(\S+)\s+parent\s+set\s+(\S+)/i;

let prevLogLines = null; // birinchi o'qishda eski loglarni qayta ishlamaslik uchun
let logPollBusy = false;

async function handleParentSet(userToken, group) {
    const key = userToken.toLowerCase();
    playerRanks.delete(key);

    if (isProtectedGroup(group)) protectedPlayers.add(key);
    else protectedPlayers.delete(key);
    scheduleSave();

    try {
        // Xotirada yozuv bo'lmasa ham (bot qayta yoqilgan bo'lsa) shaxsiy prefiks tozalanadi
        await sendServerCommand(`lp user ${userToken} meta unsetprefix ${PERSONAL_PREFIX_PRIORITY}`);
        console.log(`♻️ ${userToken} -> ${group}: shaxsiy prefiks tozalandi${isProtectedGroup(group) ? ' (himoyalangan rank)' : ''}`);
    } catch (err) {
        console.error(`[PARENT SET] ${userToken} prefiksini tozalab bo'lmadi:`, err.message);
    }
}

async function pollConsoleForRankChanges() {
    if (logPollBusy) return;
    logPollBusy = true;
    try {
        const cur = await getConsoleLines();

        if (prevLogLines === null) {
            prevLogLines = cur; // birinchi marta: faqat eslab qolamiz
            return;
        }

        // Yangi qatorlarni topamiz: oldingi oynaning oxiri hozirgi oynaning boshi bilan mos keladigan eng uzun qism
        let overlap = 0;
        for (let k = Math.min(prevLogLines.length, cur.length); k > 0; k--) {
            let same = true;
            for (let i = 0; i < k; i++) {
                if (prevLogLines[prevLogLines.length - k + i] !== cur[i]) { same = false; break; }
            }
            if (same) { overlap = k; break; }
        }
        const fresh = cur.slice(overlap);
        prevLogLines = cur;

        for (const line of fresh) {
            const m = line.match(PARENT_SET_REGEX);
            if (m) await handleParentSet(stripQuotes(m[1]), stripQuotes(m[2]));
        }
    } catch (err) {
        // Server o'chiq bo'lsa yoki API vaqtincha xato bersa — jim o'tkazib yuboramiz
    } finally {
        logPollBusy = false;
    }
}

// Ishga tushirish tartibi: avval ma'lumotlar yuklanadi, keyin bot xabarlarni qabul qila boshlaydi
(async () => {
    await loadData();
    await bot.startPolling();
    setInterval(pollConsoleForRankChanges, LOG_WATCH_INTERVAL_MS);
    console.log('✅ NuqtaMC Control Bot ishga tushdi!');
})();