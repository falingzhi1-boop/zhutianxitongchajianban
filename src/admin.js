// 1.1.2 · 管理员控制台（终端内新页面）.
// The original 3.1 overlay (still reachable as「原版面板」) knew 系统点 / 专属资源 / 恋爱目标 / 主修功法 / 货币 / 实力档.
// This page adds what later versions introduced — 盲盒保底, every 羁绊 (not only the current target), group members'
// 好感 — and writes only the fields the player actually changed, in ONE verified write (checkedCommit). A field that
// changed in the ledger since the page was read is a conflict: nothing is written.
// Edits of 专属资源 are also applied as a delta to every floor snapshot (面板账本[*].snap), so a later swipe /
// regenerate (重roll 记账回滚) or the engine's own rollback keeps the admin change instead of undoing it.
import { esc } from './hub.js';
import { capture, checkedCommit, audit, refreshEngine } from './action-support.js';
import { listBonds, migrateBonds } from './bonds-data.js';
import { XIAN_PITY, SHEN_PITY, shenCounter } from './commerce-plan.js';

export const RES_KEYS = Object.freeze(['天命印记', '血脉结晶', '因果筹码', '名望', '岁月沉淀']);
const intOf = (v, d = 0) => { const n = Math.floor(Number(String(v ?? '').replace(/,/g, ''))); return Number.isFinite(n) ? n : d; };
const show = v => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const sameValue = (a, b) => show(a) === show(b);

/** Plain dotted-path field: [group, path, label, type, min, max, hint]. */
export const ADMIN_FIELDS = Object.freeze([
    ['资产', '系统点', '系统点', 'int', 0, Number.MAX_SAFE_INTEGER],
    ['资产', '子系统数量', '子系统数量', 'int', 0, 999],
    ['资产', '子嗣数量', '子嗣数量', 'int', 0, 9999],
    ['资产', '当前货币', '当前货币', 'text'],
    ['资产', '持有金额', '持有金额', 'text'],
    ...RES_KEYS.map(k => ['专属资源', '专属资源.' + k, k, 'int', 0, Number.MAX_SAFE_INTEGER]),
    ['实力', '宿主实力档', '宿主实力档', 'int', 1, 8, '1–8'],
    ['实力', '世界上限档', '本世界上限档', 'int', 1, 8, '1–8'],
    ['实力', '商城等级下限', '商城等级下限', 'int', 1, 5, '1–5'],
    ['功法', '功法.名称', '主修功法', 'text'],
    ['功法', '功法.熟练度', '熟练度（当前值）', 'int', 0, Number.MAX_SAFE_INTEGER],
    ['功法', '功法.上限', '上限（品阶上限）', 'int', 1, Number.MAX_SAFE_INTEGER],
    ['盲盒', '盲盒状态.保底计数', '仙品保底计数', 'int', 0, XIAN_PITY - 1, `0–${XIAN_PITY - 1}`],
    ['盲盒', '盲盒状态.神品保底计数', '神品保底计数', 'int', 0, SHEN_PITY - 1, `0–${SHEN_PITY - 1}`],
    ['盲盒', '盲盒状态.累计抽数', '累计抽数', 'int', 0, Number.MAX_SAFE_INTEGER],
    ['盲盒', '盲盒状态.仙品次数', '仙品次数', 'int', 0, Number.MAX_SAFE_INTEGER],
    ['盲盒', '盲盒状态.神品次数', '神品次数', 'int', 0, Number.MAX_SAFE_INTEGER],
]);
const getPath = (o, p) => p.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
function setPath(o, p, v) { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) { if (!x[k] || typeof x[k] !== 'object') x[k] = {}; x = x[k]; } x[ks.at(-1)] = v; }
/** What the page shows for a path (神品保底计数 of an old save is derived, like the gacha does). */
export function readField(z, path) { return path === '盲盒状态.神品保底计数' ? shenCounter(z?.盲盒状态 || {}) : getPath(z, path); }

/** Person / member targets: 好感度 · 黑化值 · 悔意值 of a 羁绊库 entry, 好感 of a chat-group member. */
export const PERSON_KEYS = Object.freeze(['好感度', '黑化值', '悔意值']);
const personOf = (z, id) => (Array.isArray(z?.羁绊库) ? z.羁绊库 : []).find(p => p?.id === id);
const memberOf = (z, id) => (Array.isArray(z?.聊天群?.成员) ? z.聊天群.成员 : []).find(m => m?.id === id);

/**
 * Form values → the list of changes. `loaded` is the ledger as the page showed it; `values` maps field keys to the
 * typed strings ('' = leave alone). Throws a readable error on an invalid value. Pure.
 *   keys: 'f:<path>' plain fields · 'p:<bondId>:<key>' persons · 'm:<memberId>' member 好感
 */
export function planAdmin(loaded, values) {
    const out = [];
    for (const [key, raw] of Object.entries(values || {})) {
        const text = String(raw ?? '').trim(); if (text === '') continue;
        let label, from, type = 'int', min = 0, max = 100, target;
        if (key.startsWith('f:')) {
            const f = ADMIN_FIELDS.find(x => x[1] === key.slice(2)); if (!f) continue;
            [, , label, type, min = 0, max = Number.MAX_SAFE_INTEGER] = f; target = { kind: 'field', path: f[1] }; from = readField(loaded, f[1]);
        } else if (key.startsWith('p:')) {
            const rest = key.slice(2), k = PERSON_KEYS.find(x => rest.endsWith(':' + x)); if (!k) continue;
            const id = rest.slice(0, -(k.length + 1)), p = personOf(loaded, id); if (!p) continue;
            label = `${p.姓名}（${p.世界}）${k}`; target = { kind: 'person', id, key: k }; from = p[k];
        } else if (key.startsWith('m:')) {
            const m = memberOf(loaded, key.slice(2)); if (!m) continue;
            label = `群员 ${m.名称} 好感`; target = { kind: 'member', id: m.id }; from = m.好感;
        } else continue;
        if (sameValue(from, text)) continue;
        let to = text;
        if (type === 'int') {
            if (!/^-?[\d,]+$/.test(text)) throw Error(`${label} 须为整数`);
            to = intOf(text);
            if (!Number.isSafeInteger(to) || to < min || to > max) throw Error(`${label} 须在 ${min.toLocaleString()}–${max.toLocaleString()} 之间`);
            if (sameValue(from, to)) continue;
        } else if (text.length > 60) throw Error(`${label} 最多 60 字`);
        out.push({ key, label, from, to, target });
    }
    return out;
}
const current = (z, t) => t.kind === 'field' ? readField(z, t.path) : t.kind === 'person' ? personOf(z, t.id)?.[t.key] : memberOf(z, t.id)?.好感;

/**
 * Apply planned changes to the live ledger `z` (inside checkedCommit). Every target must still hold the value the page
 * read — otherwise nothing is applied. `syncSkill` is the original ztAdminSyncSkill (engine frame), needed for 功法.
 * Returns the change list. Mutates `z`.
 */
export function applyAdmin(z, changes, { syncSkill } = {}) {
    if (changes.some(c => c.target.kind === 'person')) migrateBonds(z);
    for (const c of changes) {
        if (c.target.kind === 'person' && !personOf(z, c.target.id)) throw Error(`账本里已经没有 ${c.label.split('（')[0]}，未写入任何改动`);
        if (c.target.kind === 'member' && !memberOf(z, c.target.id)) throw Error(`${c.label.replace(/ 好感$/, '')} 已不在群里，未写入任何改动`);
        if (!sameValue(current(z, c.target), c.from)) throw Error(`账本已变化：${c.label} 现在是 ${show(current(z, c.target)) || '空'}（页面读到的是 ${show(c.from) || '空'}）。未写入任何改动，请点「重新读取」后再改`);
    }
    const skill = changes.some(c => c.target.kind === 'field' && c.target.path.startsWith('功法.'));
    if (skill && typeof syncSkill !== 'function') throw Error('修改主修功法需要诸天系统页面已加载：先打开终端「概览」页，再回来保存。未写入任何改动');
    const resDelta = {};
    for (const c of changes) {
        const t = c.target;
        if (t.kind === 'field') {
            if (t.path.startsWith('专属资源.')) { const k = t.path.slice(5); resDelta[k] = intOf(c.to) - intOf(c.from); if (!z.专属资源 || typeof z.专属资源 !== 'object') z.专属资源 = {}; }
            if (t.path.startsWith('盲盒状态.') && (!z.盲盒状态 || typeof z.盲盒状态 !== 'object')) z.盲盒状态 = {};
            if (t.path === '盲盒状态.神品保底计数' && z.盲盒状态.神品保底计数 === undefined) z.盲盒状态.神品保底计数 = shenCounter(z.盲盒状态);
            setPath(z, t.path, c.to);
        } else if (t.kind === 'person') {
            const p = personOf(z, t.id); p[t.key] = c.to;
            if (z.当前羁绊ID === t.id && z.恋爱目标 && typeof z.恋爱目标 === 'object') z.恋爱目标[t.key] = c.to;
        } else memberOf(z, t.id).好感 = c.to;
    }
    const snaps = Object.values(z.面板账本 && typeof z.面板账本 === 'object' ? z.面板账本 : {}).filter(r => r?.snap && typeof r.snap === 'object');
    if (skill) {
        // the original also copies today's 专属资源 into every snapshot — keep ours (a reroll must not stack gains again)
        const keep = snaps.map(r => [r, r.snap.专属资源 === undefined ? undefined : structuredClone(r.snap.专属资源)]);
        syncSkill(z);
        for (const [r, res] of keep) { if (res === undefined) delete r.snap.专属资源; else r.snap.专属资源 = res; }
    }
    for (const r of snaps) for (const [k, d] of Object.entries(resDelta)) {
        if (!d || !r.snap.专属资源 || typeof r.snap.专属资源 !== 'object') continue;
        r.snap.专属资源[k] = Math.max(0, intOf(r.snap.专属资源[k]) + d);
    }
    return changes;
}

export class AdminConsole {
    constructor(app) { this.app = app; this.person = ''; this.member = ''; }
    start() {
        const h = this.app.hub; if (!h) return this;
        h.register('admin', { title: '管理员控制台', render: el => { this.el = el; this.render(); } });
        // chat switched while the page is visible → re-read it (unsaved edits belonged to the old chat)
        this.off = this.app.adapter.subscribe?.(() => { if (this.el && h.page === 'admin' && this.id !== this.app.adapter.currentIdentity()) this.render(); });
        return this;
    }
    open() { this.app.hub.go('admin'); }
    render() {
        const el = this.el; if (!el) return;
        const z = this.app.adapter.ledger();
        if (!z) { el.innerHTML = '<div class="zt-empty">当前聊天还没有诸天账本，先在「设置 → 新聊天初始化」创建。</div>'; return; }
        this.loaded = structuredClone(z); this.id = this.app.adapter.currentIdentity();
        const people = listBonds(z).filter(p => p.source === 'bond'), members = (z.聊天群?.成员 || []).filter(m => m?.id);
        if (!people.some(p => p.id === this.person)) this.person = people.find(p => p.id === z.当前羁绊ID)?.id || people[0]?.id || '';
        if (!members.some(m => m.id === this.member)) this.member = members[0]?.id || '';
        const engine = typeof this.app.hub.engineFrame?.contentWindow?.ztAdminSyncSkill === 'function';
        const input = (key, label, val, { type = 'int', min, max, hint = '', disabled = false } = {}) => `<label class="zt-adm-field"><span>${esc(label)}</span><input data-key="${esc(key)}" data-initial="${esc(show(val))}" value="${esc(show(val))}" ${type === 'int' ? 'inputmode="numeric"' : ''} placeholder="${esc(show(val) || '未记录')}" ${min !== undefined ? `data-min="${min}"` : ''} ${disabled ? 'disabled' : ''} autocomplete="off">${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
        const group = (name, sub, extra = '') => {
            const fields = ADMIN_FIELDS.filter(f => f[0] === name);
            return `<section class="zt-card zt-adm-sec"><h3>${name} <small>${sub}</small></h3>${extra}<div class="zt-adm-grid">${fields.map(f => input('f:' + f[1], f[2], readField(z, f[1]), { type: f[3], min: f[4], max: f[5], hint: f[6], disabled: name === '功法' && !engine })).join('')}</div></section>`;
        };
        const g = z.盲盒状态 || {}, xianLeft = Math.max(1, XIAN_PITY - intOf(g.保底计数)), shenLeft = Math.max(1, SHEN_PITY - shenCounter(g));
        const person = people.find(p => p.id === this.person), member = members.find(m => m.id === this.member);
        el.innerHTML = `<div class="zt-adm">
<header class="zt-adm-head"><div><h3>管理员控制台</h3><small>直接改账本，慎用。只写入你改过的项，一次加锁写入并读回核对；页面打开后账本有变化会拒绝写入。</small></div><button type="button" class="zt-btn small" data-original>打开原版面板</button></header>
${group('资产', '持有金额 / 当前货币 是自由文本')}
${group('专属资源', '同时修正各楼层快照，之后 swipe / 重新生成不会把改动回滚掉')}
${group('实力', '影响商城等级与世界书实时数据')}
${group('功法', engine ? '同步功法库与主修，和原版面板相同' : '需要先打开终端「概览」页加载诸天系统，才能修改功法', '')}
${group('盲盒', `距仙品保底 ${xianLeft} 抽 · 距神品保底 ${shenLeft} 抽（计数到 ${XIAN_PITY - 1} / ${SHEN_PITY - 1} 时下一抽必出）`)}
<section class="zt-card zt-adm-sec"><h3>羁绊 <small>改任意一位的好感 / 黑化 / 悔意；当前攻略目标会同步到「恋爱目标」</small></h3>
${people.length ? `<label class="zt-adm-pick">人物 <select data-pick="person">${people.map(p => `<option value="${esc(p.id)}"${p.id === this.person ? ' selected' : ''}>${esc(p.姓名)} · ${esc(p.世界)}${p.id === z.当前羁绊ID ? ' ★' : ''}</option>`).join('')}</select></label>
<div class="zt-adm-grid">${person ? PERSON_KEYS.map(k => input(`p:${person.id}:${k}`, k, person[k], { min: 0, max: 100, hint: '0–100' })).join('') : ''}</div>` : '<p class="zt-note">还没有羁绊人物。</p>'}</section>
<section class="zt-card zt-adm-sec"><h3>聊天群 <small>群员好感（0–100）</small></h3>
${members.length ? `<label class="zt-adm-pick">群员 <select data-pick="member">${members.map(m => `<option value="${esc(m.id)}"${m.id === this.member ? ' selected' : ''}>${esc(m.名称)} · ${esc(m.世界 || '')}</option>`).join('')}</select></label>
<div class="zt-adm-grid">${member ? input('m:' + member.id, '好感', member.好感, { min: 0, max: 100, hint: '0–100' }) : ''}</div>` : '<p class="zt-note">群里还没有群员。</p>'}</section>
<div class="zt-adm-bar"><span data-count>没有改动</span><button type="button" class="zt-btn small" data-reset>撤销改动</button><button type="button" class="zt-btn small" data-reload>重新读取</button><button type="button" class="zt-btn primary" data-save disabled>写入账本</button></div>
<p role="status" class="zt-note"></p></div>`;
        const count = () => { const n = [...el.querySelectorAll('input[data-key]')].filter(i => i.value.trim() !== '' && i.value.trim() !== i.dataset.initial).length; el.querySelector('[data-count]').textContent = n ? `${n} 项改动未保存` : '没有改动'; el.querySelector('[data-save]').disabled = !n; return n; };
        el.oninput = e => { const i = e.target.closest('input[data-key]'); if (!i) return; i.classList.toggle('changed', i.value.trim() !== '' && i.value.trim() !== i.dataset.initial); count(); };
        el.onchange = e => {
            const s = e.target.closest('select[data-pick]'); if (!s) return;
            if (count() && !confirm('切换人物会丢掉还没保存的改动，继续？')) { s.value = s.dataset.pick === 'person' ? this.person : this.member; return; }
            if (s.dataset.pick === 'person') this.person = s.value; else this.member = s.value; this.render();
        };
        el.onclick = e => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.hasAttribute('data-original')) return this.app.hub.openOriginalAdmin().catch(err => this.message(err.message));
            if (b.hasAttribute('data-reset')) { el.querySelectorAll('input[data-key]').forEach(i => { i.value = i.dataset.initial; i.classList.remove('changed'); }); return count(); }
            if (b.hasAttribute('data-reload')) { if (count() && !confirm('重新读取会丢掉还没保存的改动，继续？')) return; return this.render(); }
            if (b.hasAttribute('data-save')) return this.save();
        };
    }
    async save() {
        if (this.busy) return; const el = this.el;
        const values = Object.fromEntries([...el.querySelectorAll('input[data-key]')].filter(i => !i.disabled).map(i => [i.dataset.key, i.value]));
        // the page belongs to the chat it was read from — never apply chat A's form to chat B
        if (this.app.adapter.currentIdentity() !== this.id) { this.render(); return this.message('聊天已切换，页面已按当前聊天重新读取；未写入任何改动。'); }
        let changes; try { changes = planAdmin(this.loaded, values); } catch (e) { return this.message(e.message); }
        if (!changes.length) return this.message('没有需要写入的改动。');
        const list = changes.map(c => `${c.label}：${show(c.from) || '空'} → ${show(c.to)}`);
        if (!confirm(`写入以下 ${changes.length} 项改动？\n\n${list.join('\n')}`)) return;
        this.busy = true; el.querySelector('[data-save]').disabled = true;
        try {
            const token = capture(this.app), syncSkill = this.app.hub.engineFrame?.contentWindow?.ztAdminSyncSkill;
            await checkedCommit(this.app, token, z => { applyAdmin(z, changes, { syncSkill }); audit(z, 'admin', `管理员修改：${list.join('；')}`); });
            refreshEngine(this.app); this.render(); this.message(`已写入 ${changes.length} 项并核对服务器存档。AI 下一次回复按新数值。`);
            this.app.hub.toast('管理员改动已保存', 3000);
        } catch (e) { this.message(e.message); el.querySelector('[data-save]').disabled = false; }
        finally { this.busy = false; }
    }
    message(s) { const m = this.el?.querySelector('[role=status]'); if (m) m.textContent = s; }
    dispose() { this.off?.(); this.off = null; this.el = null; }
}
