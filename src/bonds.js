import { esc } from './hub.js';
import { listBonds, keepPerson, pullMember, dropPulled, pulledEntry } from './bonds-data.js';
import { capture, checkedCommit, audit, cleanText } from './action-support.js';

// 1.1.2 羁绊页重做: filter chips (本世界 first) · person list with avatar / relation / 好感 bar · a readable detail card
// instead of raw key/value dumps. Chat-group members only appear after「拉入羁绊」(聊天群 / 关系图).
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = v => Math.max(0, Math.min(100, num(v)));
const HIDE = new Set(['id', 'source', '姓名', '名称', '群员ID', '群员拉入', '群内', '世界', '关系', '好感度', '黑化值', '悔意值']);
const LABELS = [['性格', '性格'], ['身份', '身份'], ['外貌', '外貌'], ['状态', '状态'], ['特产', '特产'], ['忠诚', '忠诚'], ['实力档', '实力档'], ['说明', '说明'], ['备注', '备注']];
const FILTERS = [['here', '本世界'], ['all', '全部'], ['love', '恋人 / 攻略'], ['summon', '打手'], ['group', '群友']];
/** Relation family → accent colour and filter bucket. Pure. */
export function relKind(p) {
    if (p.source === 'summon') return 'summon';
    if (p.群员ID) return 'group';
    return /恋|爱|攻略|伴侣|妻|夫|情/.test(String(p.关系 || '')) ? 'love' : 'bond';
}
/** 好感 stage label. Pure. */
export function favorStage(v) { const n = clamp(v); return n >= 80 ? '挚爱' : n >= 60 ? '亲密' : n >= 40 ? '友好' : n >= 20 ? '熟识' : '陌生'; }
/** Which people a filter shows. Pure. */
export function filterPeople(people, filter, world) {
    if (filter === 'here') return people.filter(p => !!world && String(p.世界 || '') === String(world));
    if (filter === 'love') return people.filter(p => relKind(p) === 'love');
    if (filter === 'summon') return people.filter(p => p.source === 'summon');
    if (filter === 'group') return people.filter(p => relKind(p) === 'group');
    return people;
}
const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
const avatar = (p, big = false) => `<span class="zt-bd-av${big ? ' big' : ''}" style="--h:${hue(p.姓名 + (p.世界 || ''))}" aria-hidden="true">${esc(Array.from(String(p.姓名 || '?'))[0] || '?')}</span>`;
const value = v => Array.isArray(v) ? v.map(x => `<span class="zt-chip">${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</span>`).join(' ')
    : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `<span class="zt-chip">${esc(k)} ${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</span>`).join(' ') : esc(v);

export class Bonds {
    constructor(app) { this.app = app; this.selected = ''; this.filter = ''; this.query = ''; }
    start() {
        const h = this.app.hub; if (!h) return this;
        h.register('bond', { title: '多人羁绊', render: el => { this.el = el; this.render(); } });
        this.off = this.app.adapter.subscribe(() => { if (this.identity !== this.app.adapter.currentIdentity()) { this.selected = ''; this.filter = ''; this.identity = this.app.adapter.currentIdentity(); if (h.page === 'bond') this.render(); } }); return this;
    }
    open(id) { this.selected = id; this.filter = 'all'; this.app.hub.go('bond'); }
    /** 1.1.2「拉入羁绊」from 聊天群 / 关系图: one verified write, then the person is shown here. */
    async pull(memberId) {
        const z = this.app.adapter.ledger(); if (!z) throw Error('请打开已初始化的聊天');
        const known = pulledEntry(z, memberId); if (known) { this.open(known.id); return known; }
        const token = capture(this.app); let saved;
        await checkedCommit(this.app, token, cur => { saved = pullMember(cur, memberId); audit(cur, 'bond', `拉入羁绊：${saved.姓名}（${saved.世界}），无奖励结算`); });
        this.app.hub.toast(`已把 ${saved.姓名} 拉入羁绊`, 3000); this.open(saved.id); return saved;
    }
    render() {
        const el = this.el; if (!el) return;
        const z = this.app.adapter.ledger(); if (!z) { el.innerHTML = '<p>请打开已初始化的聊天。</p>'; return; }
        const world = String(z.当前世界 || ''), people = listBonds(z), hereCount = filterPeople(people, 'here', world).length;
        if (!this.filter) this.filter = hereCount ? 'here' : 'all';
        const q = this.query.trim().toLowerCase();
        const shown = filterPeople(people, this.filter, world).filter(p => !q || [p.姓名, p.世界, p.关系, p.说明].join(' ').toLowerCase().includes(q));
        const person = shown.find(p => p.id === this.selected) || shown.find(p => p.id === z.当前羁绊ID) || shown[0] || null;
        this.selected = person?.id || '';
        const count = id => filterPeople(people, id, world).length;
        const chips = FILTERS.map(([id, label]) => `<button type="button" class="zt-bd-filter${this.filter === id ? ' on' : ''}" data-filter="${id}" aria-pressed="${this.filter === id}">${label}<b>${count(id)}</b></button>`).join('');
        const row = p => `<button type="button" class="zt-bd-person${p.id === person?.id ? ' on' : ''}" data-person="${esc(p.id)}" data-kind="${relKind(p)}">${avatar(p)}<span class="zt-bd-pmain"><b>${esc(p.姓名)}${p.id === z.当前羁绊ID ? ' <i class="zt-bd-star" title="当前攻略目标">★</i>' : ''}</b><small>${esc(p.世界 || '未记录')} · ${esc(p.关系 || '羁绊')}</small>${p.source === 'summon' ? `<span class="zt-bd-bar" style="--v:${clamp(p.忠诚)}%" title="忠诚 ${clamp(p.忠诚)}"></span>` : `<span class="zt-bd-bar" style="--v:${clamp(p.好感度)}%" title="好感 ${clamp(p.好感度)}"></span>`}</span></button>`;
        const here = shown.filter(p => world && p.世界 === world), other = shown.filter(p => !(world && p.世界 === world));
        const list = shown.length ? (this.filter === 'all' && here.length && other.length
            ? `<p class="zt-bd-group">本世界 · ${esc(world)}</p>${here.map(row).join('')}<p class="zt-bd-group">其他世界</p>${other.map(row).join('')}`
            : shown.map(row).join(''))
            : `<div class="zt-bd-empty">${q ? '没有匹配的人物。' : this.filter === 'here' ? `本世界${world ? `「${esc(world)}」` : ''}还没有羁绊。` : this.filter === 'group' ? '还没有群友。到聊天群的群员页或关系图里点「拉入羁绊」。' : '这里还没有人物。'}</div>`;
        el.innerHTML = `<div class="zt-bd">
<header class="zt-bd-head"><div><h3>多人羁绊</h3><small>${world ? `当前世界 · ${esc(world)} · 本世界 ${hereCount} 人 / 共 ${people.length} 人` : `共 ${people.length} 人 · 当前世界未记录`}</small></div><input type="search" data-search value="${esc(this.query)}" placeholder="搜索人物 / 世界 / 关系" aria-label="搜索羁绊"></header>
<nav class="zt-bd-filters" aria-label="筛选">${chips}</nav>
<div class="zt-bd-grid"><div class="zt-bd-list" role="list">${list}</div>${person ? this.detail(person, z) : '<article class="zt-bd-detail zt-bd-empty">选择左侧人物查看详情。</article>'}</div>
<p class="zt-note zt-bd-tip">选择只切换查看，不更换攻略目标、不发奖。聊天群群员默认不进羁绊，可在聊天群的群员页或关系图里「拉入羁绊」。同名不同世界不合并。</p>
<details class="zt-card zt-bd-form"><summary>补录人物 / 更新多人关系（不扣费、不发奖）</summary><form><div class="zt-bd-fields"><label>姓名<input name="name" maxlength="60" required placeholder="姓名" value="${person?.source === 'bond' ? esc(person.姓名) : ''}"></label><label>来源世界<input name="world" maxlength="80" value="${esc(person?.source === 'bond' ? person.世界 : world)}" placeholder="同名人物用世界区分"></label><label>关系<input name="relation" maxlength="40" placeholder="朋友 / 对手 / 恋人" value="${person?.source === 'bond' ? esc(person.关系 || '') : ''}"></label><label>好感度<input name="favor" type="number" min="0" max="100" placeholder="0–100" value="${person?.source === 'bond' && person.好感度 != null ? clamp(person.好感度) : ''}"></label></div><label>说明<textarea name="notes" maxlength="600" rows="2" placeholder="可选">${person?.source === 'bond' ? esc(person.说明 || '') : ''}</textarea></label><div class="zt-actions"><button class="zt-btn primary">保存人物</button></div></form></details>
<p role="status" class="zt-note"></p></div>`;
        const search = el.querySelector('[data-search]');
        search.oninput = e => { this.query = e.target.value; const pos = e.target.selectionStart; this.render(); const s = this.el.querySelector('[data-search]'); s.focus({ preventScroll: true }); try { s.setSelectionRange(pos, pos); } catch { /* type=search */ } };
        el.querySelector('form').onsubmit = async e => {
            e.preventDefault(); const fd = new FormData(e.target); if (!String(fd.get('world') || '').trim()) return this.message('请填写人物来源世界');
            await this.run(async () => {
                const token = capture(this.app), p = { 姓名: cleanText(fd.get('name'), 60), 世界: cleanText(fd.get('world'), 80), 关系: cleanText(fd.get('relation'), 40) || '羁绊' };
                const notes = cleanText(fd.get('notes'), 600); if (notes) p.说明 = notes;
                if (fd.get('favor') !== '') p.好感度 = clamp(fd.get('favor'));
                await checkedCommit(this.app, token, z => { const saved = keepPerson(z, p); this.selected = saved.id; if (z.当前羁绊ID === saved.id) z.恋爱目标 = { ...saved }; audit(z, 'bond', `更新人物 ${p.姓名}（${p.世界}），无奖励结算`); });
                this.filter = 'all'; this.render(); this.message('已保存');
            });
        };
        el.onclick = e => {
            const b = e.target.closest('button'); if (!b || b.closest('form')) return;
            if (b.dataset.filter) { this.filter = b.dataset.filter; this.selected = ''; return this.render(); }
            if (b.dataset.person) { this.selected = b.dataset.person; return this.render(); }
            if (!person) return;
            if (b.hasAttribute('data-graph')) this.app.atlas?.focus('bonds', person.source === 'summon' ? 'bond:s:' + (z.打手 || []).findIndex(x => (x.姓名 || x.名称) === person.姓名) : 'bond:p:' + person.id);
            if (b.hasAttribute('data-active')) this.run(async () => {
                if (!confirm(`将${person.姓名}（${person.世界}）设为旧版正文协议的当前攻略目标？仅切换目标，不结算奖励。`)) return;
                const token = capture(this.app); await checkedCommit(this.app, token, z => { const p = z.羁绊库?.find(x => x.id === person.id) || keepPerson(z, person); z.当前羁绊ID = p.id; z.恋爱目标 = { ...p }; delete z.恋爱目标.source; delete z.恋爱目标.群内; audit(z, 'bond', `切换攻略目标：${p.姓名}`); }); this.render();
            });
            if (b.hasAttribute('data-drop')) this.run(async () => {
                if (!confirm(`把 ${person.姓名} 移出羁绊？聊天群里的群员不受影响，之后还可以再拉进来。`)) return;
                const token = capture(this.app); let r; await checkedCommit(this.app, token, z => { r = dropPulled(z, person.id); audit(z, 'bond', `${r.removed ? '移出羁绊' : '解除群员关联'}：${person.姓名}`); });
                this.selected = ''; this.render(); this.message(r.removed ? `已把 ${person.姓名} 移出羁绊` : `${person.姓名} 原本就在羁绊里，只解除了和群员的关联`);
            });
            if (b.hasAttribute('data-group')) { this.app.hub.go('group'); const g = this.app.group; if (g) { g.view = 'members'; g.pm = person.群员ID; g.paint(true); } }
            if (b.hasAttribute('data-summon')) this.app.hub.go('plug');
        };
    }
    detail(p, z) {
        const kind = relKind(p), fav = clamp(p.好感度), meters = [];
        if (p.source === 'summon') meters.push(['忠诚', clamp(p.忠诚), '']);
        else { meters.push(['好感度', fav, favorStage(fav)]); if (p.黑化值 != null) meters.push(['黑化值', clamp(p.黑化值), '', 'dark']); if (p.悔意值 != null) meters.push(['悔意值', clamp(p.悔意值), '', 'regret']); }
        const known = LABELS.filter(([k]) => p[k] != null && p[k] !== '' && !(p.source === 'summon' && k === '忠诚'));
        const extra = Object.entries(p).filter(([k, v]) => !HIDE.has(k) && !LABELS.some(([x]) => x === k) && v != null && v !== '' && !k.startsWith('__'));
        const g = p.群内;
        const actions = [
            '<button type="button" class="zt-btn small" data-graph>在关系图查看</button>',
            p.source === 'bond' && p.id !== z.当前羁绊ID ? '<button type="button" class="zt-btn small" data-active>设为攻略目标</button>' : '',
            g?.在群 ? '<button type="button" class="zt-btn small" data-group>去群聊</button>' : '',
            p.群员ID && p.id !== z.当前羁绊ID ? '<button type="button" class="zt-btn small danger" data-drop>移出羁绊</button>' : '',
            p.source === 'summon' ? '<button type="button" class="zt-btn small" data-summon>打开打手页</button>' : '',
        ].join('');
        return `<article class="zt-bd-detail" data-kind="${kind}">
<div class="zt-bd-hero">${avatar(p, true)}<div><h3>${esc(p.姓名)}</h3><div class="zt-bd-tags"><span class="zt-chip">${esc(p.世界 || '未记录')}</span><span class="zt-chip zt-bd-rel">${esc(p.关系 || '羁绊')}</span>${p.id === z.当前羁绊ID ? '<span class="zt-chip on">★ 当前攻略目标</span>' : ''}${z.当前世界 && p.世界 === z.当前世界 ? '<span class="zt-chip">本世界</span>' : ''}</div></div></div>
<div class="zt-bd-meters">${meters.map(([k, v, stage, cls = '']) => `<div class="zt-bd-meter ${cls}"><span>${k}<b>${v}</b>${stage ? `<em>${stage}</em>` : ''}</span><i style="--v:${v}%"></i></div>`).join('')}</div>
${known.length ? `<dl class="zt-bd-info">${known.map(([k, label]) => `<dt>${label}</dt><dd>${value(p[k])}</dd>`).join('')}</dl>` : ''}
${g ? `<div class="zt-bd-groupinfo">${g.在群 ? `聊天群 · ${esc(g.身份 || '群员')}${g.实力档 != null ? ` · 实力档 ${esc(g.实力档)}` : ''} · 群内好感 ${clamp(g.好感)}` : '已不在聊天群里（羁绊保留）'}</div>` : ''}
${extra.length ? `<details class="zt-bd-more"><summary>其他记录（${extra.length}）</summary><dl class="zt-bd-info">${extra.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${value(v)}</dd>`).join('')}</dl></details>` : ''}
<div class="zt-actions">${actions}</div></article>`;
    }
    message(s) { const el = this.el?.querySelector('[role=status]'); if (el) el.textContent = s; }
    async run(f) { if (this.busy) return; this.busy = true; try { await f(); } catch (e) { this.message(e.message); } finally { this.busy = false; } }
    dispose() { this.off?.(); }
}
