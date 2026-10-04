import { capture, assertCapture } from './action-support.js';
// 1.0 · 品阶鉴定 — player feedback: "不是通过系统获得的功法或物品在系统自身的判定里会变成凡品，判定完之后就改不了了，
// 只能用系统自带的商城去升".
//
// Why it happened (original 3.1 engine, unchanged): a story skill comes in through the data block line
// 「收录:功法名[品阶]」. Without the [品阶] it is booked as 凡品, and a later 「收录:同名[仙品]」 is ignored because the skill
// already exists. Items without a grade (old saves, other cards' variables, hand edits) are shown and valued as 凡品.
// Nothing outside the shop raised them again.
//
// What 1.0 adds (system-made things are never touched — the system already graded them itself):
//   1. 品阶鉴定 page: every 功法 / 物品 that did NOT come from the system (商城、盲盒、熔炉、洞天、任务奖励、聊天群 …)
//      can be appraised by the model (分功能 API「品阶鉴定」) or corrected by hand. Only upward, at most 神品 (禁忌 is never
//      handed out by an appraisal). An item keeps its old recycle value (no 改品阶→回收 loop).
//   2. A later 「收录:功法名[更高品阶]」 for such a skill raises it (the original only ignored the line).
//   3. One prompt line: always write the grade when booking something, judged by what it is.
// Every write: one locked commit + read-back (ledger-ops); AI / 手动 also change the floor snapshots (a swipe does not
// take it back; 收录更正 stays with its floor), and the change is logged (功法记录 / the entry's 鉴定 stamp).
import * as L from './ledger-ops.js';
import { esc } from './hub.js';
import { GRADE_CAP, normGrade, normName, fixSkill, panelField } from './skill-sync.js';
import { errorLine } from './errors.js';
import { readConfigs } from './api-center.js';

export const APPRAISE_GRADES = Object.freeze(['凡品', '灵品', '仙品', '神品']);
/** Where the system itself made / graded the thing (original 来源 values + the terminal's own modules). */
export const SYSTEM_SOURCE = /^(商城|万界商城|盲盒|万物熔炉|随身洞天|分身探宝|无限口袋|图鉴复刻|修炼|任务奖励|聊天群|自拟外挂|管理员|系统)/;
export const appraiseItemKey = it => JSON.stringify(['lot', ...['名称', '品级', '来源', '来源世界', '原世界品阶', '收纳凭据', '价格', '分类', '效果'].map(k => it?.[k] ?? null)]);
export const isOutside = e => !SYSTEM_SOURCE.test(String(e?.来源 ?? '').trim());
const gi = g => APPRAISE_GRADES.indexOf(g);
const num = (x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };

/** Entries that may be appraised (pure). Skills by name; items by immutable source-lot fields (not only name + grade). */
export function candidates(z) {
    const skills = (Array.isArray(z?.功法库) ? z.功法库 : []).filter(isOutside).map(s => { const f = fixSkill(s); return { kind: 'skill', key: normName(f.名称), name: f.名称, grade: f.品阶, src: String(s.来源 || ''), desc: String(s.描述 || s.效果 || ''), world: String(s.来源世界 || ''), originalGrade: String(s.原世界品阶 || ''), stamp: s.鉴定 || null, extra: `${f.熟练度}/${f.上限}` }; });
    const items = (Array.isArray(z?.背包) ? z.背包 : []).filter(isOutside).map(it => ({ kind: 'item', key: appraiseItemKey(it), name: String(it.名称 || '未知物品'), grade: APPRAISE_GRADES.includes(it.品级) ? it.品级 : (it.品级 === '禁忌' ? '禁忌' : '凡品'), src: String(it.来源 || ''), desc: String(it.效果 || ''), cat: String(it.分类 || '其他'), world: String(it.来源世界 || ''), originalGrade: String(it.原世界品阶 || ''), stamp: it.鉴定 || null, extra: `×${num(it.数量, 1)}` }));
    return { skills, items };
}
/** Messages for one appraisal (pure). The scale is the system's own (神通实力档 → 品阶). */
export function appraisePrompt(entry, z) {
    const kind = entry.kind === 'skill' ? '功法' : '物品', world = entry.world || z?.当前世界 || '';
    const system = '你是诸天系统的品阶鉴定官。只按它本身的威力、规格和稀有度判断品阶，不迎合宿主，不因为来源是剧情就压低或抬高。严格只输出一行：品阶|一句话理由（30字内）。品阶只能是 凡品 / 灵品 / 仙品 / 神品 之一；证据不足输出 待鉴定|理由。';
    const user = [
        '品阶标准（诸天系统统一标准）：',
        '凡品：凡人世界之物、凡俗武学（对应实力：凡人顶尖）',
        '灵品：超凡入门——武道宗师、超凡者级别的宝物 / 功法',
        '仙品：城市级到国家 / 大陆级的力量',
        '神品：行星级、星系级以上的力量',
        '',
        `鉴定对象（${kind}）：${entry.name}`,
        entry.cat ? `分类：${entry.cat}` : '',
        entry.desc ? `效果 / 描述：${String(entry.desc).slice(0, 200)}` : '效果 / 描述：没有记录（证据不足必须返回 待鉴定|缺少效果证据，不能按名称猜测凡品）',
        `来源：${entry.src || '剧情 / 未记录'}`,
        z?.当前世界 ? `宿主当前所在世界：${String(z.当前世界).slice(0, 30)}` : '',
        `账本现在记为：${entry.grade}`,
        `物品来源世界：${entry.world || '未记录，不得把当前世界当作已证实来源'}` ,
        `原世界品阶：${entry.originalGrade || '未记录'}`,
        `用户确认的参考世界映射（${world}）：${JSON.stringify(z?.世界品阶映射?.[world] || {})}`,
        '保留原世界品阶，不按名称推断，未知就待鉴定。',
    ].filter(x => x !== '').join('\n');
    return { system, user };
}
/** The model's answer → { grade, reason } (pure). Throws a readable error for anything else. */
export function parseAppraisal(text) {
    if (/待鉴定/.test(String(text))) throw Error('品阶待鉴定：缺少可靠设定/效果证据。账本未改动，请补充原世界映射或手动确认。');
    const line = String(text || '').replace(/```[\s\S]*?```/g, ' ').split(/\r?\n/).map(s => s.trim()).find(s => /凡品|灵品|仙品|神品|禁忌/.test(s));
    if (!line) throw Error('模型没有给出品阶（应为：品阶|理由）。账本：没有改动。');
    const [head, ...rest] = line.replace(/^[*#>\-\s]+/, '').split(/[|｜]/);
    let grade = normGrade(head) || normGrade(line);
    if (grade === '禁忌') grade = '神品';
    if (!APPRAISE_GRADES.includes(grade)) throw Error('模型给出的品阶无法识别。账本：没有改动。');
    return { grade, reason: rest.join('|').trim().replace(/\s+/g, ' ').slice(0, 60) };
}
/**
 * Raise one entry inside a ledger object (pure, mutates `z`). Returns { changed, from, to, name }.
 * Only outside entries, only upward, at most 神品. Skills: 上限 follows the new grade. Items: the recycle value is frozen
 * at the old one. Source lots stay separate, even when name and grade match a shop stack.
 */
export function regrade(z, entry, grade, { how = 'AI', reason = '', at = Date.now() } = {}) {
    if (!APPRAISE_GRADES.includes(grade)) throw Error('品阶只能是 凡品 / 灵品 / 仙品 / 神品。');
    if (entry.kind === 'skill') {
        const lib = Array.isArray(z.功法库) ? z.功法库 : [];
        const s = lib.find(x => normName(x?.名称) === entry.key); if (!s) throw Error(`功法库里没有「${entry.name}」了。`);
        if (!isOutside(s)) throw Error(`「${entry.name}」是系统给的，品阶由系统判定，不能鉴定。`);
        const f = fixSkill(s), from = f.品阶;
        if (gi(grade) <= gi(from) || from === '禁忌') return { changed: false, from, to: grade, name: f.名称 };
        s.品阶 = grade; s.上限 = Math.max(num(s.上限, f.上限), GRADE_CAP[grade]);
        if (s.圆满 && num(s.熟练度) < s.上限) delete s.圆满;
        s.鉴定 = { 品阶: grade, 原品阶: from, 方式: how, 时间: at, ...(reason ? { 理由: reason } : {}) };
        return { changed: true, from, to: grade, name: f.名称 };
    }
    const bag = Array.isArray(z.背包) ? z.背包 : [];
    const matches = bag.map((x, i) => ({ x, i })).filter(({ x }) => appraiseItemKey(x) === entry.key || `${x?.名称 || ''}|${x?.品级 || ''}` === entry.key);
    if (matches.length > 1) throw Error('同名物品来源不唯一，请重新选择具体批次；未写入。');
    const i = matches[0]?.i ?? -1; if (i < 0) throw Error(`背包里没有「${entry.name}」了。`);
    const it = bag[i]; if (!isOutside(it)) throw Error(`「${entry.name}」是系统给的，品阶由系统判定，不能鉴定。`);
    const from = APPRAISE_GRADES.includes(it.品级) ? it.品级 : (it.品级 === '禁忌' ? '禁忌' : '凡品');
    if (from === '禁忌' || gi(grade) <= gi(from)) return { changed: false, from, to: grade, name: it.名称 };
    if (!num(it.价格)) it.价格 = L.TIER_PRICE[from] || 100;            // recycle value stays what it was
    const stamp = { 品阶: grade, 原品阶: from, 方式: how, 时间: at, ...(reason ? { 理由: reason } : {}) };
    it.品级 = grade; it.鉴定 = stamp;
    return { changed: true, from, to: grade, name: it.名称 };
}
/** 「收录:功法名[品阶]」 lines that name an existing outside skill with a HIGHER grade (pure). */
export function gradeRaises(z, practiceLine) {
    const lib = (Array.isArray(z?.功法库) ? z.功法库 : []), out = [];
    for (const part of String(practiceLine || '').split(/[；;\n|｜]+/).map(s => s.trim()).filter(Boolean)) {
        const m = part.match(/^(?:收录|习得|学会)\s*[:：]\s*(.+)$/); if (!m) continue;
        const b = m[1].match(/[[【（(〔]([^\]】）)〕]*)[\]】）)〕]/), g = b ? normGrade(b[1]) : '';
        if (!APPRAISE_GRADES.includes(g)) continue;
        const key = normName(m[1]), s = lib.find(x => normName(x?.名称) === key);
        if (!s || !isOutside(s)) continue;
        const from = fixSkill(s).品阶; if (gi(g) > gi(from) && from !== '禁忌' && !out.some(o => o.key === key)) out.push({ kind: 'skill', key, name: s.名称, from, to: g });
    }
    return out;
}
export const GRADE_RULE = '【诸天系统 · 品阶】新收录功法写「收录:功法名[品阶]」，物品写明品级；品阶按它本身的威力判断（凡品＝凡人之物 / 凡俗武学，灵品＝武道宗师 / 超凡，仙品＝城市到大陆级，神品＝行星级以上），不写会按凡品入账。已入账的剧情功法如果品阶记低了，可以再写一次「收录:功法名[正确品阶]」更正（只升不降）。';

export class Appraise {
    constructor(app) { this.app = app; this.disposers = []; this.busy = false; this.lastPrompt = null; }
    get hub() { return this.app.hub; }
    get settings() { return this.app.settings; }
    get cfg() { return { prompt: true, raise: true, ...(this.settings.get('appraise') || {}) }; }
    ledger() { try { const z = this.app.bridge.getVariables({ type: 'chat' })?.诸天系统; return z && typeof z === 'object' ? z : null; } catch { return null; } }
    start() {
        const hub = this.hub;
        if (hub) {
            hub.register('appraise', { title: '品阶鉴定', render: el => { this.el = el; this.render(); } });
            hub.hook('onEngineTab', (n, tools) => this.link(n, tools));
            hub.hook('onEngineView', () => this.scheduleRaise());
            hub.hook('onPage', p => { if (p !== 'appraise') { this.from = p; this.note = ''; } });
        }
        this.app.hubSettings?.addSection({ title: '品阶鉴定', sub: '剧情里得到的功法 / 物品', items: [
            { type: 'switch', k: 'appraise.prompt', label: '提醒 AI 收录时写明品阶', desc: '每轮一行提示：按它本身的威力判断，不写会按凡品入账。' },
            { type: 'switch', k: 'appraise.raise', label: '「收录:功法名[更高品阶]」可以更正剧情功法的品阶', desc: '只对不是系统给的功法生效，只升不降。原版遇到同名功法会忽略这一行。' },
        ] });
        this.disposers.push(this.app.bridge.onChange(k => { if (k === 'chat') { this.syncPrompt(); this.scheduleRaise(); if (this.hub?.page === 'appraise') this.render(); } }));
        this.disposers.push(this.app.adapter.subscribe(() => this.syncPrompt()));
        this.disposers.push(this.settings.onChange(k => { if (k === 'appraise') { this.lastPrompt = null; this.syncPrompt(); } }));
        this.syncPrompt();
        return this;
    }
    syncPrompt() {
        try {
            const on = !!(this.app.adapter.currentIdentity() && this.cfg.prompt && this.ledger());
            const text = on ? GRADE_RULE : '';
            // SillyTavern empties its extension prompts when a chat is (re)loaded: compare with what is really there
            const live = this.app.bridge.livePrompt?.('grade') ?? text;
            if (text === this.lastPrompt && live === text) return; this.lastPrompt = text;
            if (text) this.app.bridge.injectPrompts([{ id: 'grade', content: text, position: 'in_chat', depth: 4, role: 'system' }]);
            else this.app.bridge.uninjectPrompts(['grade']);
        } catch (e) { console.warn('[诸天鉴定] 注入失败', e); }
    }
    /** 背包 tab of the engine: a link to this page (修行 has its own button in the 修行 strip). */
    link(n, tools) {
        tools.querySelector('.zt-appraise-link')?.remove();
        if (n !== 6) return;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'zt-btn small zt-appraise-link'; b.textContent = '品阶鉴定 ›';
        b.title = '剧情里得到、被记成凡品的物品可以在这里重新判定';
        b.addEventListener('click', () => this.hub.go('appraise'));
        tools.append(b);
    }
    // ---------- 收录 line raises ----------
    scheduleRaise() { clearTimeout(this.timer); this.timer = setTimeout(() => this.raiseFromPanel().catch(e => console.warn('[诸天鉴定] 收录更正未记录', e)), 700); }
    async raiseFromPanel() {
        if (!this.cfg.raise || this.busy) return null;
        const a = this.app.adapter, sb = this.app.statusbar;
        if (!a.currentIdentity() || a.isGenerating() || (sb?.state?.mode || 'terminal') !== 'terminal') return null;
        const lp = sb?.latestPanel?.(), chat = a.context()?.chat || [];
        if (!lp || lp.id !== chat.length - 1) return null;
        const z = this.ledger(), rec = z?.面板账本?.[String(lp.id)]; if (!z || !rec?.h) return null;
        const mark = `收录更正:${lp.id}:${rec.h}`;
        if (this.lastMark === mark || (z.功法记录 || []).some(r => r?.凭据 === mark)) return null;
        const ups = gradeRaises(z, panelField(lp.panel, '功法修炼'));
        if (!ups.length) { this.lastMark = mark; return null; }
        const done = await this.write(ups.map(u => ({ entry: u, grade: u.to })), { how: '收录更正', mark, floor: lp.id });
        this.lastMark = mark;
        if (done.length) this.hub?.toast?.(`品阶已更正：${done.map(d => `${d.name} ${d.from}→${d.to}`).join('，')}`, 3600);
        return done;
    }
    // ---------- writes ----------
    /** One commit for a list of { entry, grade }. Floor snapshots get the same change. Returns the changed ones. */
    async write(list, { how = 'AI', reason = '', mark = '', floor = null, token = capture(this.app) } = {}) {
        this.busy = true;
        try {
            const derive = (() => { try { const f = this.hub?.engineFrame?.contentWindow?.ztDerive; return typeof f === 'function' ? f : null; } catch { return null; } })();
            assertCapture(this.app, token);
            return await L.commit(this.app.bridge, (v, z) => {
                assertCapture(this.app, token);
                if (mark && (z.功法记录 || []).some(r => r?.凭据 === mark)) return [];
                const at = Date.now(), done = [];
                for (const { entry, grade, why } of list) {
                    const r = regrade(z, entry, grade, { how, reason: why || reason, at }); if (!r.changed) continue;
                    done.push(r);
                    // AI / 手动: the floor snapshots too (a swipe does not take it back). 收录更正 belongs to its floor: a swipe
                    // restores the snapshot with the receipt, and the new reply is judged again.
                    if (!mark) for (const p of Object.values(z.面板账本 || {})) if (p?.snap) try { regrade(p.snap, entry, grade, { how, reason: why || reason, at }); } catch { /* not in that snapshot */ }
                    if (entry.kind === 'skill') {
                        const log = Array.isArray(z.功法记录) ? z.功法记录 : (z.功法记录 = []);
                        log.push({ 名称: r.name, 变化: `品阶 ${r.from}→${r.to}（${how}）`, 时间: at, ...(floor != null ? { 楼层: floor } : {}), ...(mark ? { 凭据: mark } : {}) });
                        while (log.length > 30) log.shift();
                    }
                }
                if (done.length) { z.界面记账时间 = at; if (derive) try { derive(v); } catch { /* next engine write derives */ } }
                return done;
            }, z => [JSON.stringify((z.功法库 || []).map(s => [s?.名称, s?.品阶])), JSON.stringify((z.背包 || []).map(x => [x?.名称, x?.品级, x?.数量]))]);
        } finally { this.busy = false; }
    }
    /** Ask the model (分功能 API 品阶鉴定 → default connection → 酒馆主 API). */
    async appraise(entry) {
        const token = capture(this.app);
        const z = this.ledger(); if (!z) throw Error('当前聊天没有诸天账本，先在「设置 → 新聊天初始化」创建。');
        if (this.app.adapter.isGenerating()) throw Error('主聊天正在生成，请等它结束再鉴定。');
        const { system, user } = appraisePrompt(entry, z);
        let cfg = {}; try { cfg = readConfigs(this.app.bridge).status || {}; } catch { cfg = {}; }
        const custom = cfg.url ? { apiurl: cfg.url, key: cfg.key, model: cfg.model, max_tokens: 2048, temperature: 0.3 } : undefined;
        const text = await this.app.bridge.generateRaw({ user_input: user, ordered_prompts: [{ role: 'system', content: system }, 'user_input'], custom_api: custom, max_tokens: 2048, route: 'appraise' });
        assertCapture(this.app, token);
        const res = parseAppraisal(text);
        const done = await this.write([{ entry, grade: res.grade, why: res.reason }], { how: 'AI 鉴定', token });
        return { ...res, from: entry.grade, changed: done.length > 0 };
    }
    // ---------- page ----------
    render() {
        const el = this.el; if (!el) return;
        const z = this.ledger();
        if (!z) { el.innerHTML = '<div class="zt-empty">当前聊天没有诸天账本。<br>在「设置 → 新聊天初始化」创建后再来。</div>'; return; }
        const { skills, items } = candidates(z);
        const row = e => {
            const opts = APPRAISE_GRADES.filter(g => gi(g) > gi(e.grade)).map(g => `<option value="${g}">${g}</option>`).join('');
            const top = e.grade === '神品' || e.grade === '禁忌';
            const st = e.stamp ? `<span class="zt-desc">上次：${esc(e.stamp.方式 || '')} ${esc(e.stamp.原品阶 || '')}→${esc(e.stamp.品阶 || '')}${e.stamp.理由 ? ' · ' + esc(e.stamp.理由) : ''}</span>` : '';
            return `<div class="zt-row" data-ap-row="${esc(e.kind)}:${esc(e.key)}"><span><b style="font-weight:500">${esc(e.name)}</b> <span class="zt-grade" data-g="${esc(e.grade)}">${esc(e.grade)}</span> <small class="zt-desc" style="display:inline">${esc(e.extra)} · 来源 ${esc(e.src || '未记录')}</small>${e.desc ? `<span class="zt-desc">${esc(e.desc.slice(0, 80))}</span>` : ''}${st}</span>
<span class="zt-actions" style="flex-wrap:wrap;justify-content:flex-end">${top ? '<span class="zt-chip">已是最高</span>' : `<button type="button" class="zt-btn small" data-ap-ai>AI 鉴定</button><select data-ap-pick aria-label="手动修正品阶"><option value="">手动修正…</option>${opts}</select>`}</span></div>`;
        };
        el.innerHTML = `<div class="zt-eyebrow">APPRAISAL</div><h2 class="zt-h">品阶鉴定</h2>
<p class="zt-sub">剧情里得到、或从角色卡 / 旧存档来的功法和物品，系统没鉴定过，常被记成凡品。这里可以让 AI 按诸天统一标准重新鉴定，或者手动修正。<br><small>只升不降，最高神品；系统自己给的（商城、盲盒、熔炉、洞天、任务奖励、聊天群…）不在这里。物品改品阶后回收价不变。</small></p>
<div class="zt-actions" style="margin-bottom:10px"><button class="zt-btn" type="button" data-ap-back>‹ 返回</button></div>
<section class="zt-card"><h3>功法 <small>${skills.length} 部可鉴定</small></h3>${skills.map(row).join('') || '<div class="zt-note">没有需要鉴定的功法（系统给的功法由系统判定）。</div>'}</section>
<section class="zt-card"><h3>物品 <small>${items.length} 件可鉴定</small></h3>${items.map(row).join('') || '<div class="zt-note">背包里没有需要鉴定的物品。</div>'}</section>
<output class="zt-note" data-ap-out aria-live="polite">${esc(this.note || '')}</output>`;
        const out = el.querySelector('[data-ap-out]');
        const find = rowEl => { const [kind, ...k] = rowEl.dataset.apRow.split(':'), key = k.join(':'); const c = candidates(this.ledger() || {}); return (kind === 'skill' ? c.skills : c.items).find(e => e.key === key); };
        el.onclick = async e => {
            if (e.target.closest('[data-ap-back]')) return this.hub.go(this.from || 'cult');
            const b = e.target.closest('[data-ap-ai]'); if (!b || this.busy) return;
            const entry = find(b.closest('[data-ap-row]')); if (!entry) return this.render();
            b.disabled = true; b.textContent = '鉴定中…'; out.textContent = '';
            try {
                const r = await this.appraise(entry);
                const msg = r.changed ? `「${entry.name}」鉴定为〔${r.grade}〕（原 ${r.from}）。${r.reason ? '理由：' + r.reason : ''}` : `「${entry.name}」鉴定结果〔${r.grade}〕，不高于现在的〔${r.from}〕，保持不变。${r.reason ? '理由：' + r.reason : ''}`;
                this.note = msg; this.render(); this.hub.toast(msg, 4200);
                if (r.changed) this.hub.scheduleEngineView?.(150);
            } catch (err) { out.textContent = errorLine(err); b.disabled = false; b.textContent = 'AI 鉴定'; }
        };
        el.onchange = async e => {
            const s = e.target.closest('[data-ap-pick]'); if (!s || !s.value || this.busy) return;
            const entry = find(s.closest('[data-ap-row]')), g = s.value; if (!entry) return this.render();
            if (!globalThis.confirm(`把「${entry.name}」从〔${entry.grade}〕手动改为〔${g}〕？\n只升不降，改了就不能再调低。${entry.kind === 'item' ? '回收价保持原来的。' : '功法上限随品阶提高。'}`)) { s.value = ''; return; }
            try {
                const done = await this.write([{ entry, grade: g }], { how: '手动修正' });
                const msg = done.length ? `「${entry.name}」已改为〔${g}〕。` : '没有改动（品阶已经不低于所选）。';
                this.note = msg; this.render(); this.hub.toast(msg, 3000); this.hub.scheduleEngineView?.(150);
            } catch (err) { out.textContent = errorLine(err); s.value = ''; }
        };
    }
    dispose() { clearTimeout(this.timer); this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); try { this.app.bridge.uninjectPrompts(['grade']); } catch { /* ignore */ } }
}
