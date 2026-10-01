// 莉莉丝是界面角色 (0.7.0).
// She reacts to what the user selects and to what the ledger confirms — using ONLY the original stage: the original
// `speak(zone)` picks the motion + expression sequence of that body zone (rig.react + face timers) and we replace the
// bubble text with a data-driven line. No new body animation, no fake Live2D.
//
// Camera (镜头): the same original art, different framing —
//   full  工作台 / 记忆 / 规则: the whole standing portrait (original);
//   mid   system pages: shorter portrait box, framed from the head down (no scaling of the rig itself, the box only clips);
//   near  私聊: a face close-up strip under the chat header, following the stage expression (the expression stills in
//         assets/lilith/variants have the original body/background and only a re-drawn face);
//   剧情提示 (outside the terminal): a bust crop on the result card (src/fx.js).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
const fmt = x => num(x).toLocaleString('zh-CN');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const fill = (tpl, d) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(d[k] ?? ''));
const HIGH = new Set(['神品', '禁忌', '混沌']);

/** Zone = which original reaction (motion + expression) plays. Lines are picked round-robin per key. */
export const REACT = Object.freeze({
    'fx:task': { zone: 'wing', lines: ['「{name}」结清了！{pts}', '任务完成，账本已经记上——{pts}', '干得漂亮。「{name}」，结算完毕。'] },
    'fx:fail': { zone: 'lower', lines: ['「{name}」……失败了。没关系，莉莉丝还在。', '这次没成。账本上写着失败，没有乱扣你的点数。'] },
    'fx:travel': { zone: 'horn', lines: ['坐标锁定：{to}。这里的规则不一样，跟紧我。', '欢迎来到{to}。先别急着惹事哦。'] },
    'fx:breakthrough': { zone: 'chest', lines: ['{name}到「{stage}」了——感觉到了吗？', '突破成功。{name}，{stage}。'] },
    'fx:contract': { zone: 'cheek', lines: ['契约成立：{name}。我记住这个名字了。', '{name}……好，从今天起算是自己人。'] },
    'fx:draw': { zone: 'wing', lines: ['抽了 {n} 次，东西先放进待处理，看看要不要？', '{n} 连抽，结果都在待处理里。'] },
    'fx:draw-high': { zone: 'chest', lines: ['{best}！你今天的运气是借来的吧？', '出{best}了——别告诉别人。'] },
    'fx:reward': { zone: 'thigh', lines: ['{items} 已经收进背包。', '入库完成：{items}。'] },
    'item': { zone: 'wing', lines: ['「{name}」，{grade}。{effect}', '{name}——{effect}'] },
    'item-high': { zone: 'horn', lines: ['{grade}的「{name}」……拿稳了。{effect}', '这可是{grade}：{name}。'] },
    'task': { zone: 'cheek', lines: ['「{name}」，{state}。{hint}', '{name}：{hint}'] },
    'task-done': { zone: 'wing', lines: ['「{name}」已经完成了，{hint}', '这个结了：{name}。'] },
    'task-fail': { zone: 'lower', lines: ['「{name}」失败了……要换个做法吗？'] },
    'skill': { zone: 'chest', lines: ['{name}，{stage}。{hint}', '「{name}」现在是{stage}。'] },
    'world': { zone: 'horn', lines: ['{name}……{hint}', '要去「{name}」吗？'] },
    'bond': { zone: 'cheek', lines: ['{name}。{hint}', '在意「{name}」？{hint}'] },
    'page:shop': { zone: 'wing', lines: ['商城 Lv.{lv}，余额 {pts} 点。想买什么？'] },
    'page:bag': { zone: 'thigh', lines: ['背包里 {n} 种东西，要我帮你看看哪件最值钱吗？'] },
    'page:task': { zone: 'cheek', lines: ['进行中的任务 {n} 个。一个一个来。'] },
    'page:events': { zone: 'wing', lines: ['这是你走过的路：每个节点都能点开看原始记录。'] },
    'page:stars': { zone: 'horn', lines: ['去过 {n} 个世界了。下一站想去哪？'] },
    'page:bonds': { zone: 'cheek', lines: ['这些人和你有牵连。线越粗，关系越深。'] },
    'page:tree': { zone: 'chest', lines: ['功法、神通、外挂……都长在这棵树上。'] },
});

export class LilithStage {
    constructor(app) { this.app = app; this.seen = {}; this.last = 0; this.pageSaid = new Set(); this.disposers = []; this.hold = 0; }
    get settings() { return this.app.settings; }
    get cfg() { return { react: true, pageLines: true, camera: true, ...(this.settings.get('lilith') || {}) }; }
    stage() { return this.app.assistant?.stage?.() || null; }
    ledger() { try { const z = this.app.bridge.getVariables({ type: 'chat' })?.诸天系统; return z && typeof z === 'object' ? z : null; } catch { return null; } }
    start() {
        const hub = this.app.hub; if (!hub) return this;
        hub.hook('onEngine', (frame, doc) => this.bindEngine(doc));
        hub.hook('onPage', page => { this.camera(page); this.pageLine(page); });
        hub.hook('onOpen', () => this.camera(hub.page));
        this.disposers.push(this.settings.onChange(k => { if (k === 'lilith') { this.camera(hub.page); this.mountCloseUp(); } }));
        this.mountCloseUp();
        // The private chat panel may be created later by the original window: re-check after clicks inside it.
        const sh = this.app.assistant?.shadow;
        if (sh) { const f = () => setTimeout(() => this.mountCloseUp(), 60); sh.addEventListener('click', f, true); this.disposers.push(() => sh.removeEventListener('click', f, true)); }
        this.camera(hub.page);
        return this;
    }
    // ---------- reactions ----------
    pick(key, d) {
        const r = REACT[key]; if (!r) return '';
        const n = this.seen[key] = (this.seen[key] ?? -1) + 1;
        return clip(fill(r.lines[n % r.lines.length], d).replace(/[，。]\s*$/, m => m).replace(/。。/g, '。'), 48);
    }
    /** Plays the original zone reaction and replaces the bubble text. Rate limited so rapid clicking stays calm. */
    say(key, d, { force = false, passive = false } = {}) {
        if (!this.cfg.react) return '';
        const now = Date.now(); if (!force && now - this.last < 1800) return '';
        const st = this.stage(); const text = this.pick(key, d); if (!text) return '';
        if (!passive) this.last = now; this.lastLine = text;
        if (!st || typeof st.speak !== 'function' || !st.frame?.isConnected || !st.frame.getClientRects().length) return text;
        try {
            st.speak(REACT[key].zone);
            if (st.bubble) st.bubble.textContent = text;
            const say = st.bubble?.closest?.('.zt-say'); clearTimeout(this.hold);
            if (say && text.length > 22) this.hold = setTimeout(() => { if (st.bubble.textContent === text) { say.dataset.show = 'true'; this.hold = setTimeout(() => { if (st.bubble.textContent === text) say.dataset.show = 'false'; }, text.length * 150 - 3400); } }, 3300);
        } catch { /* stage gone */ }
        return text;
    }
    fxData(ev) {
        return { name: ev.name || ev.to || '', to: ev.to || '', stage: ev.stage || '', n: ev.n || 1, best: ev.best || '',
            pts: ev.points > 0 ? `+${fmt(ev.points)} 系统点。` : '', items: (ev.items || []).slice(0, 2).map(i => i.名称 || i).join('、') || ev.detail || '' };
    }
    fxKey(ev) { return ev.kind === 'draw' && HIGH.has(ev.best) ? 'fx:draw-high' : 'fx:' + ev.kind; }
    /** Called by fx after the ledger confirmed the event. */
    reactTo(ev) { if (REACT[this.fxKey(ev)]) this.say(this.fxKey(ev), this.fxData(ev), { force: true }); }
    /** Text only (for the outside-terminal story card). */
    lineFor(ev) { const k = this.fxKey(ev); return REACT[k] && this.cfg.react ? (this.lastLine && Date.now() - this.last < 200 ? this.lastLine : this.pick(k, this.fxData(ev))) : ''; }
    react(kind, data) {
        const z = this.ledger() || {};
        if (kind === 'item') {
            const g = String(data.品级 || data.grade || ''), eff = clip(data.效果 || data.描述 || '', 26);
            return this.say(HIGH.has(g) ? 'item-high' : 'item', { name: clip(data.名称, 14), grade: g || '未定级', effect: eff ? eff + (/[。！？]$/.test(eff) ? '' : '。') : '' });
        }
        if (kind === 'task') {
            const t = data || {}, p = num(t.完成度);
            const hint = t.状态 === '已完成' ? (z.任务结算凭据?.[t.id] ? `结算了 ${fmt(z.任务结算凭据[t.id].点数)} 点。` : '奖励等结算。') : p > 0 ? `进度 ${p}%。` : clip(t.内容 || '还没开始。', 22);
            return this.say(t.状态 === '已完成' ? 'task-done' : t.状态 === '已失败' ? 'task-fail' : 'task', { name: clip(t.名称 || t.id, 14), state: t.状态 || '进行中', hint });
        }
        if (kind === 'skill') { const s = data || {}; return this.say('skill', { name: clip(s.名称, 12), stage: s.阶段 || s.stage || '未入门', hint: s.熟练度 != null ? `熟练度 ${fmt(s.熟练度)}。` : '' }); }
        if (kind === 'world') return this.say('world', { name: clip(data.名称, 14), hint: data.current ? '我们现在就在这里。' : data.次数 ? `来过 ${data.次数} 次。` : '还没去过。' });
        if (kind === 'bond') return this.say('bond', { name: clip(data.名称, 12), hint: clip(data.hint || '', 20) });
        return '';
    }
    pageLine(page) {
        if (!this.cfg.pageLines || !this.app.hub?.isOpen || this.pageSaid.has(page) || !REACT['page:' + page]) return;
        const z = this.ledger(); if (!z) return;
        const d = { lv: num(z.商城等级, 1), pts: fmt(z.系统点), n: 0 };
        if (page === 'bag') d.n = (z.背包 || []).length;
        if (page === 'task') d.n = Object.values(z.任务库 || {}).filter(t => t && t.状态 !== '已完成' && t.状态 !== '已失败').length;
        if (page === 'stars') d.n = Math.max((z.万界足迹 || []).length, z.当前世界 ? 1 : 0);
        this.pageSaid.add(page);
        setTimeout(() => this.say('page:' + page, d, { passive: true }), 450);
    }
    bindEngine(doc) {
        if (!doc || doc.__ztLilith) return; doc.__ztLilith = true;
        doc.addEventListener('click', e => {
            const t = e.target;
            const item = t.closest?.('.btn-item-detail[data-item]');
            if (item) { try { this.react('item', JSON.parse(item.dataset.item)); } catch { /* malformed */ } return; }
            const task = t.closest?.('[data-task-focus]');
            if (task) { const id = task.dataset.taskFocus, rec = this.ledger()?.任务库?.[id]; if (rec) this.react('task', { ...rec, id }); return; }
            const gf = t.closest?.('.zt-gf-row');
            if (gf) {
                const name = gf.querySelector('[data-name]')?.dataset.name || gf.querySelector('.mvu-gf-lib-name')?.textContent?.trim();
                const rec = (this.ledger()?.功法库 || []).find(s => s?.名称 === name);
                if (rec) this.react('skill', { ...rec, 阶段: gf.querySelector('.zt-gf-stage,.mvu-gf-stage')?.textContent?.trim() || '' });
            }
        }, true);
    }
    // ---------- camera ----------
    camera(page) {
        const host = this.app.hub?.shadow?.host; if (!host) return;
        if (!this.cfg.camera) { host.removeAttribute('data-zt-cam'); return; }
        host.setAttribute('data-zt-cam', ['work', 'memory', 'rules'].includes(page) ? 'full' : 'mid');
    }
    mountCloseUp() {
        const sh = this.app.assistant?.shadow, panel = sh?.getElementById('lc-panel'), head = sh?.getElementById('lc-head');
        const old = sh?.querySelector('.zt-lc-cam');
        if (!this.cfg.camera || !panel || !head) { old?.remove(); this.mo?.disconnect(); return; }
        if (old) return;
        const cam = document.createElement('div'); cam.className = 'zt-lc-cam'; cam.setAttribute('aria-hidden', 'true');
        cam.innerHTML = '<i class="a"></i><i class="b"></i>';
        head.after(cam);
        const base = this.app.base + 'assets/lilith/variants/';
        let cur = '', front = cam.querySelector('.a'), back = cam.querySelector('.b');
        const set = mood => {
            const m = ['neutral', 'smile', 'shy', 'pout', 'surprised', 'wink', 'smug', 'sad'].includes(mood) ? mood : 'neutral';
            if (m === cur) return; cur = m;
            back.style.backgroundImage = `url("${base}${m}.webp")`; back.classList.add('on'); front.classList.remove('on');
            [front, back] = [back, front];
        };
        const st = sh.querySelector('.zt-stage'); set(st?.dataset.expression || 'neutral');
        if (st) { this.mo = new MutationObserver(() => set(st.dataset.expression || 'neutral')); this.mo.observe(st, { attributes: true, attributeFilter: ['data-expression'] }); }
        this.disposers.push(() => { this.mo?.disconnect(); cam.remove(); });
    }
    dispose() { this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); clearTimeout(this.hold); this.app.hub?.shadow?.host?.removeAttribute('data-zt-cam'); }
}
export { esc };
