// 世界会改变界面 (0.7.0).
// Which world the host is in comes from the ledger: `诸天系统.当前世界` / `诸天系统.世界类型`, written by the AI through
// the original data block line 「变量更新: 当前世界=…；世界类型=…」 (the original ztVarOps sets any ledger path), by the
// 星图 page (记录穿越), or by hand in the original admin console. This module
//   * classifies the world into a theme: xianxia 仙侠 (玉简 · 星图 · 阵纹) | cyber 赛博 (全息终端) | eerie 诡异 (克制的异常与侵蚀)
//     | default 诸天 — keywords only, an explicit 世界类型 wins, the user can pin a theme in 设置;
//   * sets `data-zt-world` on the terminal (and the engine iframe) — CSS only changes surfaces and decoration, never the
//     position of a control;
//   * keeps a footprint list `诸天系统.万界足迹` (first / last floor, visits) for the 星图, written through the same
//     locked commit + read-back as every other terminal write;
//   * asks the model (small system note, switchable) to write 当前世界 / 世界类型 when the story changes world.
import { isPalette, shellCss, engineCss } from './palettes.js';
import * as L from './ledger-ops.js';

export const THEMES = Object.freeze({
    default: { label: '诸天', badge: '诸天终端', motif: '契约' },
    xianxia: { label: '仙侠', badge: '玉简', motif: '玉简 · 星图 · 阵纹' },
    cyber: { label: '赛博', badge: '全息终端', motif: '全息 · 数据流' },
    eerie: { label: '诡异', badge: '异常', motif: '异常 · 侵蚀' },
});
const TYPE_WORDS = [
    ['xianxia', /(仙侠|修仙|修真|玄幻|仙域|洪荒|武侠|高武|东方玄幻|仙界|神话|封神|西游)/],
    ['cyber', /(赛博|科幻|星际|未来|机甲|末日废土|废土|赛博朋克|太空|银河|义体|AI纪元|虚拟现实|网游)/],
    ['eerie', /(诡异|怪谈|规则怪谈|克苏鲁|恐怖|灵异|惊悚|鬼|邪神|深渊|无限流恐怖|诡)/],
];
const NAME_WORDS = [
    ['xianxia', /(仙|宗|道|灵|天庭|太初|太虚|昆仑|蓬莱|九州|大荒|修|剑|神州|洞天|界域|玄|魔域|妖|斗气|斗罗|遮天|凡人|诛仙|完美世界)/],
    ['cyber', /(赛博|夜之城|2077|新东京|霓虹|义体|联邦|星舰|殖民|基地|数据|矩阵|黑客|机械|赛区|星港|银翼|攻壳|量子)/],
    ['eerie', /(诡|怪谈|雾|鬼|邪|阴|尸|冥|血月|寂静岭|禁区|规则|收容|SCP|回廊|旧日|深潜|克苏鲁|午夜|凶宅|无人)/i],
];
const CURRENCY_WORDS = [['xianxia', /(灵石|仙晶|元石|灵玉|贡献点|两|文|铜钱)/], ['cyber', /(信用点|欧元|电子|比特|算力|点数币|€\$|新元)/], ['eerie', /(冥币|纸钱|寿命|理智|SAN|魂)/i]];

/** Pure: theme id for a world. Explicit 世界类型 first, then the world name, then the currency. */
export function classifyWorld({ type = '', name = '', currency = '' } = {}) {
    const t = String(type || ''), n = String(name || ''), c = String(currency || '');
    for (const [id, re] of TYPE_WORDS) if (re.test(t)) return id;
    if (/(都市|现代|西幻|魔幻|末世|历史|宫斗|校园|其他)/.test(t)) return 'default';
    for (const [id, re] of NAME_WORDS) if (re.test(n)) return id;
    for (const [id, re] of CURRENCY_WORDS) if (re.test(c)) return id;
    return 'default';
}
const clean = s => String(s ?? '').replace(/[\u0000-\u001f<>{}]/g, '').trim().slice(0, 40);

/** Pure: footprint list after arriving in `name` at floor `floor`. Returns a new array (max 40, newest last). */
export function recordFootprint(list, { name, type = '', theme = 'default', floor = null, t = Date.now() }) {
    const out = (Array.isArray(list) ? list : []).filter(x => x && x.名称).map(x => ({ ...x }));
    const n = clean(name); if (!n) return out;
    const hit = out.find(x => x.名称 === n);
    if (hit) { hit.次数 = (Number(hit.次数) || 1) + 1; hit.最近楼层 = floor ?? hit.最近楼层 ?? null; hit.最近 = t; if (type) hit.类型 = clean(type); hit.主题 = theme; out.splice(out.indexOf(hit), 1); out.push(hit); }
    else out.push({ 名称: n, 类型: clean(type), 主题: theme, 首次楼层: floor ?? null, 最近楼层: floor ?? null, 次数: 1, 首次: t, 最近: t });
    while (out.length > 40) out.shift();
    return out;
}

/** 0.9.3 Pure: footprint list after correcting a wrongly detected world `from` → `{ name, type, theme }`. No visit is
 *  counted. When the corrected name already has its own footprint the two records merge (visits add up, the earlier
 *  first visit and the later last visit are kept). Returns a new array; a world without a footprint leaves it as is. */
export function correctFootprint(list, from, { name, type = '', theme = 'default' }) {
    const out = (Array.isArray(list) ? list : []).filter(x => x && x.名称).map(x => ({ ...x }));
    const f = clean(from), n = clean(name) || f, ty = clean(type);
    const hit = out.find(x => clean(x.名称) === f); if (!hit) return out;
    const twin = n !== f ? out.find(x => x !== hit && clean(x.名称) === n) : null;
    if (twin) {
        const first = num(hit.首次, Infinity) <= num(twin.首次, Infinity) ? hit : twin, last = num(hit.最近, 0) >= num(twin.最近, 0) ? hit : twin;
        twin.次数 = (Number(hit.次数) || 1) + (Number(twin.次数) || 1);
        twin.首次 = first.首次; twin.首次楼层 = first.首次楼层 ?? null; twin.最近 = last.最近; twin.最近楼层 = last.最近楼层 ?? null;
        twin.类型 = ty; twin.主题 = theme;
        out.splice(out.indexOf(hit), 1);
        return out;
    }
    hit.名称 = n; hit.类型 = ty; hit.主题 = theme;
    return out;
}
/** 0.9.3 Pure: footprint list without `name`. */
export function forgetFootprint(list, name) {
    const n = clean(name);
    return (Array.isArray(list) ? list : []).filter(x => x && x.名称 && clean(x.名称) !== n).map(x => ({ ...x }));
}
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
export const WORLD_TYPES = Object.freeze(['仙侠', '赛博', '诡异', '都市', '西幻', '末世', '其他']);

export const WORLD_PROMPT_ID = 'world';
export function worldPrompt(z) {
    const w = clean(z?.当前世界) || '未记录', ty = clean(z?.世界类型) || '未记录';
    return `【诸天终端 · 世界记录】当前世界：${w}（类型：${ty}）。当宿主穿越到新世界、或剧情明确揭示所在世界时，在本轮数据块「变量更新」一行写：当前世界=世界名；世界类型=仙侠/赛博/诡异/都市/西幻/末世/其他 之一。世界未变化时不要写这两项。`;
}

export class World {
    constructor(app) { this.app = app; this.theme = 'default'; this.disposers = []; this.last = null; }
    get settings() { return this.app.settings; }
    ledger() { try { const z = this.app.bridge.getVariables({ type: 'chat' })?.诸天系统; return z && typeof z === 'object' ? z : null; } catch { return null; } }
    start() {
        this.disposers.push(this.app.bridge.onChange(k => { if (k === 'chat') this.sync(); }));
        this.disposers.push(this.app.adapter.subscribe(() => this.sync()));
        this.disposers.push(this.settings.onChange(k => { if (k === 'world' || k === 'palette') this.sync(true); }));
        this.app.hub?.hook?.('onEngine', (frame, doc) => this.paintDoc(doc));
        this.sync(true);
        return this;
    }
    current(z = this.ledger()) {
        const pin = this.settings.get('world')?.theme || 'auto';
        const name = clean(z?.当前世界), type = clean(z?.世界类型), currency = clean(z?.当前货币);
        const auto = classifyWorld({ type, name, currency });
        return { name, type, currency, auto, theme: pin !== 'auto' && THEMES[pin] ? pin : auto, pinned: pin !== 'auto' };
    }
    sync(force = false) {
        const idn = this.app.adapter.currentIdentity(), z = idn ? this.ledger() : null, cur = this.current(z);
        const eff = this.settings.get('world')?.enabled === false ? 'default' : cur.theme;
        if (force || eff !== this.theme) { this.theme = eff; this.apply(); }
        this.prompt(z);
        // Footprints: only for a real change inside the same chat (not on chat switch / first read — the 星图 shows the
        // current world even when it has no footprint yet, so opening an old chat never writes).
        if (this.lastIdn === idn && cur.name && this.lastName !== cur.name && z && cur.name !== this.traveling) {
            // 世界类型 belongs to the world it was written with: a world change that kept the old type makes it stale.
            const stale = !!cur.type && cur.type === this.lastType;
            if (stale) { cur.type = ''; cur.auto = classifyWorld({ name: cur.name, currency: cur.currency }); if (!cur.pinned) { this.theme = cur.auto; this.apply(); } }
            this.footprint(cur, stale).catch(e => console.warn('[诸天世界] 足迹未记录', e));
        }
        this.lastIdn = idn; this.lastName = cur.name; this.lastType = cur.type;
    }
    /** 0.8.4 配色方案: a fixed palette overrides the world colours (decorations stay with the world). */
    palette() { const p = this.settings.get('palette'); return isPalette(p) ? p : ''; }
    /** The attribute value: with a palette on the default world, 'plain' switches on the variable-driven surfaces of
     *  world.css (the default world otherwise keeps the original Lilith colours, which a palette must override). */
    attrWorld() { return this.palette() && this.theme === 'default' ? 'plain' : this.theme; }
    paletteCss(shadow) {
        if (!shadow || shadow.getElementById?.('zt-palette-css')) return;
        const st = document.createElement('style'); st.id = 'zt-palette-css'; st.textContent = shellCss(); shadow.append(st);
    }
    paintDoc(doc) {
        const el = doc?.documentElement; if (!el) return;
        if (!doc.getElementById('zt-palette-css')) { const st = doc.createElement('style'); st.id = 'zt-palette-css'; st.textContent = engineCss(); (doc.head || el).append(st); }
        el.dataset.ztWorld = this.attrWorld();
        const p = this.palette(); if (p) el.dataset.ztPalette = p; else delete el.dataset.ztPalette;
    }
    apply() {
        const t = this.attrWorld(), p = this.palette(), host = this.app.hub?.shadow?.host || this.app.assistant?.hostElement;
        this.paletteCss(this.app.hub?.shadow || this.app.assistant?.shadow);
        host?.setAttribute?.('data-zt-world', t);
        if (p) host?.setAttribute?.('data-zt-palette', p); else host?.removeAttribute?.('data-zt-palette');
        this.paintDoc(this.app.hub?.engineFrame?.contentDocument);
        const out = document.getElementById('zhutian-fx-host'); if (out) { out.dataset.ztWorld = t; if (p) out.dataset.ztPalette = p; else delete out.dataset.ztPalette; }
        this.app.hub?.refreshTop?.();
    }
    floor() { const c = this.app.adapter.context(); return Math.max(0, (c.chat?.length || 1) - 1); }
    async footprint(cur, clearType = false) {
        const floor = this.floor();
        await L.commit(this.app.bridge, (v, z) => {
            if (clean(z.当前世界) !== cur.name) return;          // the world moved on meanwhile: nothing to record
            const list = Array.isArray(z.万界足迹) ? z.万界足迹 : [];
            if (list.at(-1)?.名称 === cur.name && list.at(-1)?.最近楼层 === floor) return;
            if (clearType) z.世界类型 = '';
            z.万界足迹 = recordFootprint(list, { name: cur.name, type: cur.type, theme: cur.auto, floor });
        }, z => [z.当前世界, z.世界类型 || '', (z.万界足迹 || []).length, JSON.stringify((z.万界足迹 || []).at(-1) || null)]);
    }
    /** 星图 → 记录穿越: writes 当前世界 (+类型) and the footprint in one commit; the 穿越 performance follows the read-back. */
    async travel(name, type = '') {
        const n = clean(name); if (!n) throw Error('请填写世界名。');
        const floor = this.floor(), theme = classifyWorld({ type, name: n });
        this.traveling = n;
        let out;
        try { out = await L.commit(this.app.bridge, (v, z) => {
            const from = clean(z.当前世界);
            if (from === n) throw Error('已经在这个世界了。');
            z.当前世界 = n; z.世界类型 = clean(type);          // no type given → the old world's type does not carry over
            z.万界足迹 = recordFootprint(z.万界足迹, { name: n, type, theme, floor });
            return { from };
        }, z => [z.当前世界, z.世界类型 || '', (z.万界足迹 || []).length]); } finally { this.traveling = null; }
        this.lastName = n; this.lastType = clean(type);
        return { from: out.from, to: n, type };
    }
    /** 星图 → 更正 (0.9.3): the AI or the name guess got the world wrong. Rewrites 当前世界 / 世界类型 (when it is the
     *  current world) and its footprint in one locked commit + read-back. Not a 穿越: no visit, no performance. */
    async correct(from, { name = '', type = '' } = {}) {
        const f = clean(from); if (!f) throw Error('没有选中世界。');
        const n = clean(name) || f, ty = clean(type);
        const theme = classifyWorld({ type: ty, name: n });
        this.traveling = n;
        let out;
        try { out = await L.commit(this.app.bridge, (v, z) => {
            const isCur = clean(z.当前世界) === f, list = Array.isArray(z.万界足迹) ? z.万界足迹 : [];
            if (!isCur && !list.some(x => clean(x?.名称) === f)) throw Error('账本里已经没有这个世界了（可能刚被改过），请重新选择。');
            if (isCur) { z.当前世界 = n; z.世界类型 = ty; }
            z.万界足迹 = correctFootprint(list, f, { name: n, type: ty, theme });
            return { current: isCur };
        }, z => [z.当前世界, z.世界类型 || '', JSON.stringify(z.万界足迹 || [])]); } finally { this.traveling = null; }
        if (out.current) { this.lastName = n; this.lastType = ty; try { this.app.fx?.drop?.('travel'); } catch { /* fx optional */ } }
        return { from: f, to: n, type: ty, theme, current: out.current };
    }
    /** 星图 → 从足迹删除 (0.9.3): a world that was never really visited. The current world cannot be deleted (correct it). */
    async forget(name) {
        const n = clean(name); if (!n) throw Error('没有选中世界。');
        await L.commit(this.app.bridge, (v, z) => {
            if (clean(z.当前世界) === n) throw Error('这是当前世界，不能删除；识别错了请用「保存更正」改名或改类型。');
            const list = Array.isArray(z.万界足迹) ? z.万界足迹 : [];
            if (!list.some(x => clean(x?.名称) === n)) throw Error('足迹里已经没有这个世界了。');
            z.万界足迹 = forgetFootprint(list, n);
        }, z => [z.当前世界, JSON.stringify(z.万界足迹 || [])]);
        return { name: n };
    }
    prompt(z) {
        const b = this.app.bridge, on = this.settings.get('world')?.prompt !== false && !!z;
        try { if (on) b.injectPrompts([{ id: WORLD_PROMPT_ID, content: worldPrompt(z), position: 'in_chat', depth: 4, role: 'system' }]); else b.uninjectPrompts([WORLD_PROMPT_ID]); } catch { /* host without injection */ }
    }
    dispose() {
        this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } });
        try { this.app.bridge.uninjectPrompts([WORLD_PROMPT_ID]); } catch { /* ignore */ }
        const h = this.app.hub?.shadow?.host || this.app.assistant?.hostElement; h?.removeAttribute?.('data-zt-world'); h?.removeAttribute?.('data-zt-palette');
    }
}
