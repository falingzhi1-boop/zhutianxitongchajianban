// 诸天万界聊天群 (0.6.0) — a QQ-style cross-world group chat inside the terminal.
// Data lives in the chat variables at 诸天系统.聊天群 (follows saves and branches). One user message = one model call,
// answered by 1–6 members. Rules are loose but have a floor: anything a member hands over is clamped to the shop level,
// the member's own tier and never 禁忌 (auto-downgrade, not refusal); every item/point that reaches the host is written
// to the ledger and read back BEFORE the UI says 已入库, with the source “名称@世界”.
import { inert } from './contracts.js';
import { esc, fmtNum } from './hub.js';
import { readConfigs } from './api-center.js';
import * as L from './ledger-ops.js';

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
        设置: { 自动闲聊: !!x.设置?.自动闲聊, 摘要注入: x.设置?.摘要注入 !== false, 闲聊间隔: CHAT_EVERY.includes(num(x.设置?.闲聊间隔)) ? num(x.设置?.闲聊间隔) : 3 },
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
/** Member reply lines → structured messages, with the hard floor applied. */
export function parseGroupReply(text, members, { cap = '凡品', shop = 1, max = 6 } = {}) {
    const out = [], byName = new Map(members.map(m => [m.名称, m]));
    for (const raw of String(text || '').split('\n')) {
        const m = raw.trim().match(/^@?\s*([^:：\s][^:：]{0,23})\s*[:：]\s*(.+)$/);
        if (!m) continue;
        const who = byName.get(m[1].trim()); if (!who || num(who.禁言轮) > 0) continue;
        let body = m[2].trim(); const msg = { who, text: '' };
        const pk = body.match(/^\[红包\]\s*(系统点|物品)\s*(.+?)(?:\s*[|｜]\s*(.*))?$/);
        const gf = body.match(/^\[赠礼\]\s*(.+?)(?:\s*[|｜]\s*(.*))?$/);
        const memberCap = L.giftCap({ 商城等级: shop }, who.档), eff = L.GRADES[Math.min(L.gradeIndex(cap), L.gradeIndex(memberCap))];
        if (pk) {
            const note = clip(pk[3] || '恭喜发财', 40);
            if (pk[1] === '系统点') {
                const [amt, cnt] = pk[2].split(/\s+/).map(s => num(s.replace(/[^\d]/g, '')));
                const limit = packetCap(who.档, shop);
                const amount = Math.max(1, Math.min(Math.floor(amt) || 100, limit));
                msg.packet = { kind: 'points', amount, count: Math.max(1, Math.min(10, Math.floor(cnt) || 3)), note, downgraded: amount < Math.floor(amt) };
            } else {
                const parts = pk[2].split(/\s+/); const qtyRaw = parts.length > 1 && /^[×x*]?\d+$/.test(parts[parts.length - 1]) ? parts.pop() : '1';
                const item = parseItem(parts.join(' ')); if (!item) continue;
                const [g, down] = L.clampGrade(item.品级, eff); item.品级 = g;
                const qty = Math.max(1, Math.min(QTY_CAP[g] || 1, num(qtyRaw.replace(/[^\d]/g, ''), 1)));
                msg.packet = { kind: 'item', item, qty, count: qty, note, downgraded: down };
            }
            msg.text = note;
        } else if (gf) {
            const item = parseItem(gf[1]); if (!item) continue;
            const [g, down] = L.clampGrade(item.品级, eff); item.品级 = g;
            msg.gift = { item, note: clip(gf[2] || '', 60), downgraded: down }; msg.text = msg.gift.note || '送你个小东西。';
        } else msg.text = clip(body, 300);
        if (msg.text || msg.packet || msg.gift) out.push(msg);
        if (out.length >= max) break;
    }
    return out;
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
    async write(fn) {
        return L.commit(this.bridge, (v, z) => {
            const g = normGroup(z[KEY]); const r = fn(g, z); g.rev = num(g.rev) + 1;
            const keep = new Set(g.消息.map(m => m.ref).filter(Boolean)); for (const id of Object.keys(g.红包)) if (!keep.has(id)) delete g.红包[id];
            z[KEY] = g; return r;
        }, z => [z[KEY]?.rev, z.系统点, (z.背包 || []).length, Object.keys(z.任务库 || {}).length]);
    }
    say(g, from, text, extra = {}) { g.消息.push({ id: rid('g'), t: Date.now(), from, text: clip(text, 400), ...extra }); if (g.消息.length > MAX_MSG) g.消息.splice(0, g.消息.length - MAX_MSG); }
    /** What reached the host through the group — injected into the story prompt so the AI keeps the real source. */
    booked(g, what, src, how) { g.入库记录.push({ t: Date.now(), what: clip(what, 40), src: clip(src, 40), how }); if (g.入库记录.length > 20) g.入库记录.splice(0, g.入库记录.length - 20); }
    toast(t, ms = 3200, a) { this.hub?.toast(t, ms, a); }
    fail(e) { this.toast(e.message || String(e), 4500); globalThis.toastr?.warning?.(e.message || String(e), '诸天 · 聊天群'); }
    async ask(system, user, maxTokens = 1200) {
        const cfg = readConfigs(this.bridge).status || {};
        const custom = cfg.url ? { apiurl: cfg.url, key: cfg.key, model: cfg.model, max_tokens: maxTokens, temperature: 0.85 } : undefined;
        const text = await this.bridge.generateRaw({ user_input: user, ordered_prompts: [{ role: 'system', content: system }, 'user_input'], custom_api: custom, max_tokens: maxTokens });
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
            if (text === this.lastPrompt) return; this.lastPrompt = text;
            this.bridge.injectPrompts([{ id: 'group', content: text, position: 'in_chat', depth: 2, role: 'system' }]);
        } catch (e) { console.warn('[诸天聊天群] 注入失败', e); }
    }
    async onStoryReply(id) {
        const c = this.ctx, m = c.chat?.[Number(id)]; if (!m || m.is_user || m.is_system) return;
        const g = this.group();
        if (g.降临) {
            try { await this.write(gg => { if (!gg.降临) return; gg.降临.轮 = num(gg.降临.轮) - 1; if (gg.降临.轮 <= 0) { this.say(gg, 'sys', `${gg.降临.名称} 的降临结束，回到了${gg.降临.世界}。`, { kind: 'sys' }); gg.降临 = null; } }); this.syncPrompt(); } catch (e) { console.warn(e); }
        }
        if (!g.设置.自动闲聊 || !g.成员.length || this.busy) return;
        // 0.8.2: every N-th story reply only (setting 闲聊间隔, default 3) — not one extra model call per message.
        const every = g.设置.闲聊间隔 || 3, due = num(g.节奏.闲聊) + 1 >= every;
        try { await this.write(gg => { gg.节奏.闲聊 = due ? 0 : num(gg.节奏.闲聊) + 1; }); } catch (e) { console.warn(e); return; }
        if (due) this.round(null, String(m.mes || '').replace(/<ZhuTianPanel>[\s\S]*?<\/ZhuTianPanel>/g, '').slice(-400)).catch(e => console.warn('[诸天聊天群] 自动闲聊失败', e));
    }

    // ---------- chat round: one request, 1–6 members ----------
    async round(userText, story = '') {
        const z0 = this.ledger(); if (!z0) throw Error('当前聊天没有诸天账本。');
        const g0 = normGroup(z0[KEY]); const speakers = g0.成员.filter(m => num(m.禁言轮) <= 0);
        if (!speakers.length) throw Error(g0.成员.length ? '群员都被禁言了。' : '群里还没有群员，先去「群员」页招募。');
        const shop = L.shopLevel(z0), cap = L.GRADES[Math.min(shop, 4) - 1], allow = packetAllowed(g0, userText);
        const packetRule = allow === 'asked' ? '2. 宿主这次主动要了，可以按宿主的要求发红包或赠礼（最多 3 个），格式：'
            : allow ? '2. 本轮可以（不是必须）由 1 位群员发红包或赠礼，最多 1 个，格式：'
            : '2. 本轮【禁止】发红包和赠礼（群里刚发过，节奏是三四轮一次），只聊天。下面的格式本轮不要用：';
        const recent = g0.消息.slice(-16).map(m => `${m.from === 'me' ? this.hostName() + '（宿主）' : m.from === 'sys' ? '系统' : (g0.成员.find(x => x.id === m.from)?.名称 || '群员')}: ${String(m.text).slice(0, 120)}`).join('\n');
        const sys = `你是诸天万界聊天群。群里的每位群员来自不同的世界，性格、说话方式和见识都符合原世界。宿主是群主，拥有诸天系统。
回复规则：
1. 选 1–6 位与话题最相关的群员发言（被禁言的不能发言），每条一行，格式严格为：@名称: 内容
${packetRule}
@名称: [红包] 系统点 数额 个数 | 祝福语
@名称: [红包] 物品 名称/品级/分类/效果 数量 | 祝福语
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
${userText ? `【宿主刚发】${userText}` : `【宿主没有发言】请根据宿主那边的最新剧情，让 1–3 位群员自然闲聊。${story ? '\n最新剧情：' + story : ''}`}`;
        this.busy = '群员正在输入…'; this.paint();
        try {
            const text = await this.ask(sys, user, 1200);
            let got = 0, dropped = 0;
            const res = await this.write((g, z) => {
                const parsed = parseGroupReply(text, g.成员, { cap, shop }); let handed = 0;
                for (const p of parsed) {
                    // Hard floor for the rhythm: the model may ignore the rule, the ledger does not.
                    if ((p.packet || p.gift) && (!allow || handed >= (allow === 'asked' ? 3 : 1))) { dropped++; continue; }
                    if (p.packet || p.gift) handed++;
                    if (p.packet) {
                        if (g.日计.收 >= DAILY_IN) { this.say(g, p.who.id, p.text + '（今日红包已达上限，被群规拦下）'); dropped++; continue; }
                        const id = rid('rp'), total = p.packet.kind === 'points' ? p.packet.amount : p.packet.qty;
                        const count = Math.max(1, Math.min(p.packet.count, total, g.成员.length + 1));
                        g.红包[id] = { id, from: p.who.id, kind: p.packet.kind, total, item: p.packet.item || null, shares: splitShares(total, count), grabs: [], note: p.packet.note, downgraded: p.packet.downgraded, t: Date.now() };
                        g.日计.收++; this.say(g, p.who.id, p.text, { kind: 'packet', ref: id }); got++;
                    } else if (p.gift) {
                        const gid = rid('gf');
                        g.待领取.push({ id: gid, from: p.who.id, 名称: p.who.名称, 世界: p.who.世界, item: { ...p.gift.item, 价格: L.TIER_PRICE[p.gift.item.品级] }, note: p.gift.note, downgraded: p.gift.downgraded, t: Date.now() });
                        this.say(g, p.who.id, p.text, { kind: 'gift', gift: gid, label: `${p.gift.item.名称}（${p.gift.item.品级}）${p.gift.downgraded ? ' · 按群规降级' : ''}` }); got++;
                    } else this.say(g, p.who.id, p.text);
                }
                for (const m of g.成员) if (num(m.禁言轮) > 0) m.禁言轮 = num(m.禁言轮) - 1;
                if (got) g.节奏 = { 距上次: 0, 间隔: Math.random() < 0.5 ? 3 : 4 }; else g.节奏.距上次 = Math.min(99, num(g.节奏.距上次) + 1);
                return parsed.length;
            });
            if (!res) this.toast('群员这次没有按格式回复（模型输出无法解析），可以再发一次。', 4200);
            else if (got) this.toast(dropped ? '有红包/赠礼到达，部分超出今日上限或节奏。' : '群里有红包或赠礼，点开领取。', 3200);
        } finally { this.busy = ''; this.syncPrompt(); this.paint(); }
    }
    async send(text) {
        text = clip(text, 300); if (!text) return;
        await this.write(g => { this.say(g, 'me', text); });
        this.paint(); await this.round(text);
    }

    // ---------- red packets & gifts ----------
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
    async recruit(mode, hint) {
        const z = this.ledger(); if (!z) throw Error('当前聊天没有诸天账本。');
        const g = normGroup(z[KEY]); if (g.成员.length >= g.容量) throw Error(`群已满（${g.容量} 人），先扩建。`);
        await this.write((gg, zz) => { L.spend(zz, RECRUIT_FEE); if (gg.候选) gg.候选历史 = [...gg.候选历史, gg.候选.名称].slice(-12); gg.候选 = null; });
        this.busy = '正在向诸天万界发布招募令…'; this.paint();
        try {
            const g1 = this.group(), budget = num(this.ledger()?.系统点), maxTier = affordableTier(budget);
            const prompt = recruitPrompt(g1, { mode, hint, budget, maxTier });
            const avoid = new Set([...g1.成员.map(m => m.名称), ...(mode === 'char' ? [] : g1.候选历史)]);   // 指定角色: asking again for the same person is fine
            let card = parseRecruit(await this.ask('你是诸天万界聊天群的招募系统。', prompt.text, 300));
            // Real randomness has a floor: never hand back someone already in the group or just shown (one retry).
            if (card && (avoid.has(card.名称) || (prompt.target && card.档 > maxTier))) {
                const why = avoid.has(card.名称) ? `「${card.名称}」刚刚出现过或已在群里，必须换一个完全不同的人` : `「${card.名称}」实力档 ${card.档} 超出了要求的 ${prompt.target} 档`;
                card = parseRecruit(await this.ask('你是诸天万界聊天群的招募系统。', prompt.text + `\n上一次的回答不合格：${why}。`, 300)) || card;
            }
            if (!card) throw Error('招募令没有得到有效回应（模型输出无法解析）。');
            if (avoid.has(card.名称)) throw Error(`模型两次都给了重复的人（${card.名称}）。`);
            await this.write(gg => { gg.候选 = { ...card, t: Date.now(), 超预算: card.档 > maxTier }; });
        } catch (e) {
            await this.write((gg, zz) => { L.earn(zz, RECRUIT_FEE); }).catch(() => {});
            throw Error(e.message + `（${RECRUIT_FEE} 点招募令已退回）`);
        } finally { this.busy = ''; this.paint(); }
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
        text = clip(text, 300); if (!text) return; const m = this.member(id); if (!m) throw Error('群员不存在。');
        const log = (this.group().私聊[id] || []).slice(-10).map(x => `${x.me ? '宿主' : m.名称}: ${x.text}`).join('\n');
        this.busy = `${m.名称} 正在输入…`; this.paint();
        try {
            const reply = await this.ask(`你是诸天万界聊天群的群员私聊：你扮演 ${m.名称}（${m.世界}·${this.tierName(m.档)}·${m.性格}），正在和群主私聊。只输出 ${m.名称} 的一段回复，不要旁白，不超过 120 字。`, `对宿主的好感：${num(m.好感, 20)}/100\n${log ? '最近私聊：\n' + log + '\n' : ''}宿主：${text}`, 400);
            await this.write(g => { const arr = g.私聊[id] = Array.isArray(g.私聊[id]) ? g.私聊[id] : []; arr.push({ me: true, text, t: Date.now() }, { me: false, text: clip(reply.replace(/^.{0,24}[:：]\s*/, ''), 300), t: Date.now() }); if (arr.length > MAX_PM) arr.splice(0, arr.length - MAX_PM); });
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
        text = clip(text, 200); if (!text) throw Error('先写下要求助的事。');
        const g0 = this.group(), m = g0.成员.find(x => x.id === memberId) || g0.成员[Math.floor(Math.random() * g0.成员.length)];
        if (!m) throw Error('群里还没有群员。');
        this.busy = `${m.名称} 正在想办法…`; this.paint();
        try {
            const reply = await this.ask('你是诸天万界聊天群的任务发布系统。', `宿主在群里求助：「${text}」。回应者：${m.名称}（${m.世界}·${this.tierName(m.档)}）。
把这次求助变成一个宿主可以去完成的任务。只输出一行，用竖线分隔：任务名称（12字内）|任务内容（60字内，写清楚去哪、做什么）|奖励（例如 3000 系统点，或某件物品）`, 300);
            const [名称, 内容, 奖励] = (String(reply).split('\n').find(s => s.includes('|')) || '').split('|').map(s => clip(s, 80));
            if (!名称) throw Error('没有生成有效的任务（模型输出无法解析）。');
            const task = await this.write((g, z) => {
                z.任务库 = z.任务库 && typeof z.任务库 === 'object' && !Array.isArray(z.任务库) ? z.任务库 : {};
                const ID = rid('grp_').replace(/[^A-Za-z0-9_-]/g, '');
                z.任务库[ID] = { ID, 名称: 名称.slice(0, 24), 内容: 内容 || text, 奖励: 奖励 || '未记录奖励', 完成度: 0, 类型: '短期', 状态: '待接取', 来源: `聊天群求助 · ${m.名称}@${m.世界}` };
                this.say(g, 'me', `求助：${text}`); this.say(g, m.id, `这事我有办法。任务「${名称}」发你了：${内容}`, { kind: 'task', task: ID });
                return z.任务库[ID];
            });
            this.toast(`任务「${task.名称}」已进入任务库（待接取）。`, 3600, { label: '去任务页', run: () => this.hub.go('task') });
        } finally { this.busy = ''; this.paint(); }
    }
    async live(memberId) {
        const g0 = this.group(), m = g0.成员.find(x => x.id === memberId) || g0.成员[Math.floor(Math.random() * g0.成员.length)];
        if (!m) throw Error('群里还没有群员。');
        this.busy = `${m.名称} 正在开播…`; this.paint();
        try {
            const reply = await this.ask('你是诸天万界聊天群的群直播。', `${m.名称}（${m.世界}·${this.tierName(m.档)}·${m.性格}）在群里开了一场直播，给宿主看自己世界此刻正在发生的事。用第三人称写 3–5 行直播画面，每行不超过 50 字，只输出画面描述。`, 500);
            const lines = String(reply).split('\n').map(s => clip(s, 80)).filter(Boolean).slice(0, 5);
            if (!lines.length) throw Error('直播信号中断了（模型没有返回内容）。');
            await this.write(g => { this.say(g, m.id, lines.join('\n'), { kind: 'live' }); });
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
        if (!this.bound) { this.bound = true; el.addEventListener('click', e => this.onClick(e)); el.addEventListener('change', e => { const sel = e.target.closest?.('[data-g-sel=every]'); if (sel) this.saveMeta({ 闲聊间隔: Number(sel.value) }).catch(err => this.fail(err)); }); el.addEventListener('keydown', e => { if (e.target.id === 'zt-g-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.querySelector('[data-g=send]')?.click(); } }); }
    }
    avatar(m) { const h = [...String(m?.名称 || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360; return `<span class="zt-g-av" style="background:hsl(${h} 45% 38%)">${esc(String(m?.名称 || '?').slice(0, 1))}</span>`; }
    chatView(g, z) {
        const name = id => g.成员.find(m => m.id === id);
        const rows = g.消息.map(msg => {
            if (msg.kind === 'sys' || msg.from === 'sys') return `<div class="zt-g-sys">${esc(msg.text)}</div>`;
            const me = msg.from === 'me', m = me ? null : name(msg.from) || { 名称: '已退群', 世界: '' };
            let body = `<div class="zt-g-text">${esc(msg.text).replace(/\n/g, '<br>')}</div>`;
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
            return `<div class="zt-g-msg${me ? ' me' : ''}">${me ? '' : this.avatar(m)}<div class="zt-g-bub">${me ? '' : `<div class="zt-g-who">${esc(m.名称)}<small>${esc(m.世界 || '')}${m.档 ? ' · ' + esc(this.tierName(m.档)) : ''}</small></div>`}${body}</div></div>`;
        }).join('');
        const sheet = this.sheet === 'packet' ? this.packetSheet(z) : this.sheet === 'help' ? this.helpSheet(g) : '';
        return `<div class="zt-g-log" aria-live="polite">${g.公告 ? `<div class="zt-g-notice">📌 ${esc(g.公告)}</div>` : ''}${rows || `<div class="zt-empty">${g.成员.length ? '说点什么吧，群员们都在。' : '群里还没有人。去「群员」页发布招募令。'}</div>`}${this.busy ? `<div class="zt-g-sys typing">${esc(this.busy)}</div>` : ''}</div>
${sheet}
<div class="zt-g-tools"><button type="button" class="zt-btn small" data-g="sheet-packet">🧧 发红包</button><button type="button" class="zt-btn small" data-g="sign" ${g.签到.day === today() ? 'disabled' : ''}>${g.签到.day === today() ? `已签到 · ${g.签到.streak} 天` : '签到'}</button><button type="button" class="zt-btn small" data-g="sheet-help">求助</button><button type="button" class="zt-btn small" data-g="live">群直播</button><label class="zt-g-auto" title="每轮剧情回复后，群员自动在群里聊几句"><input type="checkbox" data-g="auto" ${g.设置.自动闲聊 ? 'checked' : ''}> 自动闲聊</label></div>
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
        const c = g.候选, pm = this.pm && g.成员.find(m => m.id === this.pm);
        const recruit = `<section class="zt-card"><h3>发布招募令 <small>每次 ${RECRUIT_FEE} 点（失败退回）· 入群费按实力档 · 随机招募按你的系统点挑实力档</small></h3>
<div class="zt-g-row"><select data-f="rmode"><option value="rand">随机世界</option><option value="world">指定世界</option><option value="char">指定角色</option></select><input type="text" data-f="rhint" maxlength="30" placeholder="世界或角色名（随机时可空）"><button type="button" class="zt-btn primary small" data-g="recruit" ${this.busy || g.成员.length >= g.容量 ? 'disabled' : ''}>发布</button></div>
${c ? `<div class="zt-g-cand">${this.avatar(c)}<div><b>${esc(c.名称)}</b> <small>${esc(c.世界)} · ${esc(this.tierName(c.档))}</small><p>${esc(c.性格)} · 特产：${esc(c.特产)}</p></div><button type="button" class="zt-btn primary small" data-g="invite" ${num(z.系统点) < this.joinPrice(c) ? 'title="系统点不足"' : ''}>邀请入群 · ${fmtNum(this.joinPrice(c))} 点</button>${num(z.系统点) < this.joinPrice(c) ? `<small class="zt-g-warn">系统点不足（有 ${fmtNum(num(z.系统点))}）。放弃后再招募，会换一个人。</small>` : ''}<button type="button" class="zt-btn small" data-g="drop-cand">放弃</button></div>` : ''}
<div class="zt-g-row"><span>容量 ${g.成员.length}/${g.容量}</span><button type="button" class="zt-btn small" data-g="expand" ${g.容量 >= MAX_MEMBERS ? 'disabled' : ''}>扩建 +5 · ${fmtNum(expandCost(g.容量))} 点</button></div></section>`;
        const list = g.成员.map(m => `<div class="zt-g-member${pm?.id === m.id ? ' open' : ''}">${this.avatar(m)}<div class="zt-g-minfo"><b>${esc(m.名称)}${m.身份 === '管理员' ? ' <span class="zt-grade">管理员</span>' : ''}${num(m.禁言轮) > 0 ? ` <span class="zt-grade" data-g="禁忌">禁言 ${m.禁言轮} 轮</span>` : ''}${g.降临?.id === m.id ? ` <span class="zt-grade" data-g="仙品">降临中 ${g.降临.轮} 轮</span>` : ''}</b>
<small>${esc(m.世界)} · ${esc(this.tierName(m.档))} · ${esc(m.性格)} · 特产 ${esc(m.特产)}</small><i class="zt-g-fav" style="--v:${num(m.好感, 20)}%" title="好感 ${num(m.好感, 20)}"></i></div>
<div class="zt-actions"><button type="button" class="zt-btn small" data-pm="${m.id}">私聊</button><button type="button" class="zt-btn small" data-descend="${m.id}" ${g.降临 ? 'disabled' : ''}>降临 · ${fmtNum(this.descendCost(m))}</button><button type="button" class="zt-btn small" data-live="${m.id}">直播</button><button type="button" class="zt-btn small" data-admin="op" data-id="${m.id}">${m.身份 === '管理员' ? '撤管理' : '设管理'}</button><button type="button" class="zt-btn small" data-admin="mute" data-id="${m.id}">${num(m.禁言轮) > 0 ? '解禁' : '禁言'}</button><button type="button" class="zt-btn small danger" data-admin="kick" data-id="${m.id}">踢出</button></div>
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
<div class="zt-row"><span>闲聊间隔<span class="zt-desc">每几次正文回复闲聊一次。</span></span><select data-g-sel="every" aria-label="闲聊间隔">${CHAT_EVERY.map(n => `<option value="${n}" ${g.设置.闲聊间隔 === n ? 'selected' : ''}>每 ${n} 轮</option>`).join('')}</select></div></section></div>`;
    }
    val(sel) { return this.el.querySelector(sel)?.value ?? ''; }
    async onClick(e) {
        const t = e.target.closest('button,input[type=checkbox]'); if (!t || t.disabled) return;
        const run = async fn => { try { await fn(); } catch (err) { this.fail(err); this.paint(); } };
        const d = t.dataset;
        if (d.gtab) { this.view = d.gtab; this.sheet = null; return this.paint(); }
        if (d.grab) return run(() => this.grab(d.grab));
        if (d.claim) return run(() => this.claim(d.claim));
        if (d.buy) return run(() => this.buy(d.buy));
        if (d.hawk) return run(() => this.hawk(d.hawk));
        if (d.unlist) return run(() => this.unlist(d.unlist));
        if (d.pm) { this.pm = this.pm === d.pm ? null : d.pm; return this.paint(); }
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
