// 外挂管理 + 自拟外挂 (0.5.0).
//  * 6 original 外挂 can be switched off per chat: hidden + unusable in the engine page, and the model is told not to use them.
//  * User-authored 外挂 live in a local library (localStorage, shared by all chats, export/import .json); each chat enables
//    its own subset. Enabled ones are injected as “宿主已装载外挂”; active ones get a 发动 button that charges the cost
//    through the ledger (write → read back) before the action is written into the input box.
import { STORAGE, inert } from './contracts.js';
import { esc, fmtNum } from './hub.js';

export const BUILTIN = ['无限口袋', '诸天打手', '洞察之眼', '分身派遣', '随身洞天', '万物熔炉'];
export const GRADES = ['凡品', '灵品', '仙品', '神品', '禁忌'];
export const RES = ['天命印记', '血脉结晶', '因果筹码', '名望', '岁月沉淀'];
const LIB_KEY = 'zhutian.customPlugins.v1';
const TYPES = { passive: '被动', active: '主动', daily: '每日次数' };
const clampText = (s, n) => inert(String(s ?? '')).trim().slice(0, n);
const today = () => new Date().toLocaleDateString('sv-SE');

/** Normalises one library entry (also used for imports). Returns null when unusable. */
export function normalizePlugin(p) {
    if (!p || typeof p !== 'object') return null;
    const name = clampText(p.name, 24); if (!name) return null;
    const type = TYPES[p.type] ? p.type : 'passive';
    const cost = p.cost && typeof p.cost === 'object' ? p.cost : {};
    const kind = ['none', 'points', 'resource'].includes(cost.kind) ? cost.kind : 'none';
    return {
        id: /^[a-z0-9-]{4,40}$/.test(String(p.id || '')) ? p.id : 'p-' + Math.random().toString(36).slice(2, 10),
        name, grade: GRADES.includes(p.grade) ? p.grade : '凡品', type,
        daily: Math.max(1, Math.min(99, Math.floor(Number(p.daily) || 1))),
        rule: clampText(p.rule, 600),
        cost: { kind, res: RES.includes(cost.res) ? cost.res : RES[0], amount: Math.max(0, Math.min(1e12, Math.floor(Number(cost.amount) || 0))), cooldown: Math.max(0, Math.min(999, Math.floor(Number(cost.cooldown) || 0))) },
        inject: p.inject !== false,
    };
}
/** Prompt text for the enabled set (pure, unit-tested). */
export function pluginPrompt(enabled, off) {
    const lines = [];
    if (enabled.length) {
        lines.push('【诸天系统 · 宿主已装载的自拟外挂】以下外挂是宿主真实拥有的能力，剧情中可按规则生效；主动外挂只有在宿主明确“发动”后才生效，代价已由系统扣除，不要重复扣费。');
        for (const p of enabled) {
            const cost = p.cost.kind === 'points' ? `每次 ${p.cost.amount} 系统点` : p.cost.kind === 'resource' ? `每次 ${p.cost.amount} ${p.cost.res}` : '无额外代价';
            const limit = p.type === 'daily' ? `，每日 ${p.daily} 次` : p.cost.cooldown ? `，冷却 ${p.cost.cooldown} 回合` : '';
            lines.push(`- ${p.name}（${p.grade}·${TYPES[p.type]}${limit}；${cost}）：${p.rule || '（未写规则）'}`);
        }
    }
    if (off.length) lines.push(`【诸天系统 · 未装载外挂】宿主当前关闭了：${off.join('、')}。剧情中不得出现或使用这些外挂。`);
    return lines.join('\n');
}

export class HubPlugins {
    constructor(app) { this.app = app; this.disposers = []; this.editing = null; }
    get hub() { return this.app.hub; }
    get ctx() { return this.app.adapter.context(); }
    start() {
        const hub = this.hub; if (!hub) return this;
        hub.register('plugmgr', { title: '外挂管理', render: el => this.render(el) });
        const prevTab = hub.onEngineTab, prevEngine = hub.onEngine;
        hub.onEngineTab = (n, tools) => { prevTab?.(n, tools); this.strip(n, tools); };
        hub.onEngine = (frame, doc) => { prevEngine?.(frame, doc); this.applyEngine(doc); };
        this.disposers.push(this.app.adapter.subscribe(() => this.syncPrompt()));
        this.syncPrompt();
        return this;
    }
    // ---------- storage ----------
    library() { try { const v = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); return Array.isArray(v) ? v.map(normalizePlugin).filter(Boolean) : []; } catch { return []; } }
    saveLibrary(list) { localStorage.setItem(LIB_KEY, JSON.stringify(list.map(normalizePlugin).filter(Boolean))); }
    chatState() { const m = this.ctx?.chatMetadata?.[STORAGE]?.plugins; return { off: Array.isArray(m?.off) ? m.off.filter(x => BUILTIN.includes(x)) : [], on: Array.isArray(m?.on) ? m.on : [], uses: m?.uses && typeof m.uses === 'object' ? m.uses : {} }; }
    async saveChatState(next) {
        const c = this.ctx; if (!this.app.adapter.currentIdentity()) throw Error('请先打开单角色聊天。');
        c.chatMetadata[STORAGE] = { schema: 1, ...(c.chatMetadata[STORAGE] || {}), plugins: next };
        await c.saveMetadata();
        this.syncPrompt(); this.applyEngine(this.hub?.engineFrame?.contentDocument);
    }
    enabled() { const st = this.chatState(), lib = this.library(); return lib.filter(p => st.on.includes(p.id)); }
    // ---------- effects ----------
    syncPrompt() {
        try {
            const zt = !!this.app.adapter.ledger?.() && !!this.app.adapter.currentIdentity();
            const st = zt ? this.chatState() : { off: [] };
            const text = zt ? pluginPrompt(this.enabled().filter(p => p.inject), st.off) : '';
            if (text === this.lastPrompt) return; this.lastPrompt = text;
            this.app.bridge.injectPrompts([{ id: 'plugins', content: text, position: 'in_chat', depth: 4, role: 'system' }]);
        } catch (e) { console.warn('[诸天外挂] 注入失败', e); }
    }
    applyEngine(doc) {
        if (!doc) return; const off = this.chatState().off;
        BUILTIN.forEach((name, i) => {
            const hide = off.includes(name) ? '1' : '0';
            doc.querySelectorAll(`[data-ui-anchor="zt-ui-section-7-${i}"],[data-ui-jump="zt-ui-section-7-${i}"]`).forEach(el => el.setAttribute('data-zt-off', hide));
        });
    }
    strip(n, tools) {
        if (n !== 7) { if (tools.dataset.owner === 'plugins') { tools.innerHTML = ''; delete tools.dataset.owner; } return; }
        tools.dataset.owner = 'plugins';
        const list = this.enabled(), st = this.chatState();
        tools.innerHTML = `<div class="zt-plug-strip"><span class="zt-plug-title">自拟外挂</span>${list.map(p => `<span class="zt-plug-card"><span>${esc(p.name)}<span class="zt-grade" data-g="${p.grade}">${p.grade}</span></span>${p.type === 'passive' ? '<small>被动 · 生效中</small>' : `<button type="button" class="zt-btn small primary" data-plug-use="${p.id}">发动${this.costLabel(p)}</button>`}</span>`).join('') || '<span class="zt-note">尚未启用自拟外挂</span>'}${st.off.length ? `<span class="zt-chip">已关闭 ${st.off.length} 个原版外挂</span>` : ''}<button type="button" class="zt-btn small" data-plug-new style="margin-left:auto">＋ 自拟外挂</button><button type="button" class="zt-btn small" data-plug-manage>外挂管理 ›</button></div>`;
        tools.onclick = e => {
            if (e.target.closest('[data-plug-manage]')) return this.hub.go('plugmgr');
            if (e.target.closest('[data-plug-new]')) return this.openEditor();
            const u = e.target.closest('[data-plug-use]'); if (u) this.activate(u.dataset.plugUse, u);
        };
    }
    /** 0.8.0: “＋ 自拟外挂” — opens 外挂管理 with an empty editor focused (the page is also in the 能力 navigation). */
    openEditor() {
        this.editing = null; this.hub.go('plugmgr');
        const el = this.hub.pages.get('plugmgr')?.el, ed = el?.querySelector('#zt-plug-editor');
        ed?.scrollIntoView({ block: 'start' }); ed?.querySelector('[data-f="name"]')?.focus({ preventScroll: true });
    }
    costLabel(p) { return p.cost.kind === 'points' ? ` · ${fmtNum(p.cost.amount)} 点` : p.cost.kind === 'resource' ? ` · ${p.cost.amount} ${p.cost.res}` : ''; }
    /** Charges the cost through the ledger, reads it back, then writes the action into the input box. */
    async activate(id, btn) {
        const p = this.enabled().find(x => x.id === id), t = globalThis.toastr;
        try {
            if (!p) throw Error('外挂未启用。');
            if (p.type === 'passive') throw Error('被动外挂无需发动。');
            if (this.app.adapter.isGenerating()) throw Error('主聊天正在生成，稍后再发动。');
            const st = this.chatState(), use = st.uses[p.id] || {};
            const turn = Number(this.app.adapter.ledger()?.回合数) || 0;
            if (p.type === 'daily' && use.day === today() && (use.n || 0) >= p.daily) throw Error(`今日次数已用完（${p.daily}/${p.daily}）。`);
            if (p.type === 'active' && p.cost.cooldown && use.turn !== undefined && turn - use.turn < p.cost.cooldown) throw Error(`冷却中：还需 ${p.cost.cooldown - (turn - use.turn)} 回合。`);
            if (btn) btn.disabled = true;
            let expect = null;
            if (p.cost.kind !== 'none' && p.cost.amount > 0) {
                await this.app.bridge.updateVariablesWith(v => {
                    const s = v.诸天系统; if (!s || typeof s !== 'object') throw Error('当前聊天没有诸天账本。');
                    if (p.cost.kind === 'points') { const have = Number(s.系统点) || 0; if (have < p.cost.amount) throw Error(`系统点不足：需要 ${fmtNum(p.cost.amount)}，现有 ${fmtNum(have)}。`); s.系统点 = have - p.cost.amount; s.累计消费 = (Number(s.累计消费) || 0) + p.cost.amount; s.界面记账时间 = Date.now(); expect = ['系统点', s.系统点]; }
                    else { s.专属资源 = s.专属资源 && typeof s.专属资源 === 'object' ? s.专属资源 : {}; const have = Number(s.专属资源[p.cost.res]) || 0; if (have < p.cost.amount) throw Error(`${p.cost.res}不足：需要 ${p.cost.amount}，现有 ${have}。`); s.专属资源[p.cost.res] = have - p.cost.amount; s.界面记账时间 = Date.now(); expect = [p.cost.res, s.专属资源[p.cost.res]]; }
                    return v;
                });
                const back = this.app.bridge.getVariables({ type: 'chat' }).诸天系统 || {};
                const got = expect[0] === '系统点' ? Number(back.系统点) : Number(back.专属资源?.[expect[0]]);
                if (got !== expect[1]) throw Error('账本读回不一致，已停止发动；请在“账本回滚”核对。');
            }
            st.uses[p.id] = { day: today(), n: use.day === today() ? (use.n || 0) + 1 : 1, turn };
            const log = Array.isArray(this.ctx.chatMetadata?.[STORAGE]?.plugins?.log) ? this.ctx.chatMetadata[STORAGE].plugins.log : [];
            log.push({ at: Date.now(), id: p.id, name: p.name, cost: this.costLabel(p).replace(/^ · /, '') || '无', turn });
            await this.saveChatState({ ...st, log: log.slice(-30) });
            const text = `【发动外挂：${p.name}】${p.rule ? p.rule.slice(0, 160) : ''}${p.cost.kind !== 'none' && p.cost.amount ? `（代价${this.costLabel(p).replace(/^ · /, '')}已由系统扣除）` : ''}`;
            const ta = document.getElementById('send_textarea');
            if (ta) { ta.value = (ta.value && !/\n$/.test(ta.value) ? ta.value + '\n' : ta.value) + text; ta.dispatchEvent(new Event('input', { bubbles: true })); }
            this.hub.toast(`已发动「${p.name}」${this.costLabel(p) ? '，代价已入账' : ''}；行动已写入输入框，发送即可让 AI 演绎。`, 4200);
            this.app.fx?.play?.({ kind: 'plugin', title: p.name, detail: this.costLabel(p).replace(/^ · /, '') ? '代价已扣除 · ' + this.costLabel(p).replace(/^ · /, '') : '已发动' });
        } catch (e) { this.hub.toast(e.message, 4200); t?.warning?.(e.message, '诸天 · 外挂'); }
        finally { if (btn) btn.disabled = false; this.hub.setEngineTab(7); }
    }
    // ---------- 外挂管理 page ----------
    render(el) {
        const st = this.chatState(), lib = this.library(), e = this.editing;
        const has = !!this.app.adapter.currentIdentity();
        el.innerHTML = `<div class="zt-actions" style="justify-content:space-between;margin-bottom:8px"><div><div class="zt-eyebrow">EXTRA MODULES · MANAGER</div><h2 class="zt-h">外挂管理</h2></div><button class="zt-btn" data-back type="button">‹ 返回外挂工坊</button></div>
<p class="zt-sub">开关按聊天保存；关闭的外挂在终端里隐藏、不能使用，也会告诉 AI 不得使用。自拟外挂保存在本机，所有聊天共用。</p>
${has ? '' : '<div class="zt-card zt-note">请先打开一个单角色聊天再调整开关。</div>'}
<section class="zt-card"><h3>原版外挂 <small>本聊天</small></h3>${BUILTIN.map(n => `<div class="zt-row"><span>${n}</span><label class="zt-switch"><input type="checkbox" data-builtin="${n}" ${st.off.includes(n) ? '' : 'checked'} ${has ? '' : 'disabled'} aria-label="${n}"><i></i></label></div>`).join('')}</section>
<section class="zt-card"><h3>自拟外挂 <small>本机外挂库 ${lib.length} 个 · 开关只影响本聊天</small></h3>
<div class="zt-plug-list">${lib.map(p => `<div class="zt-plug-item"><label class="zt-switch"><input type="checkbox" data-custom="${p.id}" ${st.on.includes(p.id) ? 'checked' : ''} ${has ? '' : 'disabled'} aria-label="${esc(p.name)}"><i></i></label><div><b>${esc(p.name)}</b><span class="zt-grade" data-g="${p.grade}">${p.grade}</span> <span class="zt-chip">${TYPES[p.type]}${p.type === 'daily' ? ' ' + p.daily + '次' : ''}${p.cost.cooldown && p.type === 'active' ? ' · 冷却' + p.cost.cooldown + '回合' : ''}</span> <span class="zt-chip">${this.costLabel(p).replace(/^ · /, '') || '无代价'}</span>${p.inject ? '' : ' <span class="zt-chip">不注入提示词</span>'}<p>${esc(p.rule || '（未写规则）')}</p></div><div class="zt-actions"><button class="zt-btn small" data-edit="${p.id}" type="button">编辑</button><button class="zt-btn small danger" data-del="${p.id}" type="button">删除</button></div></div>`).join('') || '<div class="zt-note">外挂库还是空的。在下面写一个吧。</div>'}</div>
<div class="zt-actions" style="margin-top:10px"><button class="zt-btn" data-export type="button">导出 .json</button><label class="zt-btn">导入 .json<input type="file" accept=".json,application/json" data-import hidden></label></div></section>
<section class="zt-card" id="zt-plug-editor"><h3>${e ? '编辑外挂' : '新建自拟外挂'}</h3>
<div class="zt-grid2"><label class="zt-field">名称<input data-f="name" maxlength="24" value="${esc(e?.name || '')}" placeholder="如：时停怀表"></label>
<label class="zt-field">品阶<select data-f="grade">${GRADES.map(g => `<option ${e?.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
<label class="zt-field">类型<select data-f="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${e?.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
<label class="zt-field">每日次数（每日次数型）<input data-f="daily" type="number" min="1" max="99" value="${e?.daily || 1}"></label>
<label class="zt-field">代价<select data-f="cost.kind"><option value="none" ${e?.cost.kind === 'none' ? 'selected' : ''}>无</option><option value="points" ${e?.cost.kind === 'points' ? 'selected' : ''}>系统点</option><option value="resource" ${e?.cost.kind === 'resource' ? 'selected' : ''}>专属资源</option></select></label>
<label class="zt-field">资源种类（代价为专属资源时）<select data-f="cost.res">${RES.map(r => `<option ${e?.cost.res === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
<label class="zt-field">每次消耗数量<input data-f="cost.amount" type="number" min="0" value="${e?.cost.amount || 0}"></label>
<label class="zt-field">冷却回合（主动型）<input data-f="cost.cooldown" type="number" min="0" max="999" value="${e?.cost.cooldown || 0}"></label></div>
<label class="zt-field">规则说明（写给 AI：效果、限制、副作用）<textarea data-f="rule" maxlength="600" placeholder="如：发动后时间静止 3 秒，期间宿主可自由行动；对神品以上存在无效。">${esc(e?.rule || '')}</textarea></label>
<div class="zt-row"><span>注入提示词（让 AI 知道宿主拥有此外挂）</span><label class="zt-switch"><input type="checkbox" data-f="inject" ${e ? (e.inject ? 'checked' : '') : 'checked'}><i></i></label></div>
<div class="zt-actions" style="margin-top:8px"><button class="zt-btn primary" data-save type="button">${e ? '保存修改' : '加入外挂库'}</button>${e ? '<button class="zt-btn" data-cancel type="button">取消编辑</button>' : ''}</div></section>
<section class="zt-card"><h3>发动记录 <small>本聊天最近 30 次</small></h3>${(this.ctx?.chatMetadata?.[STORAGE]?.plugins?.log || []).slice().reverse().map(r => `<div class="zt-row"><span>${esc(r.name)} <span class="zt-desc">第 ${r.turn} 回合 · ${new Date(r.at).toLocaleString('zh-CN')}</span></span><span class="zt-chip">${esc(r.cost)}</span></div>`).join('') || '<div class="zt-note">还没有发动过。</div>'}</section>`;
        el.onclick = ev => this.onClick(ev, el);
        el.onchange = ev => this.onChange(ev, el);
    }
    formValue(el) {
        const get = f => el.querySelector(`[data-f="${f}"]`);
        return normalizePlugin({ id: this.editing?.id, name: get('name').value, grade: get('grade').value, type: get('type').value, daily: get('daily').value, rule: get('rule').value, inject: get('inject').checked,
            cost: { kind: get('cost.kind').value, res: get('cost.res').value, amount: get('cost.amount').value, cooldown: get('cost.cooldown').value } });
    }
    async onChange(ev, el) {
        const t = ev.target;
        try {
            if (t.dataset.builtin) { const st = this.chatState(); const off = new Set(st.off); t.checked ? off.delete(t.dataset.builtin) : off.add(t.dataset.builtin); await this.saveChatState({ ...st, off: [...off] }); this.hub.toast(`${t.dataset.builtin} 已${t.checked ? '开启' : '关闭'}`); }
            else if (t.dataset.custom) { const st = this.chatState(); const on = new Set(st.on); t.checked ? on.add(t.dataset.custom) : on.delete(t.dataset.custom); await this.saveChatState({ ...st, on: [...on] }); this.hub.toast(t.checked ? '已在本聊天启用' : '已在本聊天停用'); }
            else if (t.matches('[data-import]') && t.files?.[0]) {
                const data = JSON.parse(await t.files[0].text()); const incoming = (Array.isArray(data) ? data : data?.plugins || []).map(normalizePlugin).filter(Boolean);
                if (!incoming.length) throw Error('文件里没有可用的外挂。');
                const lib = this.library(), ids = new Set(lib.map(p => p.id));
                for (const p of incoming) { if (ids.has(p.id)) p.id = 'p-' + Math.random().toString(36).slice(2, 10); lib.push(p); }
                this.saveLibrary(lib); this.hub.toast(`已导入 ${incoming.length} 个外挂`); this.render(el);
            }
        } catch (e) { this.hub.toast(e.message, 4000); this.render(el); }
    }
    onClick(ev, el) {
        const b = ev.target.closest('button'); if (!b) return;
        if (b.dataset.back !== undefined) return this.hub.go('plug');
        if (b.dataset.edit) { this.editing = this.library().find(p => p.id === b.dataset.edit) || null; this.render(el); el.querySelector('#zt-plug-editor')?.scrollIntoView({ block: 'start' }); return; }
        if (b.dataset.cancel !== undefined) { this.editing = null; return this.render(el); }
        if (b.dataset.del) { const p = this.library().find(x => x.id === b.dataset.del); if (p && globalThis.confirm(`从本机外挂库删除「${p.name}」？（所有聊天都会失去它）`)) { this.saveLibrary(this.library().filter(x => x.id !== p.id)); this.syncPrompt(); this.render(el); } return; }
        if (b.dataset.export !== undefined) { const blob = new Blob([JSON.stringify({ format: 'zhutian-plugins', version: 1, plugins: this.library() }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '诸天-自拟外挂.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return; }
        if (b.dataset.save !== undefined) {
            const p = this.formValue(el); if (!p) return this.hub.toast('请填写外挂名称');
            const lib = this.library(), i = lib.findIndex(x => x.id === p.id);
            if (i >= 0) lib[i] = p; else lib.push(p);
            this.saveLibrary(lib); this.editing = null;
            const st = this.chatState();
            const done = () => { this.hub.toast(i >= 0 ? '已保存' : `「${p.name}」已加入外挂库${this.app.adapter.currentIdentity() ? '并在本聊天启用' : ''}`); this.syncPrompt(); this.render(el); };
            if (i < 0 && this.app.adapter.currentIdentity()) this.saveChatState({ ...st, on: [...new Set([...st.on, p.id])] }).then(done, e => this.hub.toast(e.message)); else done();
        }
    }
    dispose() { this.disposers.splice(0).forEach(f => f()); try { this.app.bridge.uninjectPrompts(['plugins']); } catch { /* ignore */ } }
}
