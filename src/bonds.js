import { esc } from './hub.js';
import { listBonds, keepPerson } from './bonds-data.js';
import { capture, checkedCommit, audit, cleanText } from './action-support.js';
export class Bonds {
    constructor(app) { this.app = app; this.selected = ''; }
    start() {
        const h = this.app.hub; if (!h) return this;
        h.register('bond', { title: '多人羁绊', render: el => { this.el = el; this.render(); } });
        this.off = this.app.adapter.subscribe(() => { if (this.identity !== this.app.adapter.currentIdentity()) { this.selected = ''; this.identity = this.app.adapter.currentIdentity(); if (h.page === 'bond') this.render(); } }); return this;
    }
    open(id) { this.selected = id; this.app.hub.go('bond'); }
    render() {
        const el = this.el; if (!el) return;
        const z = this.app.adapter.ledger(); if (!z) { el.innerHTML = '<p>请打开已初始化的聊天。</p>'; return; }
        const people = listBonds(z), person = people.find(p => p.id === this.selected) || people.find(p => p.id === z.当前羁绊ID) || people[0];
        if (person) this.selected = person.id;
        el.innerHTML = `<h3>多人羁绊</h3><p class="zt-note">选择只切换查看，不更换攻略目标、不发奖。恋爱、朋友、打手、群员分别保留身份；同名不同世界不合并。</p><input data-search placeholder="搜索人物 / 世界 / 关系" aria-label="搜索羁绊"><div class="zt-actions" data-people>${people.map(p => `<button class="zt-btn ${person?.id === p.id ? 'primary' : ''}" data-person="${esc(p.id)}" data-text="${esc(p.姓名 + ' ' + p.世界 + ' ' + p.关系)}">${esc(p.姓名)} · ${esc(p.世界)} / ${esc(p.关系)}</button>`).join('')}</div>
${person ? `<article class="zt-card"><h3>${esc(person.姓名)}</h3>${Object.entries(person).filter(([k, v]) => !['id', 'source'].includes(k) && v != null).map(([k, v]) => `<p><small>${esc(k)}</small>　${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</p>`).join('')}<div class="zt-actions"><button class="zt-btn" data-graph>在关系图查看</button>${person.source === 'bond' ? '<button class="zt-btn" data-active>设为当前攻略目标（不结算奖励）</button>' : person.source === 'group' ? '<button class="zt-btn" data-group>在聊天群查看</button>' : '<button class="zt-btn" data-summon>打开打手页</button>'}</div></article>` : '<p>暂无人物，可从旧目标迁移、聊天群/打手读取，或手动补录。</p>'}
<details class="zt-card"><summary>补录人物 / 更新多人关系（不扣费、不发奖）</summary><form><input name="name" maxlength="60" required placeholder="姓名"><input name="world" maxlength="80" value="${esc(z.当前世界 || '')}" placeholder="来源世界（同名人物用世界区分）"><input name="relation" maxlength="40" placeholder="关系，如朋友/对手/恋人"><input name="favor" type="number" min="0" max="100" placeholder="好感（不填不改）"><textarea name="notes" maxlength="600" placeholder="已确认的关系说明"></textarea><button class="zt-btn primary" type="submit">保存人物</button></form></details><p role="status"></p>`;
        el.querySelector('[data-search]').oninput = e => { const q = e.target.value.toLowerCase(); el.querySelectorAll('[data-person]').forEach(b => { b.hidden = !b.dataset.text.toLowerCase().includes(q); }); };
        el.querySelector('form').onsubmit = async e => {
            e.preventDefault(); const form = e.target, fd = new FormData(form); if (!String(fd.get('world') || '').trim()) return this.message('请填写人物来源世界');
            await this.run(async () => {
                const token = capture(this.app), p = { 姓名: cleanText(fd.get('name'), 60), 世界: cleanText(fd.get('world'), 80), 关系: cleanText(fd.get('relation'), 40) || '羁绊', 说明: cleanText(fd.get('notes'), 600) };
                if (fd.get('favor') !== '') p.好感度 = Math.max(0, Math.min(100, Number(fd.get('favor')) || 0));
                await checkedCommit(this.app, token, z => { const saved = keepPerson(z, p); this.selected = saved.id; if (z.当前羁绊ID === saved.id) z.恋爱目标 = { ...saved }; audit(z, 'bond', `更新人物 ${p.姓名}（${p.世界}），无奖励结算`); }); this.render();
            });
        };
        el.onclick = e => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.person) { this.selected = b.dataset.person; this.render(); }
            if (b.hasAttribute('data-graph')) this.app.atlas?.focus('bonds', person.source === 'group' ? 'bond:m:' + person.id.slice(6) : person.source === 'summon' ? 'bond:s:' + (z.打手 || []).findIndex(x => (x.姓名 || x.名称) === person.姓名) : 'bond:p:' + person.id);
            if (b.hasAttribute('data-active')) this.run(async () => {
                if (!confirm(`将${person.姓名}（${person.世界}）设为旧版正文协议的当前攻略目标？仅切换目标，不结算奖励。`)) return;
                const token = capture(this.app); await checkedCommit(this.app, token, z => { const p = z.羁绊库?.find(x => x.id === person.id) || keepPerson(z, person); z.当前羁绊ID = p.id; z.恋爱目标 = { ...p }; delete z.恋爱目标.source; audit(z, 'bond', `切换攻略目标：${p.姓名}`); }); this.render();
            });
            if (b.hasAttribute('data-group')) { this.app.hub.go('group'); if (this.app.group) { this.app.group.view = 'members'; this.app.group.pm = person.id.slice(6); this.app.group.paint(true); } }
            if (b.hasAttribute('data-summon')) this.app.hub.go('plug');
        };
    }
    message(s) { const el = this.el?.querySelector('[role=status]'); if (el) el.textContent = s; }
    async run(f) { if (this.busy) return; this.busy = true; try { await f(); } catch (e) { this.message(e.message); } finally { this.busy = false; } }
    dispose() { this.off?.(); }
}
