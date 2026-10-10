// 1.1.5 聊天群 × 世界书: summon a character from a worldbook entry into the group, let the group read the books, and
// carry what happened in the group back into the story when that character shows up there.
//   * 召唤   — the user picks an entry (book + uid); the model turns its text into the usual member card. The member
//              keeps `来源 {book, uid, comment}`; nothing is written to the worldbook (read-only everywhere).
//   * 群聊   — every group round / private chat gets an excerpt of each summoned member's own entry, plus entries
//              of those books whose keywords appear in the conversation (budget-limited).
//   * 记忆   — 群员记忆注入: when a summoned member's name or keywords appear in the latest story messages, the story
//              prompt gets a short recap of their group chat / private chat with the host, so the story remembers.
// Pure helpers are exported for tests; GroupWorld caches book reads for a minute.
export const WB_MODE = 'wb';
export const ZT_BOOK = '诸天万界最强系统';
const clip = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const low = s => String(s ?? '').toLowerCase();

/** Entry title shown to the user (comment, else first keyword, else uid). */
export function entryTitle(e) { return clip(e?.comment || e?.name || (e?.key || [])[0] || `条目 ${e?.uid}`, 40); }
/** Keywords of an entry worth matching (≥ 2 chars, no regex-style keys). */
export function entryKeys(e) {
    const keys = Array.isArray(e?.key) ? e.key : Array.isArray(e?.strategy?.keys) ? e.strategy.keys : [];
    return [...new Set(keys.map(k => String(k || '').trim()).filter(k => k.length >= 2 && k.length <= 30 && !/^\/.*\/[a-z]*$/.test(k)))];
}
/** Search a book's entries: title / keyword hits first, then content hits. Disabled entries are skipped. Pure. */
export function searchEntries(entries, q, limit = 30) {
    const list = (Array.isArray(entries) ? entries : []).filter(e => e && !e.disable && e.enabled !== false && String(e.content || '').trim());
    const words = low(q).split(/\s+/).filter(Boolean);
    if (!words.length) return list.slice(0, limit);
    const scored = [];
    for (const e of list) {
        const head = low(entryTitle(e) + ' ' + entryKeys(e).join(' ')), body = low(e.content);
        if (!words.every(w => head.includes(w) || body.includes(w))) continue;
        scored.push({ e, s: words.filter(w => head.includes(w)).length * 10 + (head.includes(words[0]) ? 5 : 0) });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.e);
}
/** Prompt that turns an entry into a member card line (same format as 招募). Pure. */
export function summonPrompt(entry, book, { maxTier = 8, tiers = '', name = '' } = {}) {
    return `把世界书「${clip(book, 40)}」里的这个条目召唤进宿主的聊天群：根据条目内容整理成群员资料。
【条目】${entryTitle(entry)}${entryKeys(entry).length ? `（关键词：${entryKeys(entry).slice(0, 8).join('、')}）` : ''}
${clip(entry?.content, 1800)}
${name ? `【指定名字】${clip(name, 20)}\n` : ''}要求：名称用条目里的角色名（条目写的是地点 / 势力时，选其中最有代表性的一位人物）；出处世界写条目所在的世界或作品；实力档按条目如实评估（参考：${tiers}），${maxTier < 8 ? `高于 ${maxTier} 档也照实写（入群费另算）；` : ''}性格 20 字内；特产写该角色世界里可以当礼物的一种物品。
只输出一行，用竖线分隔：名称|出处世界|实力档数字|性格（20字内）|特产（20字内）`;
}
/** Excerpt of a member's own entry for group prompts. Pure. */
export function memberSourceLine(m, entry, n = 360) {
    if (!m?.来源 || !entry) return '';
    return `- ${m.名称}（世界书「${clip(m.来源.book, 30)}」·${entryTitle(entry)}）：${clip(entry.content, n)}`;
}
/** Entries whose keywords appear in the text (case-insensitive), excluding `skip` uids. Pure. */
export function matchKeys(entries, text, skip = new Set(), limit = 4) {
    const t = low(text); if (!t) return [];
    const out = [];
    for (const e of Array.isArray(entries) ? entries : []) {
        if (!e || e.disable || e.enabled === false || skip.has(String(e.uid))) continue;
        if (entryKeys(e).some(k => t.includes(low(k)))) out.push(e);
        if (out.length >= limit) break;
    }
    return out;
}
/** Group-prompt block: summoned members' entries + keyword-matched background, within `budget` characters. Pure. */
export function groupWorldBlock(sources, background, budget = 1600) {
    const lines = [], add = l => { if (!l) return; const used = lines.reduce((a, x) => a + x.length, 0); if (used + l.length <= budget) lines.push(l); };
    for (const s of sources) add(memberSourceLine(s.m, s.entry));
    const bg = background.map(x => `- ${entryTitle(x.entry)}（${clip(x.book, 30)}）：${clip(x.entry.content, 260)}`);
    for (const l of bg) add(l);
    if (!lines.length) return '';
    return `【世界书资料（只读参考）】群员的说话方式、经历和人际关系以这里为准：\n${lines.join('\n')}`;
}
/** Does the text mention this member (name or one of the entry keywords)? Pure. */
export function mentions(text, m, entry) {
    const t = low(text); if (!t || !m) return false;
    const names = [m.名称, ...(entry ? entryKeys(entry) : [])].map(x => String(x || '').trim()).filter(x => x.length >= 2);
    return names.some(n => t.includes(low(n)));
}
/** 群员记忆注入: recap lines for summoned members mentioned in the latest story text. Pure. */
export function worldMemoryPrompt(g, storyText, entryOf = () => null, { maxMembers = 3, perMember = 5 } = {}) {
    if (!g || !Array.isArray(g.成员)) return '';
    const host = '宿主', out = [];
    for (const m of g.成员) {
        if (!m?.来源 || out.length >= maxMembers) continue;
        if (!mentions(storyText, m, entryOf(m))) continue;
        const said = (g.消息 || []).filter(x => x.from === m.id || (x.from === 'me' && String(x.text).includes(m.名称))).slice(-perMember)
            .map(x => `${x.from === 'me' ? host : m.名称}：${clip(x.text, 60)}`);
        const pm = (g.私聊?.[m.id] || []).slice(-4).map(x => `${x.me ? host : m.名称}（私聊）：${clip(x.text, 60)}`);
        const gifts = (g.入库记录 || []).filter(r => String(r.src || '').includes(m.名称)).slice(-3).map(r => `${r.what}（${r.how}）`);
        if (!said.length && !pm.length && !gifts.length) continue;
        out.push(`· ${m.名称}（好感 ${Number(m.好感) || 20}，${m.身份 || '群员'}）${said.length ? '｜群聊：' + said.join(' / ') : ''}${pm.length ? '｜' + pm.join(' / ') : ''}${gifts.length ? '｜经聊天群给宿主的东西：' + gifts.join('、') : ''}`);
    }
    if (!out.length) return '';
    return `【诸天聊天群 · 群员记忆】以下角色也是宿主聊天群的群员（从世界书召唤），在剧情里出现时应记得与宿主在群里的交流，态度与好感保持一致；不要编造记录之外的群聊：\n${out.join('\n')}`;
}
/** Books active for the current chat (chat → character → global), without the 诸天 book. */
export function activeBooks(ctx, wi) {
    const c = ctx || {}, names = [];
    const push = n => { if (typeof n === 'string' && n && n !== ZT_BOOK && !names.includes(n)) names.push(n); };
    push(c.chatMetadata?.world_info);
    try { const ch = c.characters?.[c.characterId]; push(ch?.data?.extensions?.world); } catch { /* no character */ }
    for (const n of wi?.selected_world_info || []) push(n);
    return names;
}

export class GroupWorld {
    constructor(app) { this.app = app; this.cache = new Map(); }
    get bridge() { return this.app.bridge; }
    get cfg() { return { read: true, memory: true, budget: 1600, ...(this.app.settings?.get('groupWorld') || {}) }; }
    names() { try { return this.bridge.getWorldbookNames().filter(n => n !== ZT_BOOK); } catch { return []; } }
    active() { try { return activeBooks(this.app.adapter.context(), this.bridge.wiModule); } catch { return []; } }
    async entries(book) {
        const hit = this.cache.get(book); if (hit && Date.now() - hit.t < 60_000) return hit.list;
        const list = await this.bridge.getWorldbook(book); this.cache.set(book, { t: Date.now(), list }); return list;
    }
    /** Cached entries only (prompts built synchronously). */
    cached(book) { return this.cache.get(book)?.list || null; }
    async entry(src) { if (!src?.book) return null; const list = await this.entries(src.book); return list.find(e => String(e.uid) === String(src.uid)) || null; }
    /** Loads every summoned member's book into the cache (best effort). */
    async warm(g) { const books = [...new Set((g?.成员 || []).map(m => m?.来源?.book).filter(Boolean))]; await Promise.all(books.map(b => this.entries(b).catch(() => null))); }
    entryOfSync(m) { const list = m?.来源 ? this.cached(m.来源.book) : null; return list?.find(e => String(e.uid) === String(m.来源.uid)) || null; }
    /** Block for a group round / private chat about `text`. */
    async block(g, text, only = null) {
        if (!this.cfg.read) return '';
        await this.warm(g);
        const members = (g?.成员 || []).filter(m => m?.来源 && (!only || only.includes(m.id)));
        const sources = members.map(m => ({ m, entry: this.entryOfSync(m) })).filter(s => s.entry);
        const skip = new Set(sources.map(s => String(s.entry.uid))), bg = [];
        for (const book of new Set(members.map(m => m.来源.book))) for (const e of matchKeys(this.cached(book) || [], text, skip, 3)) bg.push({ book, entry: e });
        return groupWorldBlock(sources, bg, Math.max(400, Math.min(6000, Number(this.cfg.budget) || 1600)));
    }
}
