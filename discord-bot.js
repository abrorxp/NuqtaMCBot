// ===================================================
// NuqtaMC Discord Bot — holat + yoqish/o'chirish (MineStrator API)
// Komandalar: /holat  /yoqish  /panel   |  Faqat admin: /ochirish  /qayta
// Qo'shimcha: bot statusida "3/20 o'yinchi", holat o'zgarsa kanalga e'lon
// ===================================================

require('dotenv').config();
const {
    Client, GatewayIntentBits, ActivityType, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes,
    SlashCommandBuilder, MessageFlags
} = require('discord.js');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // berilsa, komandalar darrov chiqadi
const NOTIFY_CHANNEL_ID = process.env.DISCORD_NOTIFY_CHANNEL_ID || '';
const ADMIN_IDS = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
// Raqamli ID o'rniga Discord username bilan ham admin belgilash mumkin (kichik harfda solishtiriladi)
const ADMIN_USERNAMES = (process.env.DISCORD_ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

const MINESTRATOR_API_KEY = process.env.MINESTRATOR_API_KEY;
const SERVER_ID = process.env.SERVER_ID;
const API_BASE = 'https://mine.sttr.io';

const COOLDOWN_SECONDS = 30;
const STATUS_POLL_MS = 60 * 1000;
let lastActionTime = 0;

if (!DISCORD_TOKEN || !CLIENT_ID || !MINESTRATOR_API_KEY || !SERVER_ID) {
    console.error('XATO: .env da DISCORD_TOKEN, DISCORD_CLIENT_ID, MINESTRATOR_API_KEY va SERVER_ID bo\'lishi kerak!');
    process.exit(1);
}

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e && e.message ? e.message : e));

// ---------------- MINESTRATOR API ----------------

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
    let data = null;
    try { data = await res.json(); } catch (e) { /* json emas */ }
    if (!res.ok) {
        console.error(`[API XATO] ${method} ${path} -> ${res.status}`, JSON.stringify(data));
        const code = data?.api?.error;
        if (code === 'API_VPN_DETECTED') {
            throw new Error('MineStrator bu IP manzilni (VPN/datacenter) blokladi. Bot uy internetidagi kompyuterda ishlashi kerak.');
        }
        throw new Error(data?.api?.description || `API xato: ${res.status}`);
    }
    return data?.api?.data;
}

const getServerLive = () => apiRequest('GET', `/server/${SERVER_ID}/live`);
const sendPowerAction = (action) => apiRequest('PUT', `/server/${SERVER_ID}/poweraction`, { poweraction: action });

// ---------------- YORDAMCHILAR ----------------

const isAdmin = (userId) => ADMIN_IDS.includes(String(userId));
const isAdminUser = (user) => !!user && (isAdmin(user.id) || ADMIN_USERNAMES.includes(String(user.username).toLowerCase()));

function stateLabel(state) {
    return ({
        online: '🟢 Online',
        offline: '🔴 Offline',
        starting: '🟡 Ishga tushmoqda...',
        stopping: '🟠 O\'chmoqda...'
    })[state] || `❔ ${state}`;
}

function stateColor(state) {
    return ({ online: 0x2ecc71, offline: 0xe74c3c, starting: 0xf1c40f, stopping: 0xe67e22 })[state] || 0x95a5a6;
}

async function buildStatusEmbed() {
    const live = await getServerLive();
    const stats = live.stats;
    const embed = new EmbedBuilder()
        .setTitle('📊 NuqtaMC — server holati')
        .setColor(stateColor(live.state))
        .addFields({ name: 'Holat', value: stateLabel(live.state), inline: true })
        .setTimestamp();
    if (live.state === 'online' && stats) {
        embed.addFields(
            { name: 'O\'yinchilar', value: `${stats.players?.current ?? 0}/${stats.players?.limit ?? '?'}`, inline: true },
            { name: 'CPU', value: `${stats.cpu?.percent ?? 0}%`, inline: true },
            { name: 'RAM', value: `${stats.memory?.current ?? 0}/${stats.memory?.limit ?? '?'} MB`, inline: true },
            { name: 'Ishlash vaqti', value: `${stats.uptime?.hours ?? 0} soat ${stats.uptime?.minutes ?? 0} daq`, inline: true }
        );
    }
    return { embed, live };
}

function panelButtons(userId) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_server').setLabel('Yoqish').setEmoji('🟢').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('check_status').setLabel('Holat').setEmoji('📊').setStyle(ButtonStyle.Primary)
    );
    const rows = [row1];
    if (userId && isAdmin(userId)) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('stop_server').setLabel('O\'chirish').setEmoji('🔴').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('restart_server').setLabel('Qayta yuklash').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
        ));
    }
    return rows;
}

// Umumiy panel xabarida (hamma ko'radi) admin tugmalari ko'rinmasin,
// lekin bosilganda baribir admin tekshiriladi. Shuning uchun panelda hammaga
// bir xil tugma qatori: Yoqish/Holat + O'chirish/Qayta (admin bo'lmasa rad etiladi).
function publicPanelButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('start_server').setLabel('Yoqish').setEmoji('🟢').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('check_status').setLabel('Holat').setEmoji('📊').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('stop_server').setLabel('O\'chirish').setEmoji('🔴').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('restart_server').setLabel('Qayta').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
        )
    ];
}

const ACTIONS = {
    start_server:   { api: 'start',   adminOnly: false, done: (n) => `🟢 ${n} serverni yoqdi! Bir necha soniyadan so'ng onlayn bo'ladi.` },
    stop_server:    { api: 'stop',    adminOnly: true,  done: (n) => `🔴 ${n} (admin) serverni o'chirdi!` },
    restart_server: { api: 'restart', adminOnly: true,  done: (n) => `🔄 ${n} (admin) serverni qayta yukladi!` }
};

// Power amalini bajaradi (admin tekshiruvi + cooldown). Matn qaytaradi.
async function runPower(actionKey, user) {
    const cfg = ACTIONS[actionKey];
    if (cfg.adminOnly && !isAdminUser(user)) return { ok: false, text: '⛔ Bu amal faqat adminlar uchun!' };

    const waitLeft = Math.ceil(COOLDOWN_SECONDS - (Date.now() - lastActionTime) / 1000);
    if (waitLeft > 0) return { ok: false, text: `⏳ Iltimos ${waitLeft} soniya kuting, tez-tez bosmang!` };

    try {
        await sendPowerAction(cfg.api);
        lastActionTime = Date.now();
        return { ok: true, text: cfg.done(user.globalName || user.username) };
    } catch (err) {
        return { ok: false, text: `❌ Xato: ${err.message}` };
    }
}

// ---------------- KOMANDALAR ----------------

const commands = [
    new SlashCommandBuilder().setName('holat').setDescription('Server holati va o\'yinchilar soni'),
    new SlashCommandBuilder().setName('yoqish').setDescription('Serverni yoqish'),
    new SlashCommandBuilder().setName('ochirish').setDescription('Serverni o\'chirish (faqat admin)'),
    new SlashCommandBuilder().setName('qayta').setDescription('Serverni qayta yuklash (faqat admin)'),
    new SlashCommandBuilder().setName('panel').setDescription('Boshqaruv panelini (tugmalar bilan) chiqarish')
].map(c => c.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    if (GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('✅ Slash komandalar server uchun ro\'yxatdan o\'tdi (darrov ishlaydi)');
    } else {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Slash komandalar global ro\'yxatdan o\'tdi (chiqishi ~1 soat olishi mumkin; tezroq uchun DISCORD_GUILD_ID yozing)');
    }
}

// ---------------- BOT ----------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('interactionCreate', async (interaction) => {
    try {
        // ----- Slash komandalar -----
        if (interaction.isChatInputCommand()) {
            const name = interaction.commandName;

            if (name === 'holat') {
                await interaction.deferReply();
                try {
                    const { embed } = await buildStatusEmbed();
                    await interaction.editReply({ embeds: [embed] });
                } catch (err) {
                    await interaction.editReply(`❌ Xato: ${err.message}`);
                }
                return;
            }

            if (name === 'panel') {
                await interaction.deferReply();
                try {
                    const { embed } = await buildStatusEmbed();
                    await interaction.editReply({ embeds: [embed], components: publicPanelButtons() });
                } catch (err) {
                    await interaction.editReply({ content: `❌ Xato: ${err.message}`, components: publicPanelButtons() });
                }
                return;
            }

            const map = { yoqish: 'start_server', ochirish: 'stop_server', qayta: 'restart_server' };
            if (map[name]) {
                const adminOnly = ACTIONS[map[name]].adminOnly;
                // Rad etilgan javob faqat so'ragan odamga ko'rinadi
                await interaction.deferReply(adminOnly && !isAdminUser(interaction.user) ? { flags: MessageFlags.Ephemeral } : {});
                const r = await runPower(map[name], interaction.user);
                await interaction.editReply(r.text);
                return;
            }
        }

        // ----- Tugmalar -----
        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'check_status') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    const { embed } = await buildStatusEmbed();
                    await interaction.editReply({ embeds: [embed] });
                } catch (err) {
                    await interaction.editReply(`❌ Xato: ${err.message}`);
                }
                return;
            }

            if (ACTIONS[id]) {
                const adminOnly = ACTIONS[id].adminOnly;
                if (adminOnly && !isAdminUser(interaction.user)) {
                    await interaction.reply({ content: '⛔ Bu amal faqat adminlar uchun!', flags: MessageFlags.Ephemeral });
                    return;
                }
                await interaction.deferReply();
                const r = await runPower(id, interaction.user);
                await interaction.editReply(r.text);
                return;
            }
        }
    } catch (err) {
        console.error('[interaction xato]', err.message);
        try {
            if (interaction.deferred || interaction.replied) await interaction.editReply(`❌ Xato: ${err.message}`);
            else await interaction.reply({ content: `❌ Xato: ${err.message}`, flags: MessageFlags.Ephemeral });
        } catch (e) { /* ignore */ }
    }
});

// ---------------- STATUS + E'LON ----------------

let lastState = null;

async function updatePresenceAndAnnounce() {
    try {
        const live = await getServerLive();
        const state = live.state;
        const cur = live.stats?.players?.current ?? 0;
        const limit = live.stats?.players?.limit ?? '?';

        if (state === 'online') {
            client.user.setPresence({ status: 'online', activities: [{ name: `${cur}/${limit} o'yinchi`, type: ActivityType.Watching }] });
        } else if (state === 'starting') {
            client.user.setPresence({ status: 'idle', activities: [{ name: 'Server yonmoqda...', type: ActivityType.Playing }] });
        } else {
            client.user.setPresence({ status: 'dnd', activities: [{ name: 'Server offline', type: ActivityType.Playing }] });
        }

        // Holat o'zgarganda kanalga e'lon (faqat online <-> offline)
        if (NOTIFY_CHANNEL_ID && lastState && lastState !== state && (state === 'online' || state === 'offline')) {
            const ch = await client.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null);
            if (ch && ch.isTextBased()) {
                await ch.send(state === 'online' ? '🟢 **NuqtaMC server onlayn!** Kirishingiz mumkin.' : '🔴 **NuqtaMC server o\'chdi.**');
            }
        }
        lastState = state;
    } catch (err) {
        client.user.setPresence({ status: 'idle', activities: [{ name: 'Holat noma\'lum', type: ActivityType.Playing }] });
        console.error('[status]', err.message);
    }
}

client.once('clientReady', async () => {
    console.log(`✅ Discord bot ishga tushdi: ${client.user.tag}`);
    try { await registerCommands(); } catch (e) { console.error('[komanda ro\'yxati xato]', e.message); }
    updatePresenceAndAnnounce();
    setInterval(updatePresenceAndAnnounce, STATUS_POLL_MS);
});

client.login(DISCORD_TOKEN);
