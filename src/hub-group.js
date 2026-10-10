import { capture, assertCapture, checkedCommit } from './action-support.js';
// 诸天万界聊天群 (0.6.0) — a QQ-style cross-world group chat inside the terminal.
// Data lives in the chat variables at 诸天系统.聊天群 (follows saves and branches). One user message = one model call,
// answered by 1–6 members. Rules are loose but have a floor: anything a member hands over is clamped to the shop level,
// the member's own tier and never 禁忌 (auto-downgrade, not refusal); every item/point that reaches the host is written
// to the ledger and read back BEFORE the UI says 已入库, with the source “名称@世界”.
import { inert } from './contracts.js';
import { esc, fmtNum } from './hub.js';
import { readConfigs } from './api-center.js';
import * as L from './ledger-ops.js';
import { errorLine } from './errors.js';
import { stripPanels } from './panel-guard.js';

const KEY = '聊天群';
const MAX_MSG = 150, MAX_PM = 30, MAX_MEMBERS = 30;
const today = () => new Date().toLocaleDateString('sv-SE');
const rid = p => p + Math.random().toString(36).slice(2, 9);
const clip = (s, n) => inert(String(s ?? '')).replace(/\s+/g, ' ').trim().slice(0, n);
const num = (x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
export const DEFAULT_RULES = ['红包和赠礼的物品品阶不得高于宿主商城等级，也不得高于赠送者自身实力', '禁忌品禁止在群内流通', '群员不得泄露宿主的系统身份'];
export const POINTS_CAP_BY_SHOP = [0, 2000, 20000, 200000, 2e6, 2e7];
export const QTY_CAP = { 凡品: 5, 灵品: 5, 仙品: 2, 神品: 1, 禁忌: 0 };
export const RECRUIT_FEE = 100;
// 入群费 (0.8.1): its own curve. 0.6–0.8 reused the 神通 复刻 prices (1e3…1e11), so a 星系级 member cost billions.
export const JOIN_PRICE = [0, 300, 1500, 6000, 30000, 200000, 2e6, 3e7, 5e8];
/** Highest 实力档 whose 入群费 fits the budget (at least 1). */
export function affordableTier(points) { let t = 1; for (let i = 1; i < JOIN_PRICE.length; i++) if (JOIN_PRICE[i] <= num(points)) t = i; return t; }
// Inspiration for random recruits, picked locally so two recruits never send the model the same prompt.
export const RECRUIT_SEEDS = ['东方玄幻', '仙侠修真', '武侠江湖', '都市异能', '赛博朋克', '蒸汽朋克', '西幻魔法', '克苏鲁诡异', '末日废土', '星际科幻', '日式动漫', '历史架空', '神话传说', '宫廷权谋', '机甲战争', '校园日常', '海贼冒险', '忍者世界', '魔法少女', '吸血鬼暗夜', '无限流', '游戏异界', '灵异民俗', '妖怪百鬼'];
/** 红包/赠礼 rhythm: members may hand things over only every 3–4 group rounds, unless the host asks for it. */
export const PACKET_ASK = /红包|发包|赠礼|送礼|礼物|送点|给点|打赏/;
export function packetAllowed(g, userText) {
    if (userText && PACKET_ASK.test(userText)) return 'asked';
    return num(g.节奏?.距上次, 99) + 1 >= num(g.节奏?.间隔, 3) ? 'due' : '';
}
export const DAILY_IN = 6, DAILY_OUT = 10;
/** 0.8.2 economy: a member's points packet (the TOTAL, the host grabs one share of it) is capped by that member's own
 *  入群费 as well — a packet worth more than the member cost to recruit made the group a money printer. */
export function packetCap(tier, shop) {
    const t = Math.max(1, Math.min(8, Math.round(num(tier, 1))));
    return Math.min((L.TIERS[t] || L.TIERS[1]).p, POINTS_CAP_BY_SHOP[Math.max(1, Math.min(5, shop))], Math.max(100, JOIN_PRICE[t]));
}
/** 扩建 +5 seats (0.8.2: 1,000 per current seat — was 2,000, out of line with the 300-point 入群费 curve). */
export const expandCost = cap => num(cap, 5) * 1000;
/** 自动闲聊 every N story replies (0.8.2; before: after EVERY reply = one extra model call per message). */
export const CHAT_EVERY = [1, 2, 3, 4, 5, 6, 8, 10];
// 1.1.4 群聊生成设置 (群务 → 群聊生成): how many members answer one message, how long a line may be, how much of the
// log the model sees and the output limit (0 = 自动, sized from the other three).
export const GROUP_SPEAKERS = [1, 2, 3, 4, 5, 6, 8, 10];
export const GROUP_CHARS = [120, 200, 300, 400, 600, 800];
export const GROUP_CONTEXT = [8, 16, 30, 50];
export const GROUP_TOKENS = [0, 1200, 2000, 3000, 4000, 6000, 8000];
export const MAX_ROUNDS = 5;
const pick = (list, v, d) => (list.includes(num(v, NaN)) ? num(v) : d);
/** The group's generation settings, normalized (pure). lo ≤ hi always. */
export function groupGen(set = {}) {
    let lo = pick(GROUP_SPEAKERS, set.发言下限, 1), hi = pick(GROUP_SPEAKERS, set.发言上限, 6);
    if (lo > hi) [lo, hi] = [hi, lo];
    return { lo, hi, chars: pick(GROUP_CHARS, set.单条字数, 300), ctx: pick(GROUP_CONTEXT, set.上下文, 16), tokens: pick(GROUP_TOKENS, set.输出上限, 0) };
}
/** 输出上限「自动」: room for `hi` lines of `chars` characters plus the format, 1200–6000 (pure). */
export function autoTokens(hi, chars) { return Math.max(1200, Math.min(6000, 600 + num(hi, 6) * Math.round(num(chars, 300) + 20))); }
/** A reply cut off by the output limit: the last line is probably half a message — drop it (pure). */
export function dropLastLine(text) {
    const lines = String(text ?? '').replace(/\s+$/, '').split('\n');
    lines.pop(); return lines.join('\n');
}
/** Why the newest round can NOT be re-rolled ('' = it can). Something that already reached the ledger blocks it (pure). */
export function roundBlocked(g, r) {
    if (!r) return '没有可以重新生成的一轮（只能重 roll 1.1.4 之后生成的最近一轮）。';
    for (const id of r.packets || []) if (g.红包[id]?.grabs?.some(x => x.who === 'me')) return '这一轮的红包你已经抢过（已入账），不能重新生成。';
    for (const id of r.gifts || []) if (!g.待领取.some(x => x.id === id)) return '这一轮的赠礼你已经领取（已入库），不能重新生成。';
    return '';
}
/** Takes one round back out of the group: its messages, its unclaimed packets / gifts, today's packet count, the
 *  packet rhythm and the mute turns it used up (only where nothing changed them since). Pure — mutates `g`. */
export function undoRound(g, r) {
    const drop = new Set(r.msgs || []);
    g.消息 = g.消息.filter(m => !drop.has(m.id));
    for (const id of r.packets || []) delete g.红包[id];
    const gifts = new Set(r.gifts || []); g.待领取 = g.待领取.filter(x => !gifts.has(x.id));
    if (g.日计.day === r.prev?.day) g.日计.收 = Math.max(0, num(g.日计.收) - (r.packets || []).length);
    if (r.prev) { g.节奏.距上次 = num(r.prev.距上次, 99); g.节奏.间隔 = Math.max(3, Math.min(4, num(r.prev.间隔, 3))); }
    for (const m of g.成员) { const was = r.prev?.禁言?.[m.id]; if (was !== undefined && num(m.禁言轮) === Math.max(0, num(was) - 1)) m.禁言轮 = num(was); }
    g.轮次 = g.轮次.filter(x => x.id !== r.id);
    return g;
}
/** 1.1.4 删除单条消息 (pure — mutates `g`, returns the removed message). A packet you already grabbed, a packet you sent
 *  (already paid) and a gift you already claimed are ledger records and stay; an unclaimed packet / gift goes with it. */
export function deleteMessage(g, id) {
    const i = g.消息.findIndex(m => m.id === id); if (i < 0) throw Error('这条消息已经不在了。');
    const msg = g.消息[i];
    if (msg.kind === 'packet') {
        const p = g.红包[msg.ref];
        if (p && msg.from === 'me') throw Error('你发出的红包已经扣账并被群员领取，这条记录不能删除。');
        if (p?.grabs?.some(x => x.who === 'me')) throw Error('这个红包你已经抢过（已入账），这条记录不能删除。');
        if (p) { delete g.红包[msg.ref]; if (new Date(num(p.t, Date.now())).toLocaleDateString('sv-SE') === g.日计.day) g.日计.收 = Math.max(0, num(g.日计.收) - 1); }
    } else if (msg.kind === 'gift') {
        const k = g.待领取.findIndex(x => x.id === msg.gift);
        if (k < 0) throw Error('这件赠礼已经领取入库，这条记录不能删除。');
        g.待领取.splice(k, 1);
    }
    g.消息.splice(i, 1);
    for (const r of g.轮次) {
        r.msgs = r.msgs.filter(x => x !== id);
        if (msg.ref) r.packets = (r.packets || []).filter(x => x !== msg.ref);
        if (msg.gift) r.gifts = (r.gifts || []).filter(x => x !== msg.gift);
    }
    g.轮次 = g.轮次.filter(r => r.msgs.length || r.user);
    return msg;
}
const normRound = r => ({
    id: String(r.id), t: num(r.t), user: clip(r.user, 300), story: clip(r.story, 400), cut: !!r.cut,
    msgs: r.msgs.filter(x => typeof x === 'string'), packets: Array.isArray(r.packets) ? r.packets.filter(x => typeof x === 'string') : [],
    gifts: Array.isArray(r.gifts) ? r.gifts.filter(x => typeof x === 'string') : [],
    prev: { 距上次: num(r.prev?.距上次, 99), 间隔: num(r.prev?.间隔, 3), day: String(r.prev?.day || ''), 禁言: r.prev?.禁言 && typeof r.prev.禁言 === 'object' ? r.prev.禁言 : {} },
});
/** Bag items that came through the group (0.8.2: the item itself carries the source, so it never scrolls away). */
export const GROUP_SRC = /^聊天群[·・]/;
export function groupItems(z, g) {
    const known = new Set([...(g?.入库记录 || []).map(r => r.src), ...(g?.成员 || []).map(m => `${m.名称}@${m.世界}`)]);
    return (Array.isArray(z?.背包) ? z.背包 : []).filter(it => it && it.名称 && num(it.数量, 1) > 0 && (GROUP_SRC.test(String(it.来源 || '')) || known.has(String(it.来源 || ''))));
}
/** “聊天群·名称@世界·方式” — what the bag shows and what the story prompt quotes. */
export const groupSource = (src, how) => `聊天群·${src}·${how}`;

/** Recruit prompt (0.8.1). Random mode draws the genre and the target 实力档 locally — the model only fills in a person
 *  — so consecutive recruits really differ, and the target never exceeds what the host can pay for. */
/** 0.9.4 Pure: what a 发布 click really asks for. A name typed while「随机世界」is selected used to be ignored (the
 *  recruit was random anyway) — it now means 指定世界; 指定世界 / 指定角色 without a name is refused before any fee. */
export function recruitMode(mode, hint) {
    const h = String(hint ?? '').trim().slice(0, 30);
    const m = mode === 'world' || mode === 'char' ? mode : 'rand';
    if (m === 'rand') return h ? { mode: 'world', hint: h } : { mode: 'rand', hint: '' };
    if (!h) throw Error(m === 'char' ? '指定角色时请填写角色名。' : '指定世界时请填写世界名。');
    return { mode: m, hint: h };
}
export const RECRUIT_PLACEHOLDER = Object.freeze({ rand: '随机时不用填；输入名字会自动改为「指定世界」', world: '世界名，例如：斗罗大陆', char: '角色名，例如：孙悟空' });
export function recruitPrompt(g, { mode = 'rand', hint = '', budget = 0, maxTier = 1, rand = Math.random } = {}) {
    const tiers = L.TIERS.slice(1).map((t, i) => `${i + 1}=${t.n}`).join('，');
    const seen = [...g.成员.map(m => m.名称), ...(g.候选历史 || [])];
    let want, target = 0, seed = '';
    if (mode === 'char') want = `角色「${clip(hint, 30)}」本人`;
    else {
        const lo = Math.max(1, maxTier - 2); target = lo + Math.floor(rand() * (maxTier - lo + 1));
        seed = RECRUIT_SEEDS[Math.floor(rand() * RECRUIT_SEEDS.length)];
        want = mode === 'world' ? `来自世界「${clip(hint, 30)}」的一名角色` : `一名来自「${seed}」类型世界的角色（知名作品或原创都可以，不要总选最有名的那几个）`;
    }
    const text = `为宿主的聊天群招募${want}。
【不要选】${seen.join('、') || '无'}（已在群里或刚刚出现过，必须换人）
${target ? `【实力档】必须是 ${target}（${(L.TIERS[target] || L.TIERS[1]).n}）。宿主只有 ${fmtNum(num(budget))} 系统点，入群费 ${fmtNum(JOIN_PRICE[target])} 点；不要招募更强的人。` : '按原作设定如实评估实力档。'}
实力档参考：${tiers}。只输出一行，用竖线分隔：名称|出处世界|实力档数字|性格（20字内）|特产（该世界可以当礼物的一种物品，20字内）`;
    return { text, target, seed };
}
/** Story-side prompt: who is in the group, what reached the host through it, and how the story should treat that. */
export function groupStoryPrompt(g, tierName = t => String(t), z = null) {
    const lines = [];
    if (g.成员.length) lines.push(`【诸天聊天群】宿主拥有跨世界聊天群「${g.群名}」（${g.成员.length} 人）：${g.成员.map(m => `${m.名称}（${m.世界}·${tierName(m.档)}）`).join('、')}。群员身处各自的世界，只能通过聊天群（宿主意识里的系统界面）交流、发红包和赠礼。`);
    // 0.8.2: items are read from the BAG (still owned, with their own source) — the old 8-entry log scrolled away and
    // kept listing things already used up. The log still covers points (they are not bag items).
    const items = z ? groupItems(z, g).slice(-12) : [];
    const pts = g.入库记录.filter(r => /系统点/.test(r.what)).slice(-4);
    const fallback = z ? [] : g.入库记录.slice(-8);
    const listed = [...items.map(it => `${it.名称}（${it.品级 || '凡品'}）×${num(it.数量, 1)}（${String(it.来源).replace(GROUP_SRC, '')}）`), ...pts.map(r => `${r.what}（${r.src}，${r.how}）`), ...fallback.map(r => `${r.what}（${r.src}，${r.how}）`)];
    if (listed.length) lines.push(`【聊天群 · 真实入库记录】以下东西是宿主通过聊天群获得、系统已入库的（物品为背包里现有的）：${listed.join('；')}。正文里宿主拿出、使用或提到这些东西时，来历就是诸天聊天群（经系统空间送达），不得改写成捡到、买到、当面赠送等其他来源。`);
    const recent = g.消息.filter(m => m.kind !== 'sys').slice(-4).map(m => `${m.from === 'me' ? '宿主' : (g.成员.find(x => x.id === m.from)?.名称 || '群员')}：${String(m.text).slice(0, 60)}`);
    if (recent.length) lines.push('最近群聊：' + recent.join(' / '));
    if (lines.length) lines.push('聊天群里发生的事是真实的，剧情可以自然衔接（例如宿主看一眼群消息、提起某位群友）；但不要替群员编造没有记录的群聊、红包或赠礼。');
    return lines.join('\n');
}
export function normGroup(g) {
    const x = g && typeof g === 'object' && !Array.isArray(g) ? g : {};
    return {
        v: 1, rev: num(x.rev), 群名: clip(x.群名 || '诸天万界聊天群', 20), 容量: Math.max(5, Math.min(MAX_MEMBERS, num(x.容量, 5))),
        公告: clip(x.公告, 200), 群规: Array.isArray(x.群规) ? x.群规.map(r => clip(r, 80)).filter(Boolean).slice(0, 12) : DEFAULT_RULES.slice(),
        成员: Array.isArray(x.成员) ? x.成员.filter(m => m && m.id && m.名称) : [],
        消息: Array.isArray(x.消息) ? x.消息.slice(-MAX_MSG) : [],
        红包: x.红包 && typeof x.红包 === 'object' ? x.红包 : {},
        待领取: Array.isArray(x.待领取) ? x.待领取 : [],
        签到: { day: x.签到?.day || '', streak: num(x.签到?.streak), total: num(x.签到?.total) },
        挂单: Array.isArray(x.挂单) ? x.挂单 : [], 集市: x.集市 && typeof x.集市 === 'object' ? x.集市 : { day: '', list: [] },
        降临: x.降临 && x.降临.id ? x.降临 : null,
        日计: x.日计?.day === today() ? { day: x.日计.day, 收: num(x.日计.收), 发: num(x.日计.发) } : { day: today(), 收: 0, 发: 0 },
        设置: (() => { const gen = groupGen(x.设置 || {}); return { 自动闲聊: !!x.设置?.自动闲聊, 摘要注入: x.设置?.摘要注入 !== false, 闲聊间隔: CHAT_EVERY.includes(num(x.设置?.闲聊间隔)) ? num(x.设置?.闲聊间隔) : 3, 发言下限: gen.lo, 发言上限: gen.hi, 单条字数: gen.chars, 上下文: gen.ctx, 输出上限: gen.tokens }; })(),
        轮次: Array.isArray(x.轮次) ? x.轮次.filter(r => r && r.id && Array.isArray(r.msgs)).map(normRound).slice(-MAX_ROUNDS) : [],
        私聊: x.私聊 && typeof x.私聊 === 'object' ? x.私聊 : {},
        候选: x.候选 && x.候选.名称 ? x.候选 : null,
        候选历史: Array.isArray(x.候选历史) ? x.候选历史.map(n => clip(n, 20)).filter(Boolean).slice(-12) : [],
        节奏: { 距上次: num(x.节奏?.距上次, 99), 间隔: Math.max(3, Math.min(4, num(x.节奏?.间隔, 3))), 闲聊: Math.max(0, num(x.节奏?.闲聊)) },
        入库记录: Array.isArray(x.入库记录) ? x.入库记录.filter(r => r && r.what).slice(-20) : [],
    };
}
/** 招募: 名称|世界|实力档|性格|特产 */
export function parseRecruit(text) {
    const line = String(text || '').split('\n').map(s => s.trim()).find(s => s.split('|').length >= 4);
    if (!line) return null;
    const [名称, 世界, 档, 性格, 特产] = line.replace(/^[-*\d.、\s]+/, '').split('|').map(s => s.trim());
    const tier = Math.max(1, Math.min(8, Math.round(num(String(档).replace(/[^\d.]/g, ''), 1)) || 1));
    if (!clip(名称, 20)) return null;
    return { 名称: clip(名称, 20), 世界: clip(世界 || '未知世界', 20), 档: tier, 性格: clip(性格, 30), 特产: clip(特产 || '本界土产', 24) };
}
/** “名称/品级/分类/效果” → item (unknown grade → 凡品). */
export function parseItem(spec) {
    const [名称, 品级, 分类, ...rest] = String(spec || '').split(/[/／]/).map(s => s.trim());
    if (!clip(名称, 24)) return null;
    return { 名称: clip(名称, 24), 品级: L.GRADES.includes(品级) ? 品级 : '凡品', 分类: clip(分类 || '其他', 8), 效果: clip(rest.join('/'), 80) };
}
// 1.1.1: models wrote packets the strict 1.0 pattern never matched —「【红包】」, 「[红包] 浸血古铜钱/凡品/… 5枚」(no
// 物品 word), 「5000系统点 3个」, 「1.5万」, 「**@名称**:」, 「@名称（世界）:」. Such lines used to arrive as plain text
// with nothing to grab. Now the tag, the kind and the numbers are read leniently, and a packet that still cannot be
// read says so in the chat instead of silently becoming text.
const PACKET_TAG = /^[[【［]\s*红包\s*[\]】］]\s*/, GIFT_TAG = /^[[【［]\s*赠礼\s*[\]】］]\s*/;
export const PACKET_BROKEN = '（红包格式不完整，未入账）';
/** "5000" / "1.5万" / "2亿" / "10,000" → number (NaN when there is none). */
export function parseAmount(text) {
    const m = /(\d+(?:\.\d+)?)\s*([万亿])?/.exec(String(text ?? '').replace(/[,，](?=\d{3})/g, ''));
    if (!m) return NaN;
    return Math.floor(Number(m[1]) * (m[2] === '亿' ? 1e8 : m[2] === '万' ? 1e4 : 1));
}
const QTY_TAIL = /(?:^|\s+|[×xX*])\s*[×xX*]?\s*(\d{1,3})\s*[枚个件份颗张瓶块把株粒支本套只条]?\s*$|(\d{1,3})\s*[枚个件份颗张瓶块把株粒支本套只条]\s*$/;
/** The part after「[红包]」→ { kind:'points', amount, count } | { kind:'item', spec, qty } | null (unreadable). Pure. */
export function parsePacketBody(text) {
    let t = String(text ?? '').trim();
    const lead = /^(系统点|点数|积分|物品)\s*[:：]?\s*/.exec(t); if (lead) t = t.slice(lead[0].length).trim();
    const kind = lead ? (lead[1] === '物品' ? 'item' : 'points') : t.includes('/') || t.includes('／') ? 'item'
        : /^\d[\d.,，]*\s*[万亿]?\s*(系统点|点|积分)/.test(t) || /^\d[\d.,，]*\s*[万亿]?(\s+\d+\s*个?)?\s*$/.test(t) ? 'points' : 'item';
    if (kind === 'points') {
        const nums = [...t.replace(/[,，](?=\d{3})/g, '').matchAll(/(\d+(?:\.\d+)?)\s*([万亿])?/g)].map(m => parseAmount(m[0]));
        if (!nums.length || !(nums[0] >= 1)) return null;
        return { kind, amount: nums[0], count: nums[1] >= 1 ? Math.floor(nums[1]) : 3 };
    }
    let qty = 1; const q = QTY_TAIL.exec(t);
    if (q) { qty = Number(q[1] || q[2]) || 1; t = t.slice(0, q.index).trim(); }
    if (!t) return null;
    return { kind, spec: t, qty };
}
/** Member reply lines → structured messages, with the hard floor applied. */
export function parseGroupReply(text, members, { cap = '凡品', shop = 1, max = 6, chars = 300 } = {}) {
    const out = [], byName = new Map(members.map(m => [m.名称, m]));
    for (const raw of String(text || '').split('\n')) {
        const line = raw.replace(/\*\*|__/g, '').trim();
        const m = line.match(/^@?\s*([^:：\s][^:：]{0,31})\s*[:：]\s*(.+)$/);
        if (!m) continue;
        const name = m[1].trim(), who = byName.get(name) || byName.get(name.replace(/\s*[（(][^）)]*[）)]\s*$/, '').replace(/^@\s*/, ''));
        if (!who || num(who.禁言轮) > 0) continue;
        const body = m[2].trim(); const msg = { who, text: '' };
        const memberCap = L.giftCap({ 商城等级: shop }, who.档), eff = L.GRADES[Math.min(L.gradeIndex(cap), L.gradeIndex(memberCap))];
        if (PACKET_TAG.test(body)) {
            const rest = body.replace(PACKET_TAG, ''), cut = rest.search(/[|｜]/);
            const spec = (cut >= 0 ? rest.slice(0, cut) : rest).trim(), note = clip((cut >= 0 ? rest.slice(cut + 1) : '').trim() || '恭喜发财', 40);
            const pb = parsePacketBody(spec);
            if (pb?.kind === 'points') {
                const limit = packetCap(who.档, shop), amount = Math.max(1, Math.min(pb.amount, limit));
                msg.packet = { kind: 'points', amount, count: Math.max(1, Math.min(10, pb.count)), note, downgraded: amount < pb.amount };
            } else if (pb?.kind === 'item') {
                const item = parseItem(pb.spec);
                if (item) {
                    const [g, down] = L.clampGrade(item.品级, eff); item.品级 = g;
                    const qty = Math.max(1, Math.min(QTY_CAP[g] || 1, pb.qty));
                    msg.packet = { kind: 'item', item, qty, count: qty, note, downgraded: down };
                }
            }
            msg.text = msg.packet ? note : clip([spec, cut >= 0 ? rest.slice(cut + 1).trim() : ''].filter(Boolean).join(' · ') || '红包', 260) + PACKET_BROKEN;
        } else if (GIFT_TAG.test(body)) {
            const rest = body.replace(GIFT_TAG, ''), cut = rest.search(/[|｜]/);
            const item = parseItem((cut >= 0 ? rest.slice(0, cut) : rest).trim().replace(/^物品\s*[:：]?\s*/, '').replace(QTY_TAIL, ''));
            if (!item) { msg.text = clip(rest, 260) + '（赠礼格式不完整，未入账）'; }
            else {
                const [g, down] = L.clampGrade(item.品级, eff); item.品级 = g;
                msg.gift = { item, note: clip(cut >= 0 ? rest.slice(cut + 1).trim() : '', 60), downgraded: down }; msg.text = msg.gift.note || '送你个小东西。';
            }
        } else msg.text = clip(body, Math.max(60, num(chars, 300)));
        if (msg.text || msg.packet || msg.gift) out.push(msg);
        if (out.length >= max) break;
    }
    return out;
}
/** 1.1.1 补登: an old plain-text message that still carries a「[红包]」line (sent before 1.1.1 could read it). Pure. */
export function rebookable(msg) {
    if (!msg || msg.kind || msg.from === 'me' || msg.from === 'sys' || msg.rebooked) return false;
    const t = String(msg.text || ''); return /[[【［]\s*红包\s*[\]】］]/.test(t) && !t.includes(PACKET_BROKEN);
}
/** 拼手气: `count` positive integer shares summing to `total` (double-mean random, like WeChat). */
export function splitShares(total, count, rand = Math.random) {
    total = Math.floor(total); count = Math.max(1, Math.min(Math.floor(count), total));
    const out = []; let left = total;
    for (let i = count; i > 1; i--) { const maxShare = Math.max(1, Math.floor((left / i) * 2) - 1); const v = Math.max(1, Math.min(left - (i - 1), Math.floor(rand() * maxShare) + 1)); out.push(v); left -= v; }
    out.push(left); return out;
}
export const signReward = (streak, members) => 100 * Math.min(7, Math.max(1, streak)) + 10 * members;

export class HubGroup {
    constructor(app) { this.app = app; this.disposers = []; this.view = 'chat'; this.busy = ''; this.pm = null; this.sheet = null; }
    get hub() { return this.app.hub; }
    get bridge() { return this.app.bridge; }
    get ctx() { return SillyTavern.getContext(); }
    start() {
        const hub = this.hub; if (!hub) return this;
        hub.addNav('万界', 'group', '聊天群', 'chat', { title: '聊天群', render: el => this.render(el) });
        this.el = hub.pages.get('group')?.el; this.el?.classList.add('zt-fill-page');
        this.disposers.push(this.app.adapter.subscribe(() => { this.syncPrompt(); if (this.visible()) this.paint(); }));
        const ev = this.bridge.events, r = this.bridge.eventOn(ev.MESSAGE_RECEIVED || 'message_received', id => this.onStoryReply(id));
        this.disposers.push(() => r.stop());
        this.syncPrompt();
        return this;
    }
    visible() { return this.hub?.isOpen && this.hub.page === 'group'; }
    ledger() { try { return this.bridge.getVariables({ type: 'chat' })?.诸天系统 || null; } catch { return null; } }
    group() { return normGroup(this.ledger()?.[KEY]); }
    member(id) { return this.group().成员.find(m => m.id === id); }
    /** One locked write of the group (and anything else in the ledger), then read back. */
    async write(fn, token) {
        if (token) assertCapture(this.app, token);
        return L.commit(this.bridge, (v, z) => {
            if (token) assertCapture(this.app, token);
            const g = normGroup(z[KEY]); const r = fn(g, z); g.rev = num(g.rev) + 1;
            const keep = new Set(g.消息.map(m => m.ref).filter(Boolean)); for (const id of Object.keys(g.红包)) if (!keep.has(id)) delete g.红包[id];
            z[KEY] = g; return r;
        }, z => [z[KEY]?.rev, z.系统点, (z.背包 || []).length, Object.keys(z.任务库 || {}).length], { expectedIdentity: token?.id });
    }
    say(g, from, text, extra = {}) { const id = rid('g'); g.消息.push({ id, t: Date.now(), from, text: clip(text, Math.max(400, num(g.设置?.单条字数, 300))), ...extra }); if (g.消息.length > MAX_MSG) g.消息.splice(0, g.消息.length - MAX_MSG); return id; }
    /** What reached the host through the group — injected into the story prompt so the AI keeps the real source. */
    booked(g, what, src, how) { g.入库记录.push({ t: Date.now(), what: clip(what, 40), src: clip(src, 40), how }); if (g.入库记录.length > 20) g.入库记录.splice(0, g.入库记录.length - 20); }
    toast(t, ms = 3200, a) { this.hub?.toast(t, ms, a); }
    fail(e) { const line = errorLine(e); this.toast(line, 5500); globalThis.toastr?.warning?.(line, '诸天 · 聊天群'); }
    async ask(system, user, maxTokens = 1200, own = false) {
        const cfg = readConfigs(this.bridge).status || {};
        const custom = cfg.url ? { apiurl: cfg.url, key: cfg.key, model: cfg.model, max_tokens: maxTokens, temperature: 0.85 } : undefined;
        const text = await this.bridge.generateRaw({ user_input: user, ordered_prompts: [{ role: 'system', content: system }, 'user_input'], custom_api: custom, max_tokens: maxTokens, route: 'group', own_limit: !!own });
        if (!String(text || '').trim()) throw Error('模型没有返回内容。');
        return String(text);
    }
    hostName() { return clip(this.ctx.name1 || '宿主', 20); }
    tierName(t) { return (L.TIERS[t] || L.TIERS[1]).n; }
    memberLine(m) { return `- ${m.名称}（${m.世界}·${this.tierName(m.档)}·${m.性格 || '性格未知'}·特产${m.特产}·好感${num(m.好感, 20)}${m.身份 === '管理员' ? '·管理员' : ''}${num(m.禁言轮) > 0 ? '·禁言中' : ''}）`; }

    // ---------- prompt injection ----------
    syncPrompt() {
        try {
            const z = this.ledger(), g = z ? normGroup(z[KEY]) : null, parts = [];
            if (g && g.设置.摘要注入 && (g.成员.length || g.入库记录.length || groupItems(z, g).length)) {
                parts.push(groupStoryPrompt(g, t => this.tierName(t), z));
            }
            if (g?.降临) parts.push(`【诸天聊天群 · 群员降临】${g.降临.名称}（${g.降临.世界}·${this.tierName(g.降临.档)}·${g.降临.性格 || ''}）通过聊天群降临到宿主身边，接下来 ${g.降临.轮} 轮剧情中作为同伴登场，按其性格和原世界能力行动。`);
            const text = parts.join('\n');
            // 1.0: SillyTavern empties its extension prompts when a chat is (re)loaded — compare with what is really there
            if (text === this.lastPrompt && (this.bridge.livePrompt?.('group') ?? text) === text) return; this.lastPrompt = text;
            this.bridge.injectPrompts([{ id: 'group', content: text, position: 'in_chat', depth: 2, role: 'system' }]);
        } catch (e) { console.warn('[诸天聊天群] 注入失败', e); }
    }
    async onStoryReply(id) {
        const c = this.ctx, m = c.chat?.[Number(id)]; if (!m || m.is_user || m.is_system) return;
        let token; try { token = capture(this.app); } catch { return; }
        const g = this.group();
        if (g.降临) {
            try { await this.write(gg => { if (!gg.降临) return; gg.降临.轮 = num(gg.降临.轮) - 1; if (gg.降临.轮 <= 0) { this.say(gg, 'sys', `${gg.降临.名称} 的降临结束，回到了${gg.降临.世界}。`, { kind: 'sys' }); gg.降临 = null; } }, token); this.syncPrompt(); } catch (e) { console.warn(e); }
        }
        if (!g.设置.自动闲聊 || !g.成员.length || this.busy) return;
        // 0.8.2: every N-th story reply only (setting 闲聊间隔, default 3) — not one extra model call per message.
        const every = g.设置.闲聊间隔 || 3, due = num(g.节奏.闲聊) + 1 >= every;
        try { await this.write(gg => { gg.节奏.闲聊 = due ? 0 : num(gg.节奏.闲聊) + 1; }, token); } catch (e) { console.warn(e); return; }
        if (due) this.round(null, stripPanels(m.mes).trim().slice(-400), token).catch(e => console.warn('[诸天聊天群] 自动闲聊失败', e));
    }

    // ---------- chat round: one request, 发言下限–发言上限 members (default 1–6) ----------
    /** `opts.replace` (1.1.4 重roll): the id of the newest round — it is taken back out in the SAME write that books the
     *  new answer, so a failed request leaves the old round untouched. */
    async round(userText, story = '', token = capture(this.app), opts = {}) {
        assertCapture(this.app, token);
        const z0 = this.ledger(); if (!z0) throw Error('当前聊天没有诸天账本。');
        const g0 = normGroup(structuredClone(z0[KEY] ?? {}));
        if (opts.replace) {
            const r0 = g0.轮次.at(-1);
            if (!r0 || r0.id !== opts.replace) throw Error('只能重新生成最近一轮群聊；群里已经有了更新的一轮。');
            const why = roundBlocked(g0, r0); if (why) throw Error(why);
            undoRound(g0, r0);            // the prompt must not see the answer being replaced
        }
        const speakers = g0.成员.filter(m => num(m.禁言轮) <= 0);
        if (!speakers.length) throw Error(g0.成员.length ? '群员都被禁言了。' : '群里还没有群员，先去「群员」页招募。');
        const gen = groupGen(g0.设置), idleHi = Math.min(gen.hi, Math.max(gen.lo, 3)), idleLo = Math.min(gen.lo, idleHi);
        const shop = L.shopLevel(z0), cap = L.GRADES[Math.min(shop, 4) - 1], allow = packetAllowed(g0, userText);
        const packetRule = allow === 'asked' ? '2. 宿主这次主动要了，可以按宿主的要求发红包或赠礼（最多 3 个），格式：'
            : allow ? '2. 本轮可以（不是必须）由 1 位群员发红包或赠礼，最多 1 个，格式：'
            : '2. 本轮【禁止】发红包和赠礼（群里刚发过，节奏是三四轮一次），只聊天。下面的格式本轮不要用：';
        const recent = g0.消息.slice(-gen.ctx).map(m => `${m.from === 'me' ? this.hostName() + '（宿主）' : m.from === 'sys' ? '系统' : (g0.成员.find(x => x.id === m.from)?.名称 || '群员')}: ${String(m.text).slice(0, 120)}`).join('\n');
        const sys = `你是诸天万界聊天群。群里的每位群员来自不同的世界，性格、说话方式和见识都符合原世界。宿主是群主，拥有诸天系统。
回复规则：
1. 选 ${gen.lo === gen.hi ? gen.lo : `${gen.lo}–${gen.hi}`} 位与话题最相关的群员发言（被禁言的不能发言），每条一行、不超过 ${gen.chars} 字，格式严格为：@名称: 内容
${packetRule}
@名称: [红包] 系统点 数额 个数 | 祝福语
@名称: [红包] 物品 名称/品级/分类/效果 数量 | 祝福语
（例：@鹧鸪哨: [红包] 物品 摸金符/灵品/护身法器/辟邪镇煞 3 | 祝群主百无禁忌；系统点红包例：@鹧鸪哨: [红包] 系统点 5000 3 | 恭喜发财）
@名称: [赠礼] 名称/品级/分类/效果 | 附言
3. 物品必须是该群员世界的东西；品级只能是 凡品/灵品/仙品/神品，且不得高于${cap}，也不得高于赠送者的实力；禁忌品禁止。
4. 只输出群聊消息行，不要旁白、不要解释。`;
        const user = `【群】${g0.群名}${g0.公告 ? '｜公告：' + g0.公告 : ''}
【群规】${g0.群规.join('；')}
【宿主】${this.hostName()}，当前世界 ${z0.当前世界 || '未知'}，商城等级 Lv${shop}
【群员】
${g0.成员.map(m => this.memberLine(m)).join('\n')}
【最近消息】
${recent || '（暂无）'}
${userText ? `【宿主刚发】${userText}` : `【宿主没有发言】请根据宿主那边的最新剧情，让 ${idleLo === idleHi ? idleLo : `${idleLo}–${idleHi}`} 位群员自然闲聊。${story ? '\n最新剧情：' + story : ''}`}`;
        this.busy = opts.replace ? '群员正在重新输入…' : '群员正在输入…'; this.paint();
        try {
            const t0 = Date.now();
            let text = await this.ask(sys, user, gen.tokens || autoTokens(gen.hi, gen.chars), !!gen.tokens);
            // 1.1.4 截断: the reply hit the output limit (reported by the independent-API path) → the last line is cut
            const fin = this.bridge.lastFinish, cut = !!fin && num(fin.at) >= t0 && /^(length|max_tokens|max_output_tokens)$/i.test(String(fin.reason || ''));
            if (cut) text = dropLastLine(text);
            let got = 0, dropped = 0;
            const res = await this.write((g, z) => {
                if (opts.replace) {
                    const r = g.轮次.at(-1);
                    if (!r || r.id !== opts.replace) throw Error('只能重新生成最近一轮群聊；群里已经有了更新的一轮。');
                    const why = roundBlocked(g, r); if (why) throw Error(why);
                    undoRound(g, r);
                }
                const rec = { id: rid('rd'), t: Date.now(), user: clip(userText || '', 300), story: userText ? '' : clip(story, 400), cut, msgs: [], packets: [], gifts: [],
                    prev: { 距上次: num(g.节奏.距上次, 99), 间隔: num(g.节奏.间隔, 3), day: g.日计.day, 禁言: Object.fromEntries(g.成员.filter(m => num(m.禁言轮) > 0).map(m => [m.id, num(m.禁言轮)])) } };
                const parsed = parseGroupReply(text, g.成员, { cap, shop, max: gen.hi, chars: gen.chars }); let handed = 0;
                for (const p of parsed) {
                    // Hard floor for the rhythm: the model may ignore the rule, the ledger does not.
                    if ((p.packet || p.gift) && (!allow || handed >= (allow === 'asked' ? 3 : 1))) { dropped++; continue; }
                    if (p.packet || p.gift) handed++;
                    if (p.packet) {
                        if (g.日计.收 >= DAILY_IN) { rec.msgs.push(this.say(g, p.who.id, p.text + '（今日红包已达上限，被群规拦下）')); dropped++; continue; }
                        const id = this.openPacket(g, p.who, p.packet); rec.packets.push(id);
                        rec.msgs.push(this.say(g, p.who.id, p.text, { kind: 'packet', ref: id })); got++;
                    } else if (p.gift) {
                        const gid = rid('gf'); rec.gifts.push(gid);
                        g.待领取.push({ id: gid, from: p.who.id, 名称: p.who.名称, 世界: p.who.世界, item: { ...p.gift.item, 价格: L.TIER_PRICE[p.gift.item.品级] }, note: p.gift.note, downgraded: p.gift.downgraded, t: Date.now() });
                        rec.msgs.push(this.say(g, p.who.id, p.text, { kind: 'gift', gift: gid, label: `${p.gift.item.名称}（${p.gift.item.品级}）${p.gift.downgraded ? ' · 按群规降级' : ''}` })); got++;
                    } else rec.msgs.push(this.say(g, p.who.id, p.text));
                }
                if (cut) rec.msgs.push(this.say(g, 'sys', `⚠ 这一轮回复达到输出上限被截断，最后半条已丢弃。可以点「↻ 重roll」重来，或在 群务 → 群聊生成 调高输出上限 / 调低每条字数。`, { kind: 'sys' }));
                for (const m of g.成员) if (num(m.禁言轮) > 0) m.禁言轮 = num(m.禁言轮) - 1;
                if (got) g.节奏 = { 距上次: 0, 间隔: Math.random() < 0.5 ? 3 : 4 }; else g.节奏.距上次 = Math.min(99, num(g.节奏.距上次) + 1);
                if (rec.msgs.length) { g.轮次.push(rec); if (g.轮次.length > MAX_ROUNDS) g.轮次.splice(0, g.轮次.length - MAX_ROUNDS); }
                return parsed.length;
            }, token);
            if (!res) this.toast(cut ? '回复被输出上限截断，没有一条完整的群消息。请在 群务 → 群聊生成 调高输出上限后重试。' : '群员这次没有按格式回复（模型输出无法解析），可以再发一次。', 5200);
            else if (cut) this.toast('回复被截断：最后半条已丢弃，可以「↻ 重roll」。', 4200);
            else if (got) this.toast(dropped ? '有红包/赠礼到达，部分超出今日上限或节奏。' : '群里有红包或赠礼，点开领取。', 3200);
        } finally { this.busy = ''; this.syncPrompt(); this.paint(); }
    }
    /** 1.1.4 重roll上一轮: same input (your message / the story it reacted to), new answer. */
    async reroll() {
        const token = capture(this.app);
        const g = this.group(), r = g.轮次.at(-1), why = roundBlocked(g, r);
        if (why) throw Error(why);
        if (!globalThis.confirm?.(`重新生成最近一轮群聊？\n这一轮群员的 ${r.msgs.length} 条消息会被新的回复替换${r.packets.length || r.gifts.length ? '（其中没领的红包 / 赠礼一起作废）' : ''}；${r.user ? '你的发言保留。' : '这是一轮自动闲聊。'}`)) return;
        await this.round(r.user || null, r.story || '', token, { replace: r.id });
    }
    /** 1.1.4 删除单条消息 (群聊页「🗑 管理」). */
    async removeMessage(id) {
        const token = capture(this.app), g = this.group(), msg = g.消息.find(m => m.id === id);
        if (msg && (msg.kind === 'packet' || msg.kind === 'gift') && !globalThis.confirm?.(msg.kind === 'packet' ? '删除这条红包消息？没抢的红包会一起作废。' : '删除这条赠礼消息？没领的赠礼会一起作废。')) return;
        await this.write(gg => { deleteMessage(gg, id); }, token);
        this.paint();
    }
    async send(text) {
        text = clip(text, 300); if (!text) return;
        const token = capture(this.app);
        await this.write(g => { this.say(g, 'me', text); }, token);
        assertCapture(this.app, token); this.paint(); await this.round(text, '', token);
    }

    // ---------- red packets & gifts ----------
    /** A member's packet into the group's packet store (counts toward 今日红包). Returns its id. */
    openPacket(g, who, packet) {
        const id = rid('rp'), total = packet.kind === 'points' ? packet.amount : packet.qty;
        const count = Math.max(1, Math.min(packet.count, total, g.成员.length + 1));
        g.红包[id] = { id, from: who.id, kind: packet.kind, total, item: packet.item || null, shares: splitShares(total, count), grabs: [], note: packet.note, downgraded: packet.downgraded, t: Date.now() };
        g.日计.收++; return id;
    }
    /** 1.1.1 补登: a「[红包]」that arrived as plain text before 1.1.1 → a real packet (same caps and daily limit). */
    async rebook(msgId) {
        const token = capture(this.app);
        const out = await this.write((g, z) => {
            const msg = g.消息.find(m => m.id === msgId); if (!rebookable(msg)) throw Error('这条消息不能补登（已补登或不是红包）。');
            const who = g.成员.find(m => m.id === msg.from); if (!who) throw Error('发红包的群员已经退群，无法补登。');
            if (g.日计.收 >= DAILY_IN) throw Error(`今天已经收了 ${DAILY_IN} 个红包（群规上限），明天再补登。`);
            const shop = L.shopLevel(z), cap = L.GRADES[Math.min(shop, 4) - 1], text = String(msg.text);
            const [p] = parseGroupReply(`${who.名称}: ${text.slice(text.search(/[[【［]\s*红包/)).replace(PACKET_BROKEN, '')}`, [{ ...who, 禁言轮: 0 }], { cap, shop });
            if (!p?.packet) throw Error('这条红包缺少数额或物品名，仍然读不出来，无法补登。');
            const id = this.openPacket(g, who, p.packet);
            Object.assign(msg, { kind: 'packet', ref: id, text: p.text, rebooked: true });
            return p.packet.kind === 'points' ? `${fmtNum(p.packet.amount)} 系统点` : `${p.packet.item.名称}（${p.packet.item.品级}）×${p.packet.qty}`;
        }, token);
        this.toast(`已补登红包：${out}，点「抢」领取。`, 3600); this.paint();
    }
    async grab(packetId) {
        const out = await this.write((g, z) => {
            const p = g.红包[packetId]; if (!p) throw Error('红包已过期。');
            if (p.grabs.some(x => x.who === 'me')) throw Error('你已经抢过这个红包了。');
            const left = p.shares.slice(p.grabs.length); if (!left.length) throw Error('手慢了，红包已被抢光。');
            const from = g.成员.find(m => m.id === p.from) || { 名称: '已退群成员', 世界: '未知' };
            const pick = Math.floor(Math.random() * left.length), mine = left.splice(pick, 1)[0];
            p.grabs.push({ who: 'me', v: mine });
            const others = g.成员.filter(m => m.id !== p.from).sort(() => Math.random() - 0.5);
            for (const v of left) { const o = others.shift(); if (!o) break; p.grabs.push({ who: o.id, v }); }
            const src = `${from.名称}@${from.世界}`;
            if (p.kind === 'points') { L.earn(z, mine); } else L.bagAdd(z, { ...p.item, 来源: groupSource(src, '红包'), 价格: L.TIER_PRICE[p.item.品级] }, mine);
            const what = p.kind === 'points' ? `${fmtNum(mine)} 系统点` : `${p.item.名称}（${p.item.品级}）×${mine}`;
            const best = Math.max(...p.grabs.map(x => x.v)) === mine;
            this.say(g, 'sys', `你抢到了 ${src} 的红包：${what}${best ? ' · 手气最佳' : ''} · 已入库`, { kind: 'sys' }); this.booked(g, what, src, '红包');
            return { what, src };
        });
        this.toast(`已入库：${out.what}（来源 ${out.src}）`, 3600); this.app.fx?.play?.({ kind: 'reward', title: '红包已入库', detail: `${out.what} · ${out.src}` });
        this.paint();
    }
    async claim(giftId) {
        const out = await this.write((g, z) => {
            const i = g.待领取.findIndex(x => x.id === giftId); if (i < 0) throw Error('这件礼物已经领过了。');
            const x = g.待领取.splice(i, 1)[0], src = `${x.名称}@${x.世界}`;
            L.bagAdd(z, { ...x.item, 来源: groupSource(src, '赠礼') }, 1);
            const m = g.成员.find(mm => mm.id === x.from); if (m) m.好感 = Math.min(100, num(m.好感, 20) + 1);
            this.say(g, 'sys', `你领取了 ${src} 的赠礼：${x.item.名称}（${x.item.品级}）· 已入库`, { kind: 'sys' }); this.booked(g, `${x.item.名称}（${x.item.品级}）`, src, '赠礼');
            return { what: `${x.item.名称}（${x.item.品级}）`, src };
        });
        this.toast(`已入库：${out.what}（来源 ${out.src}）`, 3600); this.app.fx?.play?.({ kind: 'reward', title: '赠礼已入库', detail: `${out.what} · ${out.src}` });
        this.paint();
    }
    /** Host sends a packet: points or a bag item. Members grab it at once; each grabber likes the host more; some send a thank-you gift (待领取). */
    async sendPacket({ kind, amount, count, bagIndex, qty, note }) {
        const out = await this.write((g, z) => {
            if (!g.成员.length) throw Error('群里还没有群员。');
            if (g.日计.发 >= DAILY_OUT) throw Error(`今天已经发了 ${DAILY_OUT} 个红包，明天再发吧。`);
            let total, item = null;
            if (kind === 'points') { total = Math.floor(num(amount)); if (total < 1) throw Error('红包金额至少 1 系统点。'); L.spend(z, total); }
            else { const taken = L.bagTake(z, Math.floor(num(bagIndex, -1)), Math.max(1, Math.floor(num(qty, 1)))); if (taken.品级 === '禁忌') throw Error('禁忌品禁止在群内流通。'); item = { 名称: taken.名称, 品级: taken.品级, 分类: taken.分类, 效果: taken.效果 }; total = taken.数量; }
            const n = Math.max(1, Math.min(Math.floor(num(count, 3)), total, g.成员.length));
            const id = rid('rp'), shares = splitShares(total, n), grabbers = g.成员.slice().sort(() => Math.random() - 0.5).slice(0, n);
            g.红包[id] = { id, from: 'me', kind, total, item, shares, grabs: grabbers.map((m, i) => ({ who: m.id, v: shares[i] })), note: clip(note || '大家辛苦了', 40), t: Date.now() };
            g.日计.发++; this.say(g, 'me', clip(note || '大家辛苦了', 40), { kind: 'packet', ref: id });
            const thanks = [];
            grabbers.forEach((m, i) => {
                const gain = Math.min(8, 2 + Math.floor((kind === 'points' ? shares[i] : shares[i] * L.TIER_PRICE[item.品级]) / Math.max(100, (L.TIERS[m.档] || L.TIERS[1]).p / 20)));
                m.好感 = Math.min(100, num(m.好感, 20) + gain);
                if (Math.random() < 0.3 + num(m.好感, 20) / 400) {
                    const [grade] = L.clampGrade(L.GRADES[Math.max(0, L.gradeIndex(L.giftCap(z, m.档)) - (Math.random() < 0.6 ? 1 : 0))], L.giftCap(z, m.档));
                    const gid = rid('gf'), gi = { 名称: m.特产 || `${m.世界}土产`, 品级: grade, 分类: '其他', 效果: `来自${m.世界}的回礼`, 价格: L.TIER_PRICE[grade] };
                    g.待领取.push({ id: gid, from: m.id, 名称: m.名称, 世界: m.世界, item: gi, note: '谢谢群主的红包！', t: Date.now() });
                    this.say(g, m.id, '谢谢群主！一点心意，收下吧。', { kind: 'gift', gift: gid, label: `${gi.名称}（${gi.品级}）` }); thanks.push(m.名称);
                } else this.say(g, m.id, ['谢谢老板！', '手气不错～', '群主大气！', '收到，多谢。'][i % 4]);
            });
            return { n, thanks };
        });
        this.toast(`红包已发出，${out.n} 位群员抢到${out.thanks.length ? `；${out.thanks.join('、')} 回了礼（待领取）` : ''}。`, 4200);
        this.sheet = null; this.paint();
    }

    // ---------- members ----------
    async recruit(rawMode, rawHint) {
        if (this.busy) throw Error('已有聊天群操作正在进行。');
        const token = capture(this.app), { mode, hint } = recruitMode(rawMode, rawHint);
        const z = this.ledger(), g = normGroup(z[KEY]);
        if (g.成员.length >= g.容量) throw Error(`群已满（${g.容量}人）。`);
        if (num(z.系统点) < RECRUIT_FEE) throw Error('系统点不足，未发送招募。');
        const history = [...g.候选历史, ...(g.候选 ? [g.候选.名称] : [])].slice(-12);
        const g1 = { ...g, 候选历史: history }, budget = num(z.系统点) - RECRUIT_FEE, maxTier = affordableTier(budget);
        const prompt = recruitPrompt(g1, { mode, hint, budget, maxTier });
        const avoid = new Set([...g.成员.map(m => m.名称), ...(mode === 'char' ? [] : history)]);
        this.busy = '招募生成中（未扣系统点）…'; this.paint();
        let committing = false;
        try {
            let card = parseRecruit(await this.ask('你是诸天万界聊天群的招募系统。', prompt.text, 4096));
            if (!card || avoid.has(card.名称) || (prompt.target && card.档 > maxTier)) {
                card = parseRecruit(await this.ask('你是诸天万界聊天群的招募系统。', prompt.text + '\n上次回答格式错误、人物重复或超过实力档，请重新输出符合条件的一行。', 4096));
            }
            assertCapture(this.app, token);
            if (!card || avoid.has(card.名称) || (prompt.target && card.档 > maxTier)) throw Error('未得到有效且不重复、符合要求的招募候选。');
            committing = true;
            await checkedCommit(this.app, token, zz => {
                const gg = normGroup(zz[KEY]);
                if (gg.rev !== g.rev || gg.成员.length >= gg.容量 || gg.成员.some(m => m.名称 === card.名称)) throw Error('聊天群状态已变化，未扣费，请重新招募。');
                L.spend(zz, RECRUIT_FEE); gg.候选历史 = history; gg.候选 = { ...card, t: Date.now(), 超预算: card.档 > affordableTier(num(zz.系统点)) }; gg.rev = num(gg.rev) + 1; zz[KEY] = gg;
            });
        } catch (e) { throw Error(e.message + (committing ? '' : '（未扣招募系统点，API调用可能计费）')); }
        finally { this.busy = ''; this.paint(); }
    }
    joinPrice(c) { return JOIN_PRICE[Math.max(1, Math.min(8, c.档 | 0))] || JOIN_PRICE[1]; }
    async invite() {
        const out = await this.write((g, z) => {
            const c = g.候选; if (!c) throw Error('没有候选人。');
            if (g.成员.length >= g.容量) throw Error(`群已满（${g.容量} 人）。`);
            const price = this.joinPrice(c);
            if (num(z.系统点) < price) throw Error(`入群费 ${fmtNum(price)} 点，当前只有 ${fmtNum(num(z.系统点))} 点。可以「放弃」再招募一位实力档低一些的。`);
            L.spend(z, price);
            const m = { id: rid('m'), 名称: c.名称, 世界: c.世界, 档: c.档, 性格: c.性格, 特产: c.特产, 好感: 20, 身份: '群员', 禁言轮: 0, 加入: Date.now() };
            g.成员.push(m); g.候选 = null; this.say(g, 'sys', `${m.名称}（${m.世界}·${this.tierName(m.档)}）加入了群聊。`, { kind: 'sys' });
            return m;
        });
        this.toast(`${out.名称} 已入群。`, 3000); this.syncPrompt(); this.paint();
    }
    async expand() {
        const out = await this.write((g, z) => { if (g.容量 >= MAX_MEMBERS) throw Error('已经是最大容量。'); const cost = expandCost(g.容量); L.spend(z, cost); g.容量 += 5; this.say(g, 'sys', `群扩建到 ${g.容量} 人。`, { kind: 'sys' }); return { cost, cap: g.容量 }; });
        this.toast(`已扩建到 ${out.cap} 人（${fmtNum(out.cost)} 点）。`); this.paint();
    }
    async admin(id, act) {
        await this.write(g => {
            const i = g.成员.findIndex(m => m.id === id); if (i < 0) throw Error('群员不存在。'); const m = g.成员[i];
            if (act === 'kick') { g.成员.splice(i, 1); this.say(g, 'sys', `${m.名称} 被移出了群聊。`, { kind: 'sys' }); if (g.降临?.id === id) g.降临 = null; }
            else if (act === 'mute') { m.禁言轮 = num(m.禁言轮) > 0 ? 0 : 3; this.say(g, 'sys', m.禁言轮 ? `${m.名称} 被禁言 3 轮。` : `${m.名称} 的禁言解除了。`, { kind: 'sys' }); }
            else if (act === 'op') { m.身份 = m.身份 === '管理员' ? '群员' : '管理员'; this.say(g, 'sys', `${m.名称} ${m.身份 === '管理员' ? '成为了管理员' : '不再是管理员'}。`, { kind: 'sys' }); }
        });
        this.syncPrompt(); this.paint();
    }
    descendCost(m) { return Math.max(100, Math.floor((L.TIERS[m.档] || L.TIERS[1]).p / 10)); }
    async descend(id, turns = 3) {
        const out = await this.write((g, z) => {
            const m = g.成员.find(x => x.id === id); if (!m) throw Error('群员不存在。');
            if (g.降临) throw Error(`${g.降临.名称} 正在降临中。`);
            const cost = this.descendCost(m); L.spend(z, cost);
            g.降临 = { id: m.id, 名称: m.名称, 世界: m.世界, 档: m.档, 性格: m.性格, 轮: turns };
            this.say(g, 'sys', `${m.名称} 通过聊天群降临到宿主身边（${turns} 轮）。`, { kind: 'sys' }); return { m, cost };
        });
        this.syncPrompt(); this.toast(`${out.m.名称} 已降临（${fmtNum(out.cost)} 点），会在接下来 3 轮剧情里登场。`, 4200); this.paint();
    }
    async privateSay(id, text) {
        const token = capture(this.app);
        text = clip(text, 300); if (!text) return; const m = this.member(id); if (!m) throw Error('群员不存在。');
        const log = (this.group().私聊[id] || []).slice(-10).map(x => `${x.me ? '宿主' : m.名称}: ${x.text}`).join('\n');
        this.busy = `${m.名称} 正在输入…`; this.paint();
        try {
            const reply = await this.ask(`你是诸天万界聊天群的群员私聊：你扮演 ${m.名称}（${m.世界}·${this.tierName(m.档)}·${m.性格}），正在和群主私聊。只输出 ${m.名称} 的一段回复，不要旁白，不超过 120 字。`, `对宿主的好感：${num(m.好感, 20)}/100\n${log ? '最近私聊：\n' + log + '\n' : ''}宿主：${text}`, 400);
            await this.write(g => { const arr = g.私聊[id] = Array.isArray(g.私聊[id]) ? g.私聊[id] : []; arr.push({ me: true, text, t: Date.now() }, { me: false, text: clip(reply.replace(/^.{0,24}[:：]\s*/, ''), 300), t: Date.now() }); if (arr.length > MAX_PM) arr.splice(0, arr.length - MAX_PM); }, token);
        } finally { this.busy = ''; this.paint(); }
    }

    // ---------- daily / market / help / live ----------
    async signIn() {
        const out = await this.write((g, z) => {
            if (g.签到.day === today()) throw Error('今天已经签到过了。');
            const y = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE');
            g.签到.streak = g.签到.day === y ? g.签到.streak + 1 : 1; g.签到.day = today(); g.签到.total++;
            const pts = signReward(g.签到.streak, g.成员.length); L.earn(z, pts);
            this.say(g, 'sys', `签到成功：连续 ${g.签到.streak} 天，+${pts} 系统点 · 已入库`, { kind: 'sys' }); this.booked(g, `${pts} 系统点`, '群签到', '签到'); return { pts, streak: g.签到.streak };
        });
        this.toast(`签到 +${out.pts} 系统点（连续 ${out.streak} 天）· 已入库`); this.paint();
    }
    marketList(g, z) {
        if (g.集市.day === today() && Array.isArray(g.集市.list)) return g.集市.list;
        const list = g.成员.map(m => { const grade = L.giftCap(z, m.档); const price = Math.round(L.TIER_PRICE[grade] * (0.8 + Math.random() * 0.7)); return { id: rid('mk'), from: m.id, 名称: m.名称, 世界: m.世界, item: { 名称: m.特产 || `${m.世界}土产`, 品级: grade, 分类: '其他', 效果: `${m.世界}特产` }, price }; });
        g.集市 = { day: today(), list }; return list;
    }
    async refreshMarket() { await this.write((g, z) => { g.集市 = { day: '', list: [] }; this.marketList(g, z); }); this.paint(); }
    async buy(id) {
        const out = await this.write((g, z) => {
            const list = this.marketList(g, z), i = list.findIndex(x => x.id === id); if (i < 0) throw Error('这件货已经卖掉了。');
            const x = list[i]; L.spend(z, x.price); L.bagAdd(z, { ...x.item, 来源: groupSource(`${x.名称}@${x.世界}`, '集市购买'), 价格: x.price }, 1); list.splice(i, 1);
            this.say(g, 'sys', `你从 ${x.名称}@${x.世界} 买下 ${x.item.名称}（${x.item.品级}）· ${fmtNum(x.price)} 点 · 已入库`, { kind: 'sys' }); this.booked(g, `${x.item.名称}（${x.item.品级}）`, `${x.名称}@${x.世界}`, '集市购买'); return x;
        });
        this.toast(`已入库：${out.item.名称}（来源 ${out.名称}@${out.世界}）`); this.paint();
    }
    valueOf(it) { return num(it.价格) || L.TIER_PRICE[it.品级] || 100; }
    async listForSale(bagIndex, price) {
        await this.write((g, z) => {
            const it = L.bagTake(z, Math.floor(num(bagIndex, -1)), 1); if (it.品级 === '禁忌') throw Error('禁忌品禁止在群内流通。');
            const p = Math.max(1, Math.floor(num(price) || this.valueOf(it)));
            g.挂单.push({ id: rid('sl'), item: it, price: p, value: this.valueOf(it), t: Date.now() });
            this.say(g, 'me', `挂单出售 ${it.名称}（${it.品级}），${fmtNum(p)} 系统点，有意私聊。`, { kind: 'trade' });
        });
        this.paint();
    }
    async hawk(id) {
        const out = await this.write((g, z) => {
            const i = g.挂单.findIndex(x => x.id === id); if (i < 0) throw Error('挂单不存在。'); const s = g.挂单[i];
            if (!g.成员.length) throw Error('群里没人能买。');
            if (s.price > s.value * 1.3) { const m = g.成员[Math.floor(Math.random() * g.成员.length)]; this.say(g, m.id, `${s.item.名称}？这价格有点高了，便宜点再说。`); return { sold: false, who: m.名称 }; }
            const m = g.成员[Math.floor(Math.random() * g.成员.length)]; g.挂单.splice(i, 1); L.earn(z, s.price);
            this.say(g, m.id, `${s.item.名称}我要了！`); this.booked(g, `卖出 ${s.item.名称} 得 ${fmtNum(s.price)} 系统点`, `${m.名称}@${m.世界}`, '集市出售'); this.say(g, 'sys', `${m.名称}@${m.世界} 买下了 ${s.item.名称}，+${fmtNum(s.price)} 系统点 · 已入库`, { kind: 'sys' });
            return { sold: true, who: m.名称, price: s.price };
        });
        this.toast(out.sold ? `${out.who} 买下了，+${fmtNum(out.price)} 系统点 · 已入库` : `${out.who} 嫌贵（超过原版估值 30%）。`); this.paint();
    }
    async unlist(id) {
        await this.write((g, z) => { const i = g.挂单.findIndex(x => x.id === id); if (i < 0) return; const s = g.挂单.splice(i, 1)[0]; L.bagAdd(z, s.item, s.item.数量 || 1); });
        this.paint();
    }
    async help(text, memberId) {
        const token = capture(this.app);
        text = clip(text, 200); if (!text) throw Error('先写下要求助的事。');
        const g0 = this.group(), m = g0.成员.find(x => x.id === memberId) || g0.成员[Math.floor(Math.random() * g0.成员.length)];
        if (!m) throw Error('群里还没有群员。');
        this.busy = `${m.名称} 正在想办法…`; this.paint();
        try {
            const reply = await this.ask('你是诸天万界聊天群的任务发布系统。', `宿主在群里求助：「${text}」。回应者：${m.名称}（${m.世界}·${this.tierName(m.档)}）。
把这次求助变成一个宿主可以去完成的任务。只输出一行，用竖线分隔：任务名称（12字内）|任务内容（60字内，写清楚去哪、做什么）|奖励（例如 3000 系统点，或某件物品）`, 4096);
            const [名称, 内容, 奖励] = (String(reply).split('\n').find(s => s.includes('|')) || '').split('|').map(s => clip(s, 80));
            if (!名称) throw Error('没有生成有效的任务（模型输出无法解析）。');
            const task = await this.write((g, z) => {
                z.任务库 = z.任务库 && typeof z.任务库 === 'object' && !Array.isArray(z.任务库) ? z.任务库 : {};
                const ID = rid('grp_').replace(/[^A-Za-z0-9_-]/g, '');
                z.任务库[ID] = { ID, 名称: 名称.slice(0, 24), 内容: 内容 || text, 奖励: 奖励 || '未记录奖励', 完成度: 0, 类型: '短期', 状态: '待接取', 来源: `聊天群求助 · ${m.名称}@${m.世界}` };
                this.say(g, 'me', `求助：${text}`); this.say(g, m.id, `这事我有办法。任务「${名称}」发你了：${内容}`, { kind: 'task', task: ID });
                return z.任务库[ID];
            }, token);
            this.toast(`任务「${task.名称}」已进入任务库（待接取）。`, 3600, { label: '去任务页', run: () => this.hub.go('task') });
        } finally { this.busy = ''; this.paint(); }
    }
    async live(memberId) {
        const token = capture(this.app);
        const g0 = this.group(), m = g0.成员.find(x => x.id === memberId) || g0.成员[Math.floor(Math.random() * g0.成员.length)];
        if (!m) throw Error('群里还没有群员。');
        this.busy = `${m.名称} 正在开播…`; this.paint();
        try {
            const reply = await this.ask('你是诸天万界聊天群的群直播。', `${m.名称}（${m.世界}·${this.tierName(m.档)}·${m.性格}）在群里开了一场直播，给宿主看自己世界此刻正在发生的事。用第三人称写 3–5 行直播画面，每行不超过 50 字，只输出画面描述。`, 500);
            const lines = String(reply).split('\n').map(s => clip(s, 80)).filter(Boolean).slice(0, 5);
            if (!lines.length) throw Error('直播信号中断了（模型没有返回内容）。');
            await this.write(g => { this.say(g, m.id, lines.join('\n'), { kind: 'live' }); }, token);
        } finally { this.busy = ''; this.paint(); }
    }
    async saveMeta(patch) {
        await this.write(g => {
            if ('群名' in patch) g.群名 = clip(patch.群名 || '诸天万界聊天群', 20);
            if ('公告' in patch) g.公告 = clip(patch.公告, 200);
            if ('群规' in patch) g.群规 = String(patch.群规).split('\n').map(s => clip(s, 80)).filter(Boolean).slice(0, 12);
            if ('自动闲聊' in patch) g.设置.自动闲聊 = !!patch.自动闲聊;
            if ('摘要注入' in patch) g.设置.摘要注入 = !!patch.摘要注入;
            if ('闲聊间隔' in patch && CHAT_EVERY.includes(num(patch.闲聊间隔))) { g.设置.闲聊间隔 = num(patch.闲聊间隔); g.节奏.闲聊 = 0; }
            // 1.1.4 群聊生成: only listed values; 下限 > 上限 pulls the other one along
            if ('发言下限' in patch && GROUP_SPEAKERS.includes(num(patch.发言下限))) { g.设置.发言下限 = num(patch.发言下限); if (g.设置.发言上限 < g.设置.发言下限) g.设置.发言上限 = g.设置.发言下限; }
            if ('发言上限' in patch && GROUP_SPEAKERS.includes(num(patch.发言上限))) { g.设置.发言上限 = num(patch.发言上限); if (g.设置.发言下限 > g.设置.发言上限) g.设置.发言下限 = g.设置.发言上限; }
            if ('单条字数' in patch && GROUP_CHARS.includes(num(patch.单条字数))) g.设置.单条字数 = num(patch.单条字数);
            if ('上下文' in patch && GROUP_CONTEXT.includes(num(patch.上下文))) g.设置.上下文 = num(patch.上下文);
            if ('输出上限' in patch && GROUP_TOKENS.includes(num(patch.输出上限))) g.设置.输出上限 = num(patch.输出上限);
        });
        this.syncPrompt(); this.paint();
    }

    // ---------- UI ----------
    render(el) { this.el = el; this.paint(true); }
    paint(force = false) {
        const el = this.el; if (!el || (!force && !this.visible())) return;
        const z = this.ledger();
        if (!z) { el.innerHTML = `<div class="zt-empty">当前聊天没有诸天账本。<br>在「设置 → 新聊天初始化」创建后，就能建立诸天万界聊天群。</div>`; return; }
        const g = normGroup(z[KEY]), keepScroll = el.querySelector('.zt-g-log'), atBottom = !keepScroll || keepScroll.scrollHeight - keepScroll.scrollTop - keepScroll.clientHeight < 40;
        const draft = el.querySelector('#zt-g-input')?.value || '';
        const oldInput = el.querySelector('#zt-g-input'), hadFocus = !!oldInput && el.getRootNode?.().activeElement === oldInput, caret = hadFocus ? oldInput.selectionStart : null, oldTop = keepScroll?.scrollTop || 0;
        const tabs = [['chat', '聊天'], ['members', `群员 ${g.成员.length}/${g.容量}`], ['market', '集市'], ['admin', '群务']];
        el.innerHTML = `<div class="zt-g">
<header class="zt-g-head"><div><b>${esc(g.群名)}</b><small>${g.成员.length} 位群员 · 商城 Lv${L.shopLevel(z)} · 红包上限 ${L.GRADES[Math.min(L.shopLevel(z), 4) - 1]}</small></div>
<nav class="zt-g-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" data-gtab="${k}" aria-selected="${this.view === k}">${esc(t)}</button>`).join('')}</nav></header>
${g.待领取.length ? `<div class="zt-g-claims"><span>🎁 待领取 ${g.待领取.length}</span>${g.待领取.slice(0, 6).map(x => `<button type="button" class="zt-btn small primary" data-claim="${x.id}">${esc(x.item.名称)}（${x.item.品级}）· ${esc(x.名称)}${x.downgraded ? ' · 已按群规降级' : ''}</button>`).join('')}</div>` : ''}
<div class="zt-g-body">${this.view === 'members' ? this.membersView(g, z) : this.view === 'market' ? this.marketView(g, z) : this.view === 'admin' ? this.adminView(g) : this.chatView(g, z)}</div></div>`;
        const input = el.querySelector('#zt-g-input'); if (input) { input.value = draft; if (hadFocus) { try { input.focus({ preventScroll: true }); input.setSelectionRange(caret, caret); } catch { } } }
        const log = el.querySelector('.zt-g-log'); if (log) log.scrollTop = atBottom ? log.scrollHeight : oldTop;
        if (!this.bound) { this.bound = true; el.addEventListener('click', e => this.onClick(e)); el.addEventListener('change', e => { const sel = e.target.closest?.('[data-g-sel=every]'); if (sel) this.saveMeta({ 闲聊间隔: Number(sel.value) }).catch(err => this.fail(err)); const gs = e.target.closest?.('[data-g-set]'); if (gs) this.saveMeta({ [gs.dataset.gSet]: Number(gs.value) }).catch(err => this.fail(err)); if (e.target.matches?.('[data-f=rmode]')) this.recruitModeChanged(); }); el.addEventListener('input', e => { if (e.target.matches?.('[data-f=rhint]')) this.recruitHintTyped(); }); el.addEventListener('keydown', e => { if (e.target.id === 'zt-g-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.querySelector('[data-g=send]')?.click(); } }); }
    }
    avatar(m) { const h = [...String(m?.名称 || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360; return `<span class="zt-g-av" style="background:hsl(${h} 45% 38%)">${esc(String(m?.名称 || '?').slice(0, 1))}</span>`; }
    chatView(g, z) {
        const name = id => g.成员.find(m => m.id === id);
        const rows = g.消息.map(msg => {
            const del = this.manage ? `<button type="button" class="zt-btn small zt-g-del" data-gdel="${esc(msg.id)}" title="删除这条消息" aria-label="删除这条消息">🗑</button>` : '';
            if (msg.kind === 'sys' || msg.from === 'sys') return `<div class="zt-g-sys">${esc(msg.text)}${del}</div>`;
            const me = msg.from === 'me', m = me ? null : name(msg.from) || { 名称: '已退群', 世界: '' };
            let body = `<div class="zt-g-text">${esc(msg.text).replace(/\n/g, '<br>')}</div>`;
            if (rebookable(msg)) body += `<div class="zt-g-gift">🧧 这条红包当时没能识别 <button type="button" class="zt-btn small" data-rebook="${esc(msg.id)}">补登</button></div>`;
            if (msg.kind === 'packet') {
                const p = g.红包[msg.ref];
                const mine = p?.grabs.find(x => x.who === 'me'), left = p ? p.shares.length - p.grabs.length : 0;
                const what = p?.kind === 'points' ? `${fmtNum(p.total)} 系统点 · ${p.shares.length} 个` : p ? `${esc(p.item?.名称)}（${p.item?.品级}）×${p.total}` : '';
                const state = !p ? '已过期' : me ? `已被 ${p.grabs.length} 人抢到` : mine ? `已抢到 ${p.kind === 'points' ? fmtNum(mine.v) + ' 点' : '×' + mine.v} · 已入库` : left ? '' : '已被抢光';
                body = `<div class="zt-g-packet${state ? ' done' : ''}"><b>🧧 ${esc(msg.text)}</b><small>${what}${p?.downgraded ? ' · 已按群规降级' : ''}</small>${!me && p && !mine && left ? `<button type="button" class="zt-btn small" data-grab="${p.id}">抢</button>` : `<em>${esc(state)}</em>`}</div>`;
            } else if (msg.kind === 'gift') {
                const pending = g.待领取.some(x => x.id === msg.gift);
                body += `<div class="zt-g-gift">🎁 ${esc(msg.label || '赠礼')} ${pending ? `<button type="button" class="zt-btn small primary" data-claim="${msg.gift}">领取</button>` : '<em>已领取</em>'}</div>`;
            } else if (msg.kind === 'live') body = `<div class="zt-g-live"><b>● 直播中</b>${esc(msg.text).replace(/\n/g, '<br>')}</div>`;
            else if (msg.kind === 'task') body += `<div class="zt-g-gift">📜 已进入任务库 <button type="button" class="zt-btn small" data-g="to-task">查看</button></div>`;
            return `<div class="zt-g-msg${me ? ' me' : ''}">${me ? '' : this.avatar(m)}<div class="zt-g-bub">${me ? '' : `<div class="zt-g-who">${esc(m.名称)}<small>${esc(m.世界 || '')}${m.档 ? ' · ' + esc(this.tierName(m.档)) : ''}</small></div>`}${body}</div>${del}</div>`;
        }).join('');
        const sheet = this.sheet === 'packet' ? this.packetSheet(z) : this.sheet === 'help' ? this.helpSheet(g) : '';
        return `<div class="zt-g-log" aria-live="polite">${g.公告 ? `<div class="zt-g-notice">📌 ${esc(g.公告)}</div>` : ''}${rows || `<div class="zt-empty">${g.成员.length ? '说点什么吧，群员们都在。' : '群里还没有人。去「群员」页发布招募令。'}</div>`}${this.busy ? `<div class="zt-g-sys typing">${esc(this.busy)}</div>` : ''}</div>
${sheet}
<div class="zt-g-tools"><button type="button" class="zt-btn small" data-g="sheet-packet">🧧 发红包</button><button type="button" class="zt-btn small" data-g="sign" ${g.签到.day === today() ? 'disabled' : ''}>${g.签到.day === today() ? `已签到 · ${g.签到.streak} 天` : '签到'}</button><button type="button" class="zt-btn small" data-g="sheet-help">求助</button><button type="button" class="zt-btn small" data-g="live">群直播</button><button type="button" class="zt-btn small" data-g="reroll" ${this.busy || !g.轮次.length ? 'disabled' : ''} title="${esc(roundBlocked(g, g.轮次.at(-1)) || '用同样的输入重新生成最近一轮群员发言')}">↻ 重roll</button><button type="button" class="zt-btn small" data-g="manage" aria-pressed="${!!this.manage}">${this.manage ? '✓ 完成' : '🗑 管理'}</button><label class="zt-g-auto" title="每轮剧情回复后，群员自动在群里聊几句"><input type="checkbox" data-g="auto" ${g.设置.自动闲聊 ? 'checked' : ''}> 自动闲聊</label></div>
<div class="zt-g-send"><textarea id="zt-g-input" rows="1" maxlength="300" placeholder="${g.成员.length ? '发消息到群里（Enter 发送）' : '先招募群员'}" ${this.busy ? 'disabled' : ''}></textarea><button type="button" class="zt-btn primary" data-g="send" ${this.busy || !g.成员.length ? 'disabled' : ''}>发送</button></div>`;
    }
    packetSheet(z) {
        const bag = Array.isArray(z.背包) ? z.背包 : [];
        return `<div class="zt-g-sheet" data-sheet="packet"><b>发红包</b>
<div class="zt-g-row"><label><input type="radio" name="zt-g-pk" value="points" checked> 系统点</label><input type="number" data-f="amount" min="1" value="1000" aria-label="金额"><span>分</span><input type="number" data-f="count" min="1" max="30" value="3" aria-label="个数"><span>个</span></div>
<div class="zt-g-row"><label><input type="radio" name="zt-g-pk" value="item" ${bag.length ? '' : 'disabled'}> 物品</label><select data-f="bag" aria-label="背包物品">${bag.map((it, i) => `<option value="${i}" ${it.品级 === '禁忌' ? 'disabled' : ''}>${esc(it.名称)}（${esc(it.品级)}）×${num(it.数量, 1)}</option>`).join('') || '<option value="">背包是空的</option>'}</select><input type="number" data-f="qty" min="1" value="1" aria-label="数量"><span>件</span></div>
<div class="zt-g-row"><input type="text" data-f="note" maxlength="40" placeholder="祝福语（可选）"><button type="button" class="zt-btn primary small" data-g="packet-go">塞进红包</button><button type="button" class="zt-btn small" data-g="sheet-close">取消</button></div>
<small>系统点/物品先从账本扣除并读回确认，再发出；群员抢到会提升好感，可能回礼（待领取）。每天最多发 ${DAILY_OUT} 个。</small></div>`;
    }
    helpSheet(g) {
        return `<div class="zt-g-sheet" data-sheet="help"><b>向群里求助</b><div class="zt-g-row"><input type="text" data-f="help" maxlength="200" placeholder="例如：想找一本能修复经脉的功法"><select data-f="helper"><option value="">随机群员</option>${g.成员.map(m => `<option value="${m.id}">${esc(m.名称)}</option>`).join('')}</select></div>
<div class="zt-g-row"><button type="button" class="zt-btn primary small" data-g="help-go">发出求助</button><button type="button" class="zt-btn small" data-g="sheet-close">取消</button><small>会生成一个“待接取”任务，进入任务库。</small></div></div>`;
    }
    membersView(g, z) {
        const c = g.候选, pm = this.pm && g.成员.find(m => m.id === this.pm), pulled = new Set((Array.isArray(z?.羁绊库) ? z.羁绊库 : []).map(p => p?.群员ID).filter(Boolean));
        const recruit = `<section class="zt-card"><h3>发布招募令 <small>每次 ${RECRUIT_FEE} 点（失败退回）· 入群费按实力档 · 随机招募按你的系统点挑实力档</small></h3>
<div class="zt-g-row"><select data-f="rmode"><option value="rand">随机世界</option><option value="world">指定世界</option><option value="char">指定角色</option></select><input type="text" data-f="rhint" maxlength="30" placeholder="${RECRUIT_PLACEHOLDER.rand}" aria-label="世界或角色名"><button type="button" class="zt-btn primary small" data-g="recruit" ${this.busy || g.成员.length >= g.容量 ? 'disabled' : ''}>发布</button></div>
${c ? `<div class="zt-g-cand">${this.avatar(c)}<div><b>${esc(c.名称)}</b> <small>${esc(c.世界)} · ${esc(this.tierName(c.档))}</small><p>${esc(c.性格)} · 特产：${esc(c.特产)}</p></div><button type="button" class="zt-btn primary small" data-g="invite" ${num(z.系统点) < this.joinPrice(c) ? 'title="系统点不足"' : ''}>邀请入群 · ${fmtNum(this.joinPrice(c))} 点</button>${num(z.系统点) < this.joinPrice(c) ? `<small class="zt-g-warn">系统点不足（有 ${fmtNum(num(z.系统点))}）。放弃后再招募，会换一个人。</small>` : ''}<button type="button" class="zt-btn small" data-g="drop-cand">放弃</button></div>` : ''}
<div class="zt-g-row"><span>容量 ${g.成员.length}/${g.容量}</span><button type="button" class="zt-btn small" data-g="expand" ${g.容量 >= MAX_MEMBERS ? 'disabled' : ''}>扩建 +5 · ${fmtNum(expandCost(g.容量))} 点</button></div></section>`;
        const list = g.成员.map(m => `<div class="zt-g-member${pm?.id === m.id ? ' open' : ''}">${this.avatar(m)}<div class="zt-g-minfo"><b>${esc(m.名称)}${m.身份 === '管理员' ? ' <span class="zt-grade">管理员</span>' : ''}${num(m.禁言轮) > 0 ? ` <span class="zt-grade" data-g="禁忌">禁言 ${m.禁言轮} 轮</span>` : ''}${g.降临?.id === m.id ? ` <span class="zt-grade" data-g="仙品">降临中 ${g.降临.轮} 轮</span>` : ''}</b>
<small>${esc(m.世界)} · ${esc(this.tierName(m.档))} · ${esc(m.性格)} · 特产 ${esc(m.特产)}</small><i class="zt-g-fav" style="--v:${num(m.好感, 20)}%" title="好感 ${num(m.好感, 20)}"></i></div>
<div class="zt-actions"><button type="button" class="zt-btn small" data-pm="${m.id}">私聊</button>${pulled.has(m.id) ? `<button type="button" class="zt-btn small" data-bond-open="${m.id}" title="已在羁绊里">已在羁绊</button>` : `<button type="button" class="zt-btn small" data-bond-pull="${m.id}" title="把 TA 加入羁绊页（群员默认不进羁绊）">拉入羁绊</button>`}<button type="button" class="zt-btn small" data-descend="${m.id}" ${g.降临 ? 'disabled' : ''}>降临 · ${fmtNum(this.descendCost(m))}</button><button type="button" class="zt-btn small" data-live="${m.id}">直播</button><button type="button" class="zt-btn small" data-admin="op" data-id="${m.id}">${m.身份 === '管理员' ? '撤管理' : '设管理'}</button><button type="button" class="zt-btn small" data-admin="mute" data-id="${m.id}">${num(m.禁言轮) > 0 ? '解禁' : '禁言'}</button><button type="button" class="zt-btn small danger" data-admin="kick" data-id="${m.id}">踢出</button></div>
${pm?.id === m.id ? `<div class="zt-g-pm">${(g.私聊[m.id] || []).map(x => `<p class="${x.me ? 'me' : ''}"><b>${x.me ? '我' : esc(m.名称)}</b>${esc(x.text)}</p>`).join('') || '<p class="zt-sub">还没有私聊记录。</p>'}${this.busy ? `<p class="zt-sub">${esc(this.busy)}</p>` : ''}<div class="zt-g-row"><input type="text" data-f="pm" maxlength="300" placeholder="私聊 ${esc(m.名称)}"><button type="button" class="zt-btn primary small" data-g="pm-send" data-id="${m.id}" ${this.busy ? 'disabled' : ''}>发送</button></div></div>` : ''}</div>`).join('');
        return `<div class="zt-g-scroll">${recruit}${list || '<div class="zt-empty">还没有群员。</div>'}</div>`;
    }
    marketView(g, z) {
        const listNow = g.集市.day === today() ? g.集市.list : null, bag = Array.isArray(z.背包) ? z.背包 : [];
        return `<div class="zt-g-scroll"><section class="zt-card"><h3>群员挂单 <small>每天刷新；品阶按群规（≤商城等级、≤群员实力）</small></h3>
${listNow ? (listNow.map(x => `<div class="zt-row"><span>${esc(x.item.名称)} <span class="zt-grade" data-g="${x.item.品级}">${x.item.品级}</span><span class="zt-desc">${esc(x.名称)}@${esc(x.世界)}</span></span><button type="button" class="zt-btn small" data-buy="${x.id}">${fmtNum(x.price)} 点 买下</button></div>`).join('') || '<p class="zt-sub">今天的货已经卖完了。</p>') : `<p class="zt-sub">${g.成员.length ? '点「看看今天的货」让群员摆摊。' : '没有群员，集市冷冷清清。'}</p>`}
<div class="zt-actions"><button type="button" class="zt-btn small" data-g="market" ${g.成员.length ? '' : 'disabled'}>${listNow ? '重新摆摊' : '看看今天的货'}</button></div></section>
<section class="zt-card"><h3>我的挂单 <small>按原版估值（物品价格或品级基准价）；高于估值 30% 群员会嫌贵</small></h3>
<div class="zt-g-row"><select data-f="sell">${bag.map((it, i) => `<option value="${i}" data-v="${this.valueOf(it)}">${esc(it.名称)}（${esc(it.品级)}）×${num(it.数量, 1)} · 估值 ${fmtNum(this.valueOf(it))}</option>`).join('') || '<option value="">背包是空的</option>'}</select><input type="number" data-f="price" min="1" placeholder="售价（空=估值）"><button type="button" class="zt-btn small" data-g="sell" ${bag.length ? '' : 'disabled'}>挂单</button></div>
${g.挂单.map(s => `<div class="zt-row"><span>${esc(s.item.名称)}（${s.item.品级}）<span class="zt-desc">售价 ${fmtNum(s.price)} · 估值 ${fmtNum(s.value)}</span></span><span class="zt-actions"><button type="button" class="zt-btn small primary" data-hawk="${s.id}">吆喝</button><button type="button" class="zt-btn small" data-unlist="${s.id}">撤单</button></span></div>`).join('')}</section></div>`;
    }
    adminView(g) {
        return `<div class="zt-g-scroll"><section class="zt-card"><h3>群资料</h3>
<label class="zt-field">群名<input type="text" data-f="name" maxlength="20" value="${esc(g.群名)}"></label>
<label class="zt-field">公告（置顶，也会告诉群员）<textarea data-f="notice" maxlength="200">${esc(g.公告)}</textarea></label>
<label class="zt-field">群规（每行一条；写进每次群聊请求）<textarea data-f="rules">${esc(g.群规.join('\n'))}</textarea></label>
<div class="zt-actions"><button type="button" class="zt-btn primary small" data-g="meta">保存</button></div></section>
<section class="zt-card"><h3>规则底线 <small>不可关闭</small></h3><p class="zt-sub">群员送出的物品：品阶 ≤ 商城等级、≤ 赠送者实力档，禁忌品禁止；超标自动降到允许的最高品阶，而不是拒绝。系统点红包 ≤ 赠送者实力档价格与商城等级上限。每天最多收 ${DAILY_IN} 个群员红包、发 ${DAILY_OUT} 个。抢到/领取的东西先写入账本并读回确认，才显示“已入库”。</p></section>
<section class="zt-card"><h3>与剧情联动</h3>
<div class="zt-row"><span>群摘要写进提示词<span class="zt-desc">让正文 AI 知道群的存在、群员和最近群聊。</span></span><label class="zt-switch"><input type="checkbox" data-g="inject" ${g.设置.摘要注入 ? 'checked' : ''}><i></i></label></div>
<div class="zt-row"><span>剧情后自动闲聊<span class="zt-desc">每 N 次正文回复，群员自动聊一次（一次额外的模型请求）。</span></span><label class="zt-switch"><input type="checkbox" data-g="auto" ${g.设置.自动闲聊 ? 'checked' : ''}><i></i></label></div>
<div class="zt-row"><span>闲聊间隔<span class="zt-desc">每几次正文回复闲聊一次。</span></span><select data-g-sel="every" aria-label="闲聊间隔">${CHAT_EVERY.map(n => `<option value="${n}" ${g.设置.闲聊间隔 === n ? 'selected' : ''}>每 ${n} 轮</option>`).join('')}</select></div></section>
${this.genView(g)}</div>`;
    }
    /** 1.1.4 群聊生成 settings card. */
    genView(g) {
        const s = g.设置, opt = (list, v, label) => list.map(n => `<option value="${n}" ${v === n ? 'selected' : ''}>${esc(label(n))}</option>`).join('');
        const row = (k, title, desc, list, label) => `<div class="zt-row"><span>${title}<span class="zt-desc">${desc}</span></span><select data-g-set="${k}" aria-label="${title}">${opt(list, s[k], label)}</select></div>`;
        return `<section class="zt-card"><h3>群聊生成 <small>1.1.4 · 每次群聊请求</small></h3>
${row('发言下限', '每次最少几人发言', '模型至少让几位群员说话。自动闲聊最多 3 人。', GROUP_SPEAKERS, n => `${n} 人`)}
${row('发言上限', '每次最多几人发言', '超出的行会被忽略。人数多时请同时调高输出上限。', GROUP_SPEAKERS, n => `${n} 人`)}
${row('单条字数', '每条消息字数上限', '写进提示词，超出的部分会被截掉。', GROUP_CHARS, n => `${n} 字`)}
${row('上下文', '带给模型的最近消息条数', '越多越连贯，但更费 token。', GROUP_CONTEXT, n => `最近 ${n} 条`)}
${row('输出上限', '输出上限（max tokens）', `回复经常被截断时调高。自动 = 按人数和字数估算（当前约 ${autoTokens(groupGen(s).hi, groupGen(s).chars)}）；「分功能 API」里给聊天群单独设的上限优先。`, GROUP_TOKENS, n => (n ? `${n}` : '自动'))}
</section>`;
    }
    val(sel) { return this.el.querySelector(sel)?.value ?? ''; }
    /** 0.9.4 招募令: typing a name while「随机世界」is selected switches to「指定世界」(指定角色 stays selectable). */
    recruitHintTyped() {
        const m = this.el?.querySelector('[data-f=rmode]'), i = this.el?.querySelector('[data-f=rhint]');
        if (m && i && m.value === 'rand' && i.value.trim()) { m.value = 'world'; i.placeholder = RECRUIT_PLACEHOLDER.world; }
    }
    /** Back to「随机世界」clears the name (it would not be used); the placeholder says what the field is for. */
    recruitModeChanged() {
        const m = this.el?.querySelector('[data-f=rmode]'), i = this.el?.querySelector('[data-f=rhint]'); if (!m || !i) return;
        if (m.value === 'rand') i.value = '';
        i.placeholder = RECRUIT_PLACEHOLDER[m.value] || RECRUIT_PLACEHOLDER.rand;
    }
    async onClick(e) {
        const t = e.target.closest('button,input[type=checkbox]'); if (!t || t.disabled) return;
        const run = async fn => { try { await fn(); } catch (err) { this.fail(err); this.paint(); } };
        const d = t.dataset;
        if (d.gtab) { this.view = d.gtab; this.sheet = null; return this.paint(); }
        if (d.grab) return run(() => this.grab(d.grab));
        if (d.gdel) return run(() => this.removeMessage(d.gdel));
        if (d.rebook) return run(() => this.rebook(d.rebook));
        if (d.claim) return run(() => this.claim(d.claim));
        if (d.buy) return run(() => this.buy(d.buy));
        if (d.hawk) return run(() => this.hawk(d.hawk));
        if (d.unlist) return run(() => this.unlist(d.unlist));
        if (d.pm) { this.pm = this.pm === d.pm ? null : d.pm; return this.paint(); }
        // 1.1.2: group members are not 羁绊 by default — pull one in, or jump to the one already pulled
        if (d.bondPull) return run(async () => { if (!this.app.bonds) throw Error('羁绊页未启动'); await this.app.bonds.pull(d.bondPull); });
        if (d.bondOpen) { const e = (this.app.adapter.ledger()?.羁绊库 || []).find(p => p?.群员ID === d.bondOpen); if (e) this.app.bonds?.open(e.id); return; }
        if (d.descend) return run(() => this.descend(d.descend));
        if (d.live) { this.view = 'chat'; return run(() => this.live(d.live)); }
        if (d.admin) { if (d.admin === 'kick' && !confirm('把这位群员移出群聊？')) return; return run(() => this.admin(d.id, d.admin)); }
        switch (d.g) {
            case 'send': { const v = this.val('#zt-g-input'); if (!v.trim()) return; this.el.querySelector('#zt-g-input').value = ''; return run(() => this.send(v)); }
            case 'sheet-packet': this.sheet = this.sheet === 'packet' ? null : 'packet'; return this.paint();
            case 'sheet-help': this.sheet = this.sheet === 'help' ? null : 'help'; return this.paint();
            case 'sheet-close': this.sheet = null; return this.paint();
            case 'packet-go': { const kind = this.el.querySelector('input[name=zt-g-pk]:checked')?.value || 'points'; return run(() => this.sendPacket({ kind, amount: this.val('[data-f=amount]'), count: this.val('[data-f=count]'), bagIndex: this.val('[data-f=bag]'), qty: this.val('[data-f=qty]'), note: this.val('[data-f=note]') })); }
            case 'help-go': { const v = this.val('[data-f=help]'), h = this.val('[data-f=helper]'); this.sheet = null; return run(() => this.help(v, h)); }
            case 'sign': return run(() => this.signIn());
            case 'live': return run(() => this.live());
            case 'reroll': return run(() => this.reroll());
            case 'manage': this.manage = !this.manage; return this.paint();
            case 'auto': return run(() => this.saveMeta({ 自动闲聊: t.checked }));
            case 'inject': return run(() => this.saveMeta({ 摘要注入: t.checked }));
            case 'recruit': return run(() => this.recruit(this.val('[data-f=rmode]'), this.val('[data-f=rhint]')));
            case 'invite': return run(() => this.invite());
            case 'drop-cand': return run(async () => { await this.write(g => { if (g.候选) g.候选历史 = [...g.候选历史, g.候选.名称].slice(-12); g.候选 = null; }); this.paint(); });
            case 'expand': return run(() => this.expand());
            case 'pm-send': { const v = this.val('[data-f=pm]'); return run(() => this.privateSay(d.id, v)); }
            case 'market': return run(() => this.refreshMarket());
            case 'sell': return run(() => this.listForSale(this.val('[data-f=sell]'), this.val('[data-f=price]')));
            case 'meta': return run(() => this.saveMeta({ 群名: this.val('[data-f=name]'), 公告: this.val('[data-f=notice]'), 群规: this.val('[data-f=rules]') }));
            case 'to-task': return this.hub.go('task');
        }
    }
    dispose() { this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); try { this.bridge.uninjectPrompts(['group']); } catch { /* ignore */ } }
}
