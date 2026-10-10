// 1.1.5 终端 · 功能开关: every feature in one table — what it does, whether it is on, and whether the change needs a
// page reload. Rows write the same settings the rest of the terminal reads (nothing new to keep in sync), whole
// modules use `modules.*`, and pages leave the navigation via `navHidden`.
import { esc } from './hub.js';
import { ALWAYS_PAGES, hiddenPages } from './hub.js';
import { errorLine } from './errors.js';

const b = (k, label, desc = '', o = {}) => ({ kind: 'bool', k, label, desc, ...o });
const v = (k, on, off, label, desc = '', o = {}) => ({ kind: 'value', k, on, off, label, desc, ...o });
const m = (name, label, desc = '', o = {}) => ({ kind: 'bool', k: 'modules.' + name, label, desc, dflt: true, ...o });

/** Every switch, grouped (pure data; tests check each key exists in the settings defaults). */
export const SWITCH_GROUPS = Object.freeze([
    { id: 'assistant', title: '系统助手', items: [
        b('assistant', '系统助手窗口', '原版窗口：工作台、记忆、规则、私聊。关闭后终端照常可用，但这些页面、私聊和自动记忆都不在。', { reload: true }),
        v('floatLilith', 'auto', 'none', '悬浮窗（悬浮莉莉丝 / 头像）', '关闭 = 页面上不显示悬浮入口；终端仍可从扩展菜单、快捷键、楼层标签打开。'),
        b('voiceBox', '聊天楼层里的系统助手语音框', '把「【莉莉丝】：“……”」画成语音卡片；关闭后原样显示文字。'),
        b('touchGestures', '触摸互动（抚摸 / 长按 / 视线跟随）', '只对莉莉丝立绘生效。'),
        b('haptics', '触摸震动反馈（手机）'),
        b('lilith.react', '界面角色反应', '对选中的任务 / 物品 / 功法和结算成败作出反应。'),
        b('lilith.pageLines', '进入系统页时说一句'),
        b('lilith.camera', '镜头（半身 / 全身 / 面部特写）'),
        b('lilith.story', '气泡播报', '数据块里的「系统播报」由立绘气泡说出。'),
    ] },
    { id: 'floor', title: '聊天楼层与数据块', items: [
        v('statusbar', 'terminal', 'off', '系统数据块记账', '关闭 = 插件不再处理剧情里的数据块，账本不会从剧情自动入账（终端手动操作仍可用）。'),
        b('floorTag', '楼层小标签“系统已记录”'),
        b('promptStripPanels', '旧楼层数据块不发给 AI（省 token）'),
        b('panelGuard.repair', '数据块格式守卫：自动修复新回复'),
        v('panelGuard.backfill', 'missing', 'off', '数据块缺失时补记', '回复里没有数据块时，按剧情补一份（一次额外请求）。'),
        b('panelGuard.remind', '每轮格式提醒（发给 AI）'),
        b('panelGuard.skillHint', '剧情功法未入账提示'),
        b('macroLike', '世界书变量宏 {{get_chat_variable::…}}', '酒馆助手在运行时自动让位。'),
        b('worldbookAuto', '诸天存档自动安装并绑定世界书'),
        b('wbUnbindOnDisable', '关闭插件时自动解绑世界书'),
    ] },
    { id: 'prompt', title: '剧情提示（附加给正文 AI 的规则）', items: [
        b('world.prompt', '记录穿越（当前世界 / 世界类型）'),
        b('appraise.prompt', '品阶提示：收录写明品阶'),
        b('appraise.raise', '品阶更正：「收录:X[更高品阶]」'),
        b('skills.prompt', '功法熟练度效果提示'),
        b('skills.practice', '实战积累熟练度'),
        b('skills.cardAuto', '角色卡功法自动同步'),
        m('plugins', '自拟外挂', '「自拟」页面和已启用外挂的提示词。关闭后页面隐藏，外挂规则不再发给 AI（外挂本身保留）。'),
    ] },
    { id: 'group', title: '聊天群', items: [
        m('group', '聊天群', '整个聊天群：页面、发给正文的群聊摘要、自动闲聊、降临。关闭后数据保留，重新打开即恢复。'),
        m('groupAuto', '剧情后自动闲聊（总开关）', '每个聊天里还要在 聊天群 → 群务 单独打开；这里关掉 = 所有聊天都不自动闲聊。'),
        b('groupWorld.read', '读取世界书', '「从世界书召唤」，群聊 / 私聊时带上召唤群员的条目资料和关键词命中的条目（只读）。'),
        b('groupWorld.memory', '群员记忆注入', '从世界书召唤的角色在正文里出场时，把 TA 和你的群聊 / 私聊摘要带给正文 AI。需要该聊天的「摘要注入」开着。'),
    ] },
    { id: 'ui', title: '界面与操作', items: [
        b('hud', '输入框上方账本速览'),
        b('hotkeys', '快捷键 Alt+Z / Alt+X / Alt+S'),
        m('slash', '斜杠命令 /zt'),
        m('guide', '新手引导自动弹出', '关闭后仍可在 设置 → 新手引导 手动打开。'),
        b('world.enabled', '世界主题（按当前世界换装饰）', '关闭 = 固定诸天默认主题。'),
        v('fx.mode', 'full', 'off', '演出（结算动画）'),
        b('fx.outside', '终端关闭时的剧情提示卡片'),
    ] },
]);
/** Rows in the 终端页面 group that come from the navigation itself. */
export const PER_CHAT_NOTES = Object.freeze([
    ['记忆整理 / 自动记忆', '每个聊天单独设置', 'memory'],
    ['聊天群摘要注入 · 自动闲聊间隔', '每个聊天单独设置（聊天群 → 群务）', 'group'],
    ['外挂启用', '每个聊天单独设置（自拟 / 外挂页）', 'plugmgr'],
]);

const read = (all, k) => k.split('.').reduce((o, x) => o?.[x], all);
/** Is this row on? (pure) */
export function switchOn(row, all) {
    const cur = read(all || {}, row.k);
    if (row.kind === 'value') return cur !== row.off;
    if (cur === undefined) return row.dflt !== false;
    return cur !== false && !!cur;
}
/** Settings write for a row (pure): [topKey, newTopValue]. `prev` remembers the last non-off value of value rows. */
export function switchWrite(row, all, on, prev = {}) {
    const [head, tail] = row.k.split('.');
    const val = row.kind === 'value' ? (on ? (prev[row.k] && prev[row.k] !== row.off ? prev[row.k] : row.on) : row.off) : !!on;
    if (!tail) return [head, val];
    return [head, { ...(all?.[head] || {}), [tail]: val }];
}
/** Summary counts (pure). */
export function switchSummary(all, navHidden = []) {
    let on = 0, total = 0;
    for (const g of SWITCH_GROUPS) for (const r of g.items) { total++; if (switchOn(r, all)) on++; }
    return { on, total, pagesOff: (navHidden || []).length };
}

export class HubSwitches {
    constructor(app) { this.app = app; this.prev = {}; }
    get hub() { return this.app.hub; }
    get s() { return this.app.settings; }
    start() {
        const hub = this.hub; if (!hub) return this;
        hub.register('switches', { title: '功能开关', render: el => this.render(el) });
        return this;
    }
    dispose() { /* the hub removes its pages */ }
    pages() {
        const nav = this.hub?.shell?.nav; if (!nav) return [];
        const out = [];
        for (const g of nav.querySelectorAll('.zt-nav-group')) {
            const title = g.querySelector('.zt-nav-title')?.textContent?.trim() || '';
            for (const btn of g.querySelectorAll('.nav-button[data-page]')) {
                const id = btn.dataset.page; if (ALWAYS_PAGES.includes(id) || id === 'guide') continue;
                out.push({ id, label: (btn.textContent || id).trim(), group: title });
            }
        }
        return out;
    }
    render(el) {
        if (!el) return; this.el = el;
        const all = this.s.all, navHidden = Array.isArray(all.navHidden) ? all.navHidden : [], off = hiddenPages(navHidden, all.modules);
        const sum = switchSummary(all, navHidden), current = this.app.persona;
        const row = (r, gi, ri) => {
            const on = switchOn(r, all);
            return `<tr data-search="${esc((r.label + ' ' + r.desc).toLowerCase())}"><td>${esc(r.label)}${r.reload ? '<span class="zt-sw-tag">刷新后生效</span>' : ''}${r.desc ? `<small>${esc(r.desc)}</small>` : ''}</td><td class="c"><label class="zt-switch"><input type="checkbox" data-sw="${gi}:${ri}" ${on ? 'checked' : ''} aria-label="${esc(r.label)}"><i></i></label></td></tr>`;
        };
        const pages = this.pages();
        el.innerHTML = `<div class="zt-eyebrow">FEATURE SWITCHES</div><h2 class="zt-h">功能开关</h2>
<p class="zt-sub">所有功能都在这里开关。改动立即生效（标「刷新后生效」的除外）；关掉的功能数据都保留，重新打开就回来。</p>
<div class="zt-sw-sum"><span class="zt-chip">已开启 ${sum.on} / ${sum.total} 项功能</span><span class="zt-chip">隐藏页面 ${off.size} 个</span><span class="zt-chip">系统助手：${esc(current?.name || '莉莉丝')}</span><button type="button" class="zt-btn small" data-sw-act="persona">系统助手人设 ›</button><button type="button" class="zt-btn small" data-sw-act="all-on">全部开启</button><button type="button" class="zt-btn small" data-sw-act="back">返回设置</button></div>
<div class="zt-set-search"><input type="search" data-f="swq" placeholder="搜索功能，例如：聊天群、世界书、语音" aria-label="搜索功能" enterkeyhint="search"></div>
<div class="zt-grid2">${SWITCH_GROUPS.map((g, gi) => `<section class="zt-card" data-sw-group="${g.id}"><h3>${esc(g.title)}</h3><table class="zt-sw-table"><tbody>${g.items.map((r, ri) => row(r, gi, ri)).join('')}</tbody></table></section>`).join('')}
<section class="zt-card" data-sw-group="pages"><h3>终端页面 <small>关掉 = 从导航里拿掉（总览、设置、连接一直保留）</small></h3><table class="zt-sw-table"><tbody>${pages.map(p => `<tr data-search="${esc((p.label + ' ' + p.group).toLowerCase())}"><td>${esc(p.label)}<small>${esc(p.group)}${p.id === 'group' && all.modules?.group === false ? ' · 已随「聊天群」关闭' : ''}${p.id === 'plugmgr' && all.modules?.plugins === false ? ' · 已随「自拟外挂」关闭' : ''}</small></td><td class="c"><label class="zt-switch"><input type="checkbox" data-page-sw="${esc(p.id)}" ${off.has(p.id) ? '' : 'checked'} ${(p.id === 'group' && all.modules?.group === false) || (p.id === 'plugmgr' && all.modules?.plugins === false) ? 'disabled' : ''} aria-label="显示 ${esc(p.label)}"><i></i></label></td></tr>`).join('')}</tbody></table></section>
<section class="zt-card"><h3>按聊天的开关 <small>这些跟着每个聊天走，在对应页面里设置</small></h3><table class="zt-sw-table"><tbody>${PER_CHAT_NOTES.map(([a, d, page]) => `<tr><td>${esc(a)}<small>${esc(d)}</small></td><td class="c"><button type="button" class="zt-btn small" data-sw-go="${page}">去设置</button></td></tr>`).join('')}</tbody></table></section>
</div><p class="zt-set-none" hidden>没有找到匹配的功能。</p>`;
        const q = el.querySelector('[data-f=swq]');
        q.oninput = () => {
            const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean); let hits = 0;
            for (const tr of el.querySelectorAll('tr[data-search]')) { const ok = words.every(w => tr.dataset.search.includes(w)); tr.hidden = !ok; if (ok) hits++; }
            for (const sec of el.querySelectorAll('section[data-sw-group]')) sec.hidden = !!words.length && !sec.querySelector('tr[data-search]:not([hidden])');
            el.querySelector('.zt-set-none').hidden = !words.length || hits > 0;
        };
        el.onchange = e => {
            const t = e.target;
            try {
                if (t.dataset.sw) { const [gi, ri] = t.dataset.sw.split(':').map(Number); this.toggle(SWITCH_GROUPS[gi].items[ri], t.checked); }
                else if (t.dataset.pageSw) this.togglePage(t.dataset.pageSw, t.checked);
                else return;
            } catch (err) { this.hub?.toast(errorLine(err), 7000); }
            this.render(el);
        };
        el.onclick = e => {
            const go = e.target.closest('[data-sw-go]'); if (go) return this.hub?.go(go.dataset.swGo);
            const a = e.target.closest('[data-sw-act]')?.dataset.swAct; if (!a) return;
            if (a === 'persona') return this.hub?.go('persona');
            if (a === 'back') return this.hub?.go('set');
            if (a === 'all-on') { try { this.allOn(); } catch (err) { this.hub?.toast(errorLine(err), 7000); } this.render(el); }
        };
    }
    toggle(row, on) {
        const all = this.s.all, cur = read(all, row.k);
        if (row.kind === 'value' && cur !== row.off) this.prev[row.k] = cur;
        const [k, val] = switchWrite(row, all, on, this.prev);
        this.s.set(k, val);
        this.hub?.toast(row.reload ? `「${row.label}」已${on ? '开启' : '关闭'}，刷新页面后生效` : `「${row.label}」已${on ? '开启' : '关闭'}`, row.reload ? 6000 : 2600);
    }
    togglePage(id, show) {
        const cur = new Set(Array.isArray(this.s.get('navHidden')) ? this.s.get('navHidden') : []);
        if (show) cur.delete(id); else cur.add(id);
        this.s.set('navHidden', [...cur]);
    }
    allOn() {
        for (const g of SWITCH_GROUPS) for (const r of g.items) if (!switchOn(r, this.s.all)) { const [k, val] = switchWrite(r, this.s.all, true, this.prev); this.s.set(k, val); }
        this.s.set('navHidden', []);
        this.hub?.toast('全部功能已开启（「系统助手窗口」需要刷新页面）', 4000);
    }
}
