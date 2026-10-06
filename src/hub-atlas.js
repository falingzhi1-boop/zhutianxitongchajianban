import { listBonds } from './bonds-data.js';
// 图谱 (0.7.0): the ledger as explorable spaces — 事件线 · 羁绊图 · 星图 · 能力树.
// Every node is built from one real record and its detail panel shows that record's raw fields plus a way back to where
// it lives (engine page / 聊天群 / 外挂管理 / the chat floor). Builders are pure (unit-tested); nothing here invents data:
// empty ledgers give empty spaces with a hint.  The only write is 星图 → 记录穿越 (world.travel, locked commit + read-back).
import { esc, fmtNum } from './hub.js';
import { TIERS } from './ledger-ops.js';
import { THEMES, classifyWorld, WORLD_TYPES } from './world.js';
import { scrollWithin, resetPageScroll } from './page-scroll.js';

const num = (x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const arr = x => (Array.isArray(x) ? x : []);
const str = s => String(s ?? '').trim();
const cut = (s, n) => { const t = str(s); return [...t].length > n ? [...t].slice(0, n - 1).join('') + '…' : t; };
const EMPTY = /^(|暂无|无|未知|未记录)$/;
const BUILTIN = ['无限口袋', '诸天打手', '洞察之眼', '分身派遣', '随身洞天', '万物熔炉'];

/** Original ztStageOf (statusbar 3.1 part 2), repeated here read-only for labels. */
export function stageOf(s) {
    if (!s) return '未入门'; if (s.入道) return '入道';
    const e = Math.min(num(s.熟练度), 1e4);
    const st = e >= 1e4 ? '宗师' : e >= 2e3 ? '精通' : e >= 500 ? '熟练' : e >= 100 ? '入门' : '未入门';
    return num(s.上限) > 0 && num(s.熟练度) >= num(s.上限) && st !== '宗师' ? st + '·圆满' : st;
}
const floorOf = x => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };

// ---------- pure builders: {nodes:[{id,type,label,sub,x,y,rec,src,...}], edges:[{from,to,kind,label,w}], w, h} ----------

/** 事件线: 起因 → 任务 → 结果, one row per task, ordered by floor; tasks that name another task as 来源/依据 link to it. */
export function buildEvents(z) {
    const lib = obj(z?.任务库), paid = obj(z?.任务结算凭据), nodes = [], edges = [];
    const tasks = Object.entries(lib).filter(([, t]) => t && typeof t === 'object').map(([id, t]) => ({ id, t, f: floorOf(t.更新楼层 ?? paid[id]?.楼层) }));
    tasks.sort((a, b) => (a.f ?? 1e9) - (b.f ?? 1e9) || a.id.localeCompare(b.id));
    const byName = new Map(tasks.map(x => [str(x.t.名称), x.id]));
    const foot = arr(z?.万界足迹).filter(x => x?.名称).map(x => ({ name: str(x.名称), f: floorOf(x.首次楼层) })).filter(x => x.f !== null).sort((a, b) => a.f - b.f);
    const worldAt = f => { if (f === null) return ''; let w = ''; for (const x of foot) if (x.f <= f) w = x.name; return w; };
    const ROW = 64, X = [70, 290, 510];
    tasks.forEach(({ id, t, f }, i) => {
        const y = 40 + i * ROW, src = str(t.来源), why = str(t.依据);
        const causeTask = [...byName.entries()].find(([n, tid]) => tid !== id && n && (src.includes(n) || why.includes(n) || src === tid))?.[1];
        const cid = 'cause:' + id;
        nodes.push({ id: cid, type: 'cause', label: cut(src || (causeTask ? '承接任务' : t.类型 || '剧情'), 9), sub: why ? cut(why, 12) : '', x: X[0], y, rec: { 来源: src || '（未记录）', 依据: why || '（未记录）', 类型: t.类型 || '' }, src: `诸天系统.任务库.${id}.来源` });
        edges.push({ from: cid, to: 'task:' + id, kind: 'cause', label: '起因' });
        if (causeTask) edges.push({ from: 'task:' + causeTask, to: 'task:' + id, kind: 'chain', label: '承接' });
        const state = t.状态 || '进行中';
        nodes.push({ id: 'task:' + id, type: 'task', label: cut(t.名称 || id, 9), sub: state + (num(t.完成度) ? ` · ${num(t.完成度)}%` : ''), state, x: X[1], y, floor: f, world: worldAt(f), rec: { ID: id, ...t }, src: `诸天系统.任务库.${id}`, task: id });
        const r = paid[id];
        if (r) { nodes.push({ id: 'result:' + id, type: 'receipt', label: `+${fmtNum(r.点数)} 点`, sub: '已结算' + (floorOf(r.楼层) !== null ? ` · #${r.楼层}` : ''), x: X[2], y, floor: floorOf(r.楼层), rec: { 任务: id, ...r }, src: `诸天系统.任务结算凭据.${id}`, task: id }); edges.push({ from: 'task:' + id, to: 'result:' + id, kind: 'effect', label: '结算' }); }
        else if (state === '已失败') { nodes.push({ id: 'result:' + id, type: 'fail', label: '失败', sub: '未结算', x: X[2], y, rec: { 任务: id, 状态: state }, src: `诸天系统.任务库.${id}.状态`, task: id }); edges.push({ from: 'task:' + id, to: 'result:' + id, kind: 'fail', label: '失败' }); }
        else if (state === '已完成') { nodes.push({ id: 'result:' + id, type: 'pending', label: '待结算', sub: str(t.奖励) ? cut(t.奖励, 10) : '', x: X[2], y, rec: { 任务: id, 奖励: t.奖励 || '' }, src: `诸天系统.任务库.${id}.奖励`, task: id }); edges.push({ from: 'task:' + id, to: 'result:' + id, kind: 'effect', label: '完成' }); }
        else if (str(t.奖励)) { nodes.push({ id: 'result:' + id, type: 'reward', label: cut(t.奖励, 9), sub: '奖励（未达成）', x: X[2], y, rec: { 任务: id, 奖励: t.奖励 }, src: `诸天系统.任务库.${id}.奖励`, task: id }); edges.push({ from: 'task:' + id, to: 'result:' + id, kind: 'future', label: '奖励' }); }
    });
    // World bands behind the rows (from 万界足迹 首次楼层).
    const bands = []; let cur = null;
    tasks.forEach(({ f }, i) => { const w = worldAt(f); if (!cur || cur.world !== w) { cur = { world: w, from: i, to: i }; bands.push(cur); } else cur.to = i; });
    return { nodes, edges, bands: bands.filter(b => b.world).map(b => ({ ...b, y: 40 + b.from * ROW - 30, h: (b.to - b.from + 1) * ROW })), w: 600, h: Math.max(140, 40 + tasks.length * ROW) };
}

/** 羁绊图: 宿主 at the centre; Lilith, 恋爱目标, 打手 and 聊天群 members around; edge weight = 好感 / 忠诚. */
export function buildBonds(z) {
    const nodes = [], edges = [], cx = 300, cy = 230;
    nodes.push({ id: 'host', type: 'host', label: '宿主', sub: TIERS[num(z?.宿主实力档)]?.n || '实力未确认', x: cx, y: cy, rec: { 当前世界: z?.当前世界 || '', 宿主实力档: z?.宿主实力档 ?? '' }, src: '诸天系统' });
    const ring = [];
    ring.push({ id: 'lilith', type: 'lilith', label: '莉莉丝', sub: '系统契约', rec: { 身份: '诸天系统 · 契约者', 系统点: z?.系统点 ?? '' }, src: '诸天系统', w: 100, kind: 'system' });
    for (const love of listBonds(z).filter(p => p.source === 'bond')) ring.push({ id: 'bond:p:' + love.id, bond: love.id, type: 'love', label: cut(love.姓名, 6), sub: `${love.世界} · 好感 ${num(love.好感度)}`, rec: love, src: '诸天系统.羁绊库', w: num(love.好感度), kind: 'love', dark: num(love.黑化值) > 0, name: str(love.姓名) });
    arr(z?.打手).forEach((m, i) => { if (m?.名称) ring.push({ id: 'bond:s:' + i, type: 'summon', label: cut(m.名称, 6), sub: `忠诚 ${num(m.忠诚)}`, rec: m, src: `诸天系统.打手[${i}]`, w: num(m.忠诚), kind: 'summon', name: str(m.名称) }); });
    const g = obj(z?.聊天群);
    arr(g.成员).forEach(m => { if (m?.id && m?.名称) ring.push({ id: 'bond:m:' + m.id, type: 'member', label: cut(m.名称, 6), sub: cut(m.世界 || '', 7), rec: { id: m.id, 名称: m.名称, 世界: m.世界, 实力档: m.档, 好感: m.好感, 身份: m.身份, 性格: m.性格, 特产: m.特产 }, src: `诸天系统.聊天群.成员[${m.id}]`, w: num(m.好感, 20), kind: 'member', member: m.id, descended: g.降临?.id === m.id, name: str(m.名称) }); });
    const n = ring.length, inner = ring.filter(r => r.kind !== 'member'), outer = ring.filter(r => r.kind === 'member');
    const place = (list, R, off) => list.forEach((r, i) => { const a = off + (i / Math.max(1, list.length)) * Math.PI * 2; r.x = Math.round(cx + Math.cos(a) * R); r.y = Math.round(cy + Math.sin(a) * R * 0.82); });
    place(inner, outer.length ? 110 : 150, -Math.PI / 2); place(outer, 205, -Math.PI / 2 + Math.PI / Math.max(2, outer.length) + (inner.length % 2 ? 0 : 0.35));
    for (const r of ring) { nodes.push(r); edges.push({ from: 'host', to: r.id, label: { system: '契约', love: '羁绊', summon: '打手', member: '群员' }[r.kind], kind: r.kind, w: Math.max(0, Math.min(100, r.w)), dark: !!r.dark }); }
    // Tasks mentioning a person: listed in the detail panel (links back to 事件线).
    const lib = obj(z?.任务库);
    for (const r of ring) if (r.name) r.tasks = Object.entries(lib).filter(([, t]) => t && [t.名称, t.内容, t.来源, t.依据].some(s => str(s).includes(r.name))).map(([id, t]) => ({ id, 名称: t.名称 || id }));
    return { nodes, edges, w: 600, h: 460, count: n };
}

/** 星图: worlds from 万界足迹 + the current world + worlds group members come from; the travel path in visit order. */
export function buildStars(z) {
    const cur = str(z?.当前世界), list = arr(z?.万界足迹).filter(x => x?.名称).map(x => ({ ...x, 名称: str(x.名称) }));
    if (cur && !EMPTY.test(cur) && !list.some(x => x.名称 === cur)) list.push({ 名称: cur, 类型: str(z?.世界类型), 首次楼层: null, 次数: 1, 首次: Infinity, synthetic: true });
    list.sort((a, b) => num(a.首次, Infinity) - num(b.首次, Infinity));
    const nodes = [], edges = [], cx = 300, cy = 220;
    list.forEach((x, i) => {
        const a = i * 2.399963 - 0.6, r = i === 0 ? 0 : 92 + 42 * Math.sqrt(i - 1);
        // 0.9.3: the current world follows the live 世界类型 (same rule as the terminal theme / top badge); every world
        // lets an explicit 类型 win over the 主题 frozen when the footprint was recorded (the node used to say 仙侠 while
        // the top bar already showed 全息 for the same world).
        const isCur = x.名称 === cur, wtype = isCur ? (str(z?.世界类型) || str(x.类型)) : str(x.类型);
        const theme = isCur ? classifyWorld({ type: wtype, name: x.名称, currency: str(z?.当前货币) }) : wtype ? classifyWorld({ type: wtype, name: x.名称 }) : (x.主题 || classifyWorld({ name: x.名称 }));
        const guess = !wtype;
        // 0.9.3: an explicit 世界类型 is shown as written; a guess from the name is marked「?」so it reads as correctable.
        nodes.push({ id: 'world:' + x.名称, type: 'world', label: cut(x.名称, 7), sub: (guess ? (THEMES[theme]?.label || '') + '?' : wtype) + (x.次数 > 1 ? ` · ${x.次数}次` : ''), guess, wtype, theme, x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r * 0.78), current: isCur, rec: x.synthetic ? { 名称: x.名称, 类型: x.类型 || '', 说明: '当前世界（尚无足迹记录）' } : x, src: x.synthetic ? '诸天系统.当前世界' : '诸天系统.万界足迹', name: x.名称, 次数: x.次数, floor: floorOf(x.首次楼层) });
        if (i > 0) edges.push({ from: 'world:' + list[i - 1].名称, to: 'world:' + x.名称, kind: 'path' });
    });
    const known = new Set(list.map(x => x.名称)), extra = new Map();
    for (const m of arr(obj(z?.聊天群).成员)) { const w = str(m?.世界); if (w && !known.has(w)) { if (!extra.has(w)) extra.set(w, []); extra.get(w).push(m); } }
    [...extra.entries()].forEach(([w, ms], i) => {
        const a = i / Math.max(1, extra.size) * Math.PI * 2 + 0.4, theme = classifyWorld({ name: w });
        nodes.push({ id: 'world:' + w, type: 'rumor', label: cut(w, 7), sub: '群员出身', theme, x: Math.round(cx + Math.cos(a) * 250), y: Math.round(cy + Math.sin(a) * 175), rec: { 名称: w, 群员: ms.map(m => m.名称).join('、'), 说明: '未去过 · 来自聊天群成员的世界' }, src: '诸天系统.聊天群.成员', name: w, members: ms.map(m => m.id) });
    });
    return { nodes, edges, w: 600, h: 440 };
}

/** 能力树: 宿主 → 实力档 ladder · 功法 · 神通记录 · 外挂 (original 6 per-chat switches + enabled 自拟外挂). */
export function buildTree(z, plugins = { off: [], custom: [] }) {
    const nodes = [], edges = [], leaves = [];
    const tier = num(z?.宿主实力档), br = [
        { id: 'br:tier', label: '实力档', items: tier ? [{ id: 'tier', label: TIERS[tier]?.n || String(tier), sub: `第 ${tier} 档`, rec: { 宿主实力档: tier, ...TIERS[tier] }, src: '诸天系统.宿主实力档', go: 'art' }] : [{ id: 'tier', label: '未确认', sub: '在神通页确认', rec: { 宿主实力档: '未设置' }, src: '诸天系统.宿主实力档', go: 'art', dim: true }] },
        { id: 'br:skill', label: '功法', items: arr(z?.功法库).filter(s => s?.名称).map(s => ({ id: 'skill:' + str(s.名称), label: cut(s.名称, 8), sub: stageOf(s) + (str(obj(z?.功法).名称) === str(s.名称) ? ' · 主修' : ''), rec: s, src: '诸天系统.功法库', go: 'cult', main: str(obj(z?.功法).名称) === str(s.名称) })) },
        { id: 'br:art', label: '神通', items: arr(z?.神通记录).slice(-8).map((r, i, a) => ({ id: 'art:' + (arr(z?.神通记录).length - a.length + i), label: cut(r?.摘要 || r?.名称 || '神通', 8), sub: r?.时间 ? new Date(r.时间).toLocaleDateString('zh-CN') : '', rec: r, src: '诸天系统.神通记录', go: 'art' })) },
        { id: 'br:plug', label: '外挂', items: [...BUILTIN.map(n => ({ id: 'plug:' + n, label: n, sub: plugins.off?.includes(n) ? '本聊天关闭' : '原版', rec: { 名称: n, 状态: plugins.off?.includes(n) ? '本聊天已关闭（外挂管理）' : '启用' }, src: '聊天元数据 · 外挂开关', go: 'plug', dim: plugins.off?.includes(n) })),
            ...arr(plugins.custom).map(p => ({ id: 'plug:c:' + p.id, label: cut(p.name, 8), sub: '自拟 · ' + (p.grade || ''), rec: { 名称: p.name, 品级: p.grade, 类型: p.type, 规则: p.rule }, src: '外挂库（本机） · 本聊天已装载', go: 'plugmgr' }))] },
    ];
    const LEAF = 44; let y = 34;
    nodes.push({ id: 'root', type: 'root', label: '宿主', sub: str(z?.当前世界) || '', x: 60, y: 0, rec: { 当前世界: z?.当前世界 || '', 系统点: z?.系统点 ?? '' }, src: '诸天系统' });
    for (const b of br) {
        const start = y, items = b.items.length ? b.items : [{ id: b.id + ':empty', label: '暂无', sub: '', rec: { 说明: '账本里还没有记录' }, src: '', dim: true, empty: true }];
        for (const it of items) { nodes.push({ ...it, type: 'leaf', branch: b.id, x: 390, y }); edges.push({ from: b.id, to: it.id, kind: 'leaf' }); leaves.push(it); y += LEAF; }
        nodes.push({ id: b.id, type: 'branch', label: b.label, sub: `${b.items.length}`, x: 210, y: Math.round((start + y - LEAF) / 2), rec: { 分支: b.label, 数量: b.items.length }, src: '' });
        edges.push({ from: 'root', to: b.id, kind: 'branch' });
        y += 14;
    }
    nodes.find(n => n.id === 'root').y = Math.round((34 + y - 14 - LEAF) / 2);
    return { nodes, edges, w: 600, h: Math.max(160, y + 10) };
}

// ---------- the pages ----------
const PAGES = [['events', '事件线', 'task'], ['bonds', '羁绊图', 'heart'], ['stars', '星图', 'atlas'], ['tree', '能力树', 'lotus']];
const HINT = {
    events: '还没有任务记录。AI 发布任务后，这里会按楼层画出 起因 → 任务 → 结算。',
    bonds: '只有你和莉莉丝。锁定羁绊、召唤打手或邀请群员后会出现在这里。',
    stars: '还没有世界记录。AI 写入「当前世界」或在下方记录一次穿越后，星图会点亮。',
    tree: '',
};
const TYPE_LABEL = { cause: '起因', task: '任务', receipt: '结算凭据', fail: '失败', pending: '待结算', reward: '奖励', host: '宿主', lilith: '莉莉丝', love: '羁绊对象', summon: '打手', member: '群员', world: '世界', rumor: '传闻世界', root: '宿主', branch: '分支', leaf: '记录' };

export class HubAtlas {
    constructor(app) { this.app = app; this.sel = {}; this.els = {}; this.disposers = []; this.graphs = {}; }
    get hub() { return this.app.hub; }
    ledger() { try { const z = this.app.bridge.getVariables({ type: 'chat' })?.诸天系统; return z && typeof z === 'object' ? z : null; } catch { return null; } }
    start() {
        const hub = this.hub; if (!hub) return this;
        for (const [id, label, ic] of PAGES) hub.addNav('图谱', id, label, ic, { title: label, render: el => { this.els[id] = el; this.paint(id, true); } });
        const repaint = () => { const p = hub.page; if (hub.isOpen && this.els[p]) this.paint(p); };
        this.disposers.push(this.app.bridge.onChange(k => { if (k === 'chat') repaint(); }));
        this.disposers.push(this.app.adapter.subscribe(() => { this.sel = {}; repaint(); }));
        hub.hook('onEngineTab', (n, tools) => this.engineLinks(n, tools));
        return this;
    }
    onHistory() { if (this.hub?.isOpen && this.hub.page === 'events') this.paint('events'); }
    graph(id, z) {
        if (id === 'events') return buildEvents(z);
        if (id === 'bonds') return buildBonds(z);
        if (id === 'stars') return buildStars(z);
        const p = this.app.plugins; let plugins = { off: [], custom: [] };
        try { plugins = { off: p?.chatState?.().off || [], custom: p?.enabled?.() || [] }; } catch { /* plugins module absent */ }
        return buildTree(z, plugins);
    }
    paint(id, force = false) {
        const el = this.els[id]; if (!el || (!force && this.hub.page !== id)) return;
        const z = this.ledger();
        if (!z) { el.innerHTML = `<div class="zt-empty">当前聊天没有诸天账本。<br>在「设置 → 新聊天初始化」创建后，图谱会从账本自动生成。</div>`; return; }
        const g = this.graph(id, z); this.graphs[id] = g;
        const keep = el.querySelector('.zt-atlas-canvas')?.scrollTop || 0, fx = el.querySelector('.zt-atlas-fix');
        // 0.9.3: a ledger write while the 更正 box is open repaints the page — keep what the user was typing.
        const fixKeep = fx ? { node: this.sel[id], open: fx.open, name: fx.querySelector('[data-f=fix-name]')?.value, type: fx.querySelector('[data-f=fix-type]')?.value } : null;
        if (this.sel[id] && !g.nodes.some(n => n.id === this.sel[id])) this.sel[id] = null;
        const empty = (id === 'events' && !g.nodes.length) || (id === 'bonds' && g.count <= 1) || (id === 'stars' && !g.nodes.length);
        el.classList.add('zt-atlas-page');
        el.innerHTML = `<div class="zt-atlas" data-atlas="${id}">
<header class="zt-atlas-head"><div><b>${esc(PAGES.find(p => p[0] === id)[1])}</b><small>${esc(this.caption(id, g, z))}</small></div>${this.legend(id)}</header>
<div class="zt-atlas-body"><div class="zt-atlas-canvas">${empty ? `<div class="zt-empty zt-atlas-empty">${esc(HINT[id])}</div>` : ''}${this.svg(id, g)}</div>
<aside class="zt-atlas-detail" aria-live="polite">${this.detail(id, g, z)}</aside></div>
${id === 'events' ? this.historyList() : ''}${id === 'stars' ? this.travelForm(z) : ''}</div>`;
        const canvas = el.querySelector('.zt-atlas-canvas'); if (canvas) canvas.scrollTop = keep;
        const fx2 = el.querySelector('.zt-atlas-fix');
        if (fx2 && fixKeep && fixKeep.node === this.sel[id]) { fx2.open = fixKeep.open; const i = fx2.querySelector('[data-f=fix-name]'), t = fx2.querySelector('[data-f=fix-type]'); if (i && fixKeep.name != null) i.value = fixKeep.name; if (t && fixKeep.type != null) t.value = fixKeep.type; }
        if (!el.__ztBound) { el.__ztBound = true; this.bind(el, id); }
    }
    caption(id, g, z) {
        if (id === 'events') return `${Object.keys(obj(z.任务库)).length} 个任务 · ${Object.keys(obj(z.任务结算凭据)).length} 条结算凭据 · 数据：任务库 / 任务结算凭据 / 万界足迹`;
        if (id === 'bonds') return `${g.count} 条羁绊 · 数据：恋爱目标 / 打手 / 聊天群.成员`;
        if (id === 'stars') return `${g.nodes.filter(n => n.type === 'world').length} 个到访世界 · 当前：${str(z.当前世界) || '未记录'} · 数据：当前世界 / 万界足迹`;
        return `实力档 · 功法 ${arr(z.功法库).length} · 神通记录 ${arr(z.神通记录).length} · 外挂`;
    }
    legend(id) {
        const L = { events: [['cause', '起因'], ['task', '任务'], ['receipt', '结算'], ['fail', '失败']], bonds: [['love', '羁绊'], ['summon', '打手'], ['member', '群员']], stars: [['world', '到访'], ['current', '当前'], ['rumor', '传闻']], tree: [['branch', '分支'], ['leaf', '记录']] }[id] || [];
        return `<div class="zt-atlas-legend">${L.map(([k, t]) => `<span data-k="${k}"><i></i>${t}</span>`).join('')}</div>`;
    }
    svg(id, g) {
        if (!g.nodes.length) return '';
        const by = new Map(g.nodes.map(n => [n.id, n])), sel = this.sel[id];
        const near = new Set(sel ? g.edges.filter(e => e.from === sel || e.to === sel).flatMap(e => [e.from, e.to]) : []);
        const path = e => {
            const a = by.get(e.from), b = by.get(e.to); if (!a || !b) return '';
            let d;
            if (id === 'events' && e.kind === 'chain') { const mx = a.x + 110; d = `M${a.x + 56} ${a.y}C${mx} ${a.y} ${mx} ${b.y} ${b.x + 56} ${b.y}`; }
            else if (id === 'tree') { const mx = (a.x + b.x) / 2; d = `M${a.x + 40} ${a.y}C${mx} ${a.y} ${mx} ${b.y} ${b.x - 50} ${b.y}`; }
            else if (id === 'events') d = `M${a.x + 58} ${a.y}L${b.x - 58} ${b.y}`;
            else d = `M${a.x} ${a.y}L${b.x} ${b.y}`;
            const w = id === 'bonds' ? (1 + (e.w || 0) / 22).toFixed(1) : '';
            return `<path class="zt-edge" data-kind="${e.kind}"${e.dark ? ' data-dark="1"' : ''}${sel && (e.from === sel || e.to === sel) ? ' data-hot="1"' : ''}${w ? ` style="stroke-width:${w}"` : ''} d="${d}"/>`;
        };
        const bands = (g.bands || []).map(b => `<g class="zt-band"><rect x="4" y="${b.y}" width="${g.w - 8}" height="${b.h}" rx="10"/><text x="12" y="${b.y + 14}">${esc(b.world)}</text></g>`).join('');
        const node = n => {
            const r = id === 'events' || id === 'tree' ? { w: n.type === 'root' ? 80 : n.type === 'branch' ? 80 : id === 'tree' ? 100 : 116, h: 38 } : null;
            const shape = r ? `<rect x="${-r.w / 2}" y="${-r.h / 2}" width="${r.w}" height="${r.h}" rx="${n.type === 'cause' ? 19 : 8}"/>`
                : id === 'stars' ? `<circle r="${n.current ? 15 : n.type === 'rumor' ? 7 : 11}"/>${n.current ? '<circle r="24" class="zt-halo"/>' : ''}`
                    : `<circle r="${n.type === 'host' ? 30 : n.type === 'lilith' ? 24 : 20}"/>${n.descended ? '<circle r="28" class="zt-halo"/>' : ''}`;
            const ty = r ? [-3, 12] : id === 'stars' ? [n.current ? 34 : 26, n.current ? 47 : 39] : [n.type === 'host' ? 4 : 36, n.type === 'host' ? 18 : 49];
            const aria = `${TYPE_LABEL[n.type] || ''}：${n.label}${n.sub ? '，' + n.sub : ''}`;
            return `<g class="zt-node" tabindex="0" role="button" aria-label="${esc(aria)}" data-node="${esc(n.id)}" data-type="${n.type}"${n.state ? ` data-state="${esc(n.state)}"` : ''}${n.theme ? ` data-theme="${n.theme}"` : ''}${n.current ? ' data-current="1"' : ''}${n.dim ? ' data-dim="1"' : ''}${n.main ? ' data-main="1"' : ''}${sel === n.id ? ' data-sel="1"' : ''}${sel && !near.has(n.id) && sel !== n.id ? ' data-far="1"' : ''} transform="translate(${n.x} ${n.y})">${shape}<text y="${ty[0]}" class="l">${esc(n.label)}</text>${n.sub ? `<text y="${ty[1]}" class="s">${esc(n.sub)}</text>` : ''}</g>`;
        };
        return `<svg class="zt-atlas-svg" viewBox="0 0 ${g.w} ${g.h}" style="aspect-ratio:${g.w}/${g.h}" role="group" aria-label="图谱节点，Tab 或方向键切换，回车查看">${id === 'stars' ? this.starfield(g) : ''}${bands}<g class="zt-edges">${g.edges.map(path).join('')}</g><g class="zt-nodes">${g.nodes.map(node).join('')}</g></svg>`;
    }
    starfield(g) { let s = 7, out = ''; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280; for (let i = 0; i < 60; i++) out += `<circle class="zt-dust" cx="${(r() * g.w).toFixed(0)}" cy="${(r() * g.h).toFixed(0)}" r="${(r() * 1.3 + .3).toFixed(1)}"/>`; return `<g aria-hidden="true">${out}</g>`; }
    detail(id, g, z) {
        const n = g.nodes.find(x => x.id === this.sel[id]);
        if (!n) return `<div class="zt-atlas-tip"><b>选择一个节点</b><p>点击或用 Tab / 方向键选中节点，这里会显示它对应的账本原始记录和跳转。</p></div>`;
        const rows = Object.entries(obj(n.rec)).filter(([k, v]) => v !== '' && v != null && typeof v !== 'function').slice(0, 14)
            .map(([k, v]) => `<div class="zt-kv"><span>${esc(k)}</span><b>${esc(typeof v === 'object' ? JSON.stringify(v) : k === '首次' || k === '最近' || k === '时间' ? (num(v) ? new Date(num(v)).toLocaleString('zh-CN') : v) : String(v))}</b></div>`).join('');
        const by = new Map(g.nodes.map(x => [x.id, x]));
        const links = [...g.edges.filter(e => e.to === n.id).map(e => ['←', e, by.get(e.from)]), ...g.edges.filter(e => e.from === n.id).map(e => ['→', e, by.get(e.to)])].filter(x => x[2]);
        const acts = this.actions(id, n, z);
        return `<div class="zt-atlas-rec"><small>${esc(TYPE_LABEL[n.type] || '')}${n.src ? ` · <code>${esc(n.src)}</code>` : ''}</small><h4>${esc(n.rec?.名称 || n.rec?.姓名 || n.label)}</h4>
<div class="zt-kvs">${rows || '<p class="zt-sub">没有更多字段。</p>'}</div>
${links.length ? `<div class="zt-atlas-links"><small>因果 / 关联</small>${links.map(([d, e, o]) => `<button type="button" class="zt-chip" data-focus="${esc(o.id)}">${d} ${esc(e.label || TYPE_LABEL[o.type] || '')}：${esc(o.label)}</button>`).join('')}</div>` : ''}
${n.tasks?.length ? `<div class="zt-atlas-links"><small>相关任务</small>${n.tasks.slice(0, 6).map(t => `<button type="button" class="zt-chip" data-jump-task="${esc(t.id)}">${esc(cut(t.名称, 10))}</button>`).join('')}</div>` : ''}
<div class="zt-actions">${acts}</div>${n.type === 'world' ? this.fixForm(n) : ''}</div>`;
    }
    /** 0.9.3 星图 → 更正: the world name / type was detected wrong (AI wrote it, or the name guess picked a theme). */
    fixForm(n) {
        const how = n.guess ? `按名称自动猜测为「${THEMES[n.theme]?.label || '诸天'}」，可能不准` : `世界类型：${n.wtype}`;
        return `<details class="zt-atlas-fix"${n.current && n.guess ? ' open' : ''}><summary>识别错了？更正这个世界</summary>
<p class="zt-sub">${esc(how)}。更正只改账本里的名称 / 类型（加锁写入并读回），不算一次穿越，也不播放演出。</p>
<div class="zt-g-row"><input type="text" data-f="fix-name" maxlength="30" value="${esc(n.name)}" aria-label="更正后的世界名"><select data-f="fix-type" aria-label="更正后的世界类型"><option value="">类型（自动判断）</option>${[...WORLD_TYPES, ...(n.wtype && !WORLD_TYPES.includes(n.wtype) ? [n.wtype] : [])].map(t => `<option${t === n.wtype ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
<div class="zt-actions"><button type="button" class="zt-btn small primary" data-fix="${esc(n.name)}">保存更正</button>${n.current ? '' : `<button type="button" class="zt-btn small danger" data-forget="${esc(n.name)}">从足迹删除</button>`}</div></details>`;
    }
    actions(id, n, z) {
        const b = (attr, label, primary = false) => `<button type="button" class="zt-btn small${primary ? ' primary' : ''}" ${attr}>${esc(label)}</button>`;
        const out = [];
        if (n.task) out.push(b(`data-open-task="${esc(n.task)}"`, '在任务页定位', true));
        if (n.floor !== null && n.floor !== undefined) out.push(b(`data-floor="${n.floor}"`, `跳到楼层 #${n.floor}`));
        if (n.bond) out.push(b(`data-open-bond="${esc(n.bond)}"`, '查看此人物羁绊', true));
        if (n.member) out.push(b(`data-open-member="${esc(n.member)}"`, '在聊天群查看', true));
        if (n.type === 'love' || n.type === 'summon') out.push(b(`data-go="${n.type === 'love' ? 'bond' : 'plug'}"`, n.type === 'love' ? '打开羁绊页' : '打开外挂页（诸天打手）', true));
        if (n.type === 'lilith') out.push(b('data-go="work"', '去工作台'));
        if (n.go) out.push(b(`data-go="${n.go}"`, { art: '打开神通页', cult: '打开修行页', plug: '打开外挂页', plugmgr: '打开外挂管理' }[n.go] || '打开', true));
        if ((n.type === 'world' || n.type === 'rumor') && !n.current) out.push(b(`data-travel="${esc(n.name)}"`, '记录穿越到这里', true));
        if (n.members?.length) out.push(b(`data-open-member="${esc(n.members[0])}"`, '查看群员'));
        return out.join('');
    }
    historyList() {
        const h = this.app.fx?.history || [];
        return `<section class="zt-card zt-atlas-hist"><h3>本次会话的演出 <small>只在账本读回确认后播放；被回滚的会标为“未入账”</small></h3>${h.length ? h.slice(0, 12).map((x, i) => `<div class="zt-row" data-state="${x.state}"><span><b>${esc(x.title)}</b> ${esc(x.detail)}</span><span class="zt-sub">${x.state === 'dropped' ? '未入账（已回滚）' : '已确认'} · ${new Date(x.t).toLocaleTimeString('zh-CN')}</span>${x.state !== 'dropped' ? `<button type="button" class="zt-btn small" data-hist="${i}">查看</button>` : ''}</div>`).join('') : '<p class="zt-sub">还没有。任务结算、穿越、突破、抽取、入库时会记在这里。</p>'}</section>`;
    }
    travelForm(z) {
        return `<section class="zt-card zt-atlas-travel"><h3>记录穿越 <small>写入 当前世界 / 世界类型 / 万界足迹（加锁写入并读回），界面主题随之切换</small></h3>
<div class="zt-g-row"><input type="text" data-f="world" maxlength="30" placeholder="世界名，例如：夜之城" aria-label="世界名"><select data-f="wtype" aria-label="世界类型"><option value="">类型（自动判断）</option>${['仙侠', '赛博', '诡异', '都市', '西幻', '末世', '其他'].map(t => `<option>${t}</option>`).join('')}</select><button type="button" class="zt-btn primary small" data-travel-form>记录穿越</button></div></section>`;
    }
    select(id, nodeId, { focus = true, speak = true } = {}) {
        this.sel[id] = nodeId; this.paint(id, true);
        const el = this.els[id], g = this.graphs[id], n = g?.nodes.find(x => x.id === nodeId);
        const target = el?.querySelector(`.zt-node[data-node="${CSS.escape(nodeId)}"]`);
        if (target && focus) { try { target.focus({ preventScroll: true }); scrollWithin(target); resetPageScroll(); } catch { /* ignore */ } }
        if (!n || !speak) return;
        const L = this.app.lilith; if (!L) return;
        if (n.type === 'task') L.react('task', { ...this.ledger()?.任务库?.[n.task], id: n.task });
        else if (n.type === 'world' || n.type === 'rumor') L.react('world', { 名称: n.name, current: n.current, 次数: n.次数 });
        else if (['love', 'summon', 'member'].includes(n.type)) L.react('bond', { 名称: n.name, hint: n.sub });
        else if (n.id.startsWith('skill:')) L.react('skill', { ...n.rec, 阶段: n.sub });
    }
    /** From fx result cards and other pages: open a page with a record selected. */
    focus(page, ref) {
        const map = { events: r => r.startsWith('task:') ? r : null, bonds: r => r === 'lilith' ? 'lilith' : r.startsWith('bond:') ? r : null, tree: r => r === 'tier' ? 'tier' : r.startsWith('skill:') ? r : null, stars: r => r };
        if (!this.els[page] || !map[page]) return;
        let id = map[page](String(ref || ''));
        if (page === 'stars' && !String(ref).startsWith('world:')) id = 'world:' + str(this.ledger()?.当前世界);
        if (id) this.select(page, id, { speak: false });
    }
    bind(el, id) {
        el.addEventListener('click', async e => {
            const t = e.target.closest('button, .zt-node'); if (!t) return;
            const d = t.dataset;
            if (t.classList.contains('zt-node')) return this.select(id, d.node);
            if (d.focus) return this.select(id, d.focus);
            if (d.jumpTask) { this.hub.go('events'); return setTimeout(() => this.select('events', 'task:' + d.jumpTask), 30); }
            if (d.openTask) return this.openTask(d.openTask);
            if (d.floor) return this.jumpFloor(Number(d.floor));
            if (d.openBond) return this.app.bonds?.open(d.openBond);
            if (d.openMember) { this.hub.go('group'); const g = this.app.group; if (g) { g.view = 'members'; g.pm = d.openMember; g.paint(true); } return; }
            if (d.go) return this.hub.go(d.go);
            if (d.hist) { const x = this.app.fx?.history?.[Number(d.hist)]; if (x) this.app.fx.openRecord(x); return; }
            if (d.travel !== undefined && d.travel) return this.travel(d.travel, '');
            if (t.hasAttribute('data-travel-form')) {
                const n = el.querySelector('[data-f=world]')?.value, ty = el.querySelector('[data-f=wtype]')?.value;
                // 0.9.3: the current world's name again = a type correction, not a 穿越 (used to fail with 已经在这个世界了).
                if (String(n || '').trim() && String(n).trim() === str(this.ledger()?.当前世界)) return this.fix(String(n).trim(), n, ty);
                return this.travel(n, ty);
            }
            if (d.fix !== undefined) { const box = t.closest('.zt-atlas-fix'); return this.fix(d.fix, box?.querySelector('[data-f=fix-name]')?.value, box?.querySelector('[data-f=fix-type]')?.value); }
            if (d.forget !== undefined) return this.forget(d.forget);
        });
        el.addEventListener('keydown', e => {
            const t = e.target.closest?.('.zt-node'); if (!t) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(id, t.dataset.node); return; }
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            const all = [...el.querySelectorAll('.zt-node')], i = all.indexOf(t);
            all[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]?.focus();
        });
    }
    async travel(name, type) {
        const w = this.app.world; if (!w) return;
        try {
            const r = await w.travel(name, type);
            this.app.fx?.play({ kind: 'travel', from: r.from, to: r.to, type: r.type, ref: 'world:' + r.to });
            this.sel.stars = 'world:' + r.to; this.paint('stars', true);
        } catch (e) { this.hub.toast(e.message || String(e), 4000); }
    }
    async fix(from, name, type) {
        const w = this.app.world; if (!w) return;
        try {
            const r = await w.correct(from, { name, type });
            this.sel.stars = 'world:' + r.to; this.paint('stars', true);
            this.hub.toast(`已更正：${r.from === r.to ? r.to : `${r.from} → ${r.to}`}（${r.type || '类型自动判断'}）${r.current ? '，界面主题已同步' : ''}`, 3000);
        } catch (e) { this.hub.toast(e.message || String(e), 4000); }
    }
    async forget(name) {
        const w = this.app.world; if (!w) return;
        if (!globalThis.confirm?.(`从万界足迹里删除「${name}」？只删这条足迹记录，不影响聊天内容。`)) return;
        try { await w.forget(name); this.sel.stars = null; this.paint('stars', true); this.hub.toast(`已从足迹删除「${name}」`, 2500); }
        catch (e) { this.hub.toast(e.message || String(e), 4000); }
    }
    /** 任务页 in the engine: switch tab, then focus the original row for this task. */
    openTask(id) {
        this.hub.go('task');
        let n = 0; const find = () => {
            const doc = this.hub.engineFrame?.contentDocument, row = doc?.querySelector(`[data-task-focus="${CSS.escape(id)}"]`);
            if (row) { scrollWithin(row, { block: 'center' }); resetPageScroll(); row.classList.add('zt-flash'); setTimeout(() => row.classList.remove('zt-flash'), 1600); try { row.focus({ preventScroll: true }); } catch { /* ignore */ } }
            else if (++n < 12) setTimeout(find, 150);
        }; setTimeout(find, 80);
    }
    jumpFloor(f) {
        const mes = document.querySelector(`#chat .mes[mesid="${f}"]`);
        if (!mes) { this.hub.toast(`楼层 #${f} 不在当前加载的聊天里（可能需要先加载更早的消息）。`, 4000); return; }
        this.hub.close();
        setTimeout(() => { scrollWithin(mes, { block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); resetPageScroll(); mes.classList.add('zt-floor-flash'); setTimeout(() => mes.classList.remove('zt-floor-flash'), 1800); }, 200);
    }
    engineLinks(n, tools) {
        const map = { 1: ['stars', '星图'], 2: ['bonds', '羁绊图'], 3: ['events', '事件线'], 4: ['tree', '能力树'], 8: ['tree', '能力树'] }, m = map[n];
        tools.querySelector('.zt-atlas-link')?.remove();
        if (!m) return;
        const a = document.createElement('button'); a.type = 'button'; a.className = 'zt-btn small zt-atlas-link'; a.textContent = `查看${m[1]} ›`;
        a.addEventListener('click', () => this.hub.go(m[0]));
        tools.append(a);
    }
    dispose() { this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); }
}
