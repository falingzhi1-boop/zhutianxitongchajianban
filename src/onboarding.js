// 0.9.3 新手引导 — the first-run wizard proposed in docs/ROADMAP-1.0.md §6.
// Three steps, each can be done here or skipped, each shows a tick when the real state says it is done (the ticks are
// re-read from SillyTavern / the ledger every time, never remembered):
//   1. 世界书     — the 诸天 worldbook exists and is this plugin's latest version (install + bind / update, backup first)
//   2. AI 接口    — a model is configured for 莉莉丝 / the status bar AI buttons (one tap: SillyTavern's current main API,
//                   or the 0.8.5 three-step 连接 page)
//   3. 当前聊天   — the open single-character chat has an 诸天 ledger and 莉莉丝 memory is switched on for it
// The wizard is a terminal page (`guide`). It opens by itself once, the first time the terminal opens with something
// still missing; 跳过 / 完成 are remembered in settings.guide. 设置 → 新手引导 reopens it any time. Nothing here
// re-implements a step: it calls the same code as the existing buttons (features.installWorldbook / updateWorldbook /
// initChat, api-center saveConfigs, the original 「保存当前聊天设置」 of the memory page).
import { VERSION } from './contracts.js';
import { esc } from './hub.js';
import { readConfigs, saveConfigs } from './api-center.js';
import { MAIN_API_URL, isMainApi } from './th-bridge.js';
import { errorLine } from './errors.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

/** Pure: the three steps from a status snapshot (for the page and the tests).
 *  st = { wb: {exists, current, count, chatBound} | null, api: {model, main} | null, chat: {open, ledger, memory, assistant} } */
export function guideSteps(st = {}) {
    const wb = st.wb || null, api = st.api || null, chat = st.chat || {};
    const wbDone = !!(wb?.exists && wb?.current);
    const apiDone = !!api?.model;
    const chatDone = !!(chat.open && chat.ledger && (chat.memory || chat.assistant === false));
    return [
        { id: 'wb', title: '导入或更新世界书', done: wbDone,
            text: !wb ? '读取不到世界书状态（宿主没有世界书接口）。可以在 设置 → 世界书安装 / 绑定 里手动处理。'
                : wbDone ? `“诸天万界最强系统”已是最新版（${wb.count} 条）${wb.chatBound ? '，已绑定到当前聊天' : ''}。`
                    : wb.exists ? `已有“诸天万界最强系统”（${wb.count} 条），但不是插件最新版。更新会先另存一份备份，你自己加的条目和开关会保留。`
                        : '还没有安装诸天世界书。安装后 AI 才知道系统规则；已有同名世界书时不会覆盖。' },
        { id: 'api', title: '设置 AI 接口', done: apiDone,
            text: apiDone ? `已设置：${api.main ? '使用酒馆当前的主模型' : api.model}。`
                : '莉莉丝私聊、记忆整理和状态栏里的 AI 按钮要用一个模型。最省事是直接用酒馆正在用的主模型；也可以填独立的 API。不设置也能玩，只是这些功能用不了。' },
        { id: 'chat', title: '在当前聊天启用', done: chatDone,
            text: !chat.open ? '先打开一个单角色聊天（群聊不支持），再回来点这一步。'
                : chatDone ? `当前聊天已有诸天账本${chat.assistant === false ? '' : '，莉莉丝记忆已启用'}。`
                    : `${chat.ledger ? '账本已存在' : '这个聊天还没有诸天账本（会按原版规则创建）'}；${chat.assistant === false ? '莉莉丝窗口没有启动，只处理账本' : chat.memory ? '莉莉丝记忆已启用' : '莉莉丝记忆还没启用'}。` },
    ];
}
/** Pure: should the wizard open by itself? Only once (no answer stored yet) and only when something is missing. */
export function shouldAutoOpen(saved, steps) { return !saved && steps.some(s => !s.done); }

export class Onboarding {
    constructor(app) { this.app = app; this.disposers = []; this.el = null; this.busy = ''; this.note = ''; this.autoTried = false; }
    get hub() { return this.app.hub; }
    get settings() { return this.app.settings; }
    start() {
        const hub = this.hub; if (!hub) return this;
        hub.register('guide', { title: '新手引导', render: el => { this.el = el; this.paint(); } });
        const box = hub.groupBox?.('终端');
        if (box && !box.querySelector('[data-page="guide"]')) { const b = hub.navButton('guide', '引导', 'flag'); b.title = '新手引导：世界书 → AI 接口 → 在当前聊天启用'; b.hidden = !!this.settings.get('guide'); box.prepend(b); this.nav = b; }
        hub.hook('onOpen', () => { this.maybeAuto(); });
        hub.hook('onClose', () => { hub.openedWith = null; });   // the original entry button opens without hub.open()
        hub.hook('onPage', p => this.backStrip(p));
        const repaint = () => { if (hub.isOpen && hub.page === 'guide') this.paint(); };
        this.disposers.push(this.app.bridge.onChange(() => repaint()));
        this.disposers.push(this.app.adapter.subscribe(() => repaint()));
        return this;
    }
    /** Real state of the three steps. Every part may fail on its own (old host, no chat): it then reads as not done. */
    async status() {
        const a = this.app.adapter, f = this.app.features;
        let wb = null; try { wb = await f?.worldbookStatus(); } catch { wb = null; }
        let api = null; try { const { status, assistant } = readConfigs(this.app.bridge, this.ns()); const c = assistant?.model ? assistant : status; api = { model: String(c?.model || ''), main: isMainApi(c?.url) }; } catch { api = null; }
        const open = !!a.currentIdentity?.();
        let ledger = false; try { ledger = !!a.ledger?.(); } catch { ledger = false; }
        const host = this.app.assistant;
        return { wb, api, chat: { open, ledger, memory: open && this.memoryOn(), assistant: host?.hostElement?.isConnected ? true : false } };
    }
    ns() { return this.app.original?.ZhuTianMemoryCore?.NS; }
    memoryOn() { try { const ns = this.ns(); return !!(ns && this.app.bridge.getVariables({ type: 'chat' })?.[ns]?.enabled); } catch { return false; } }
    async maybeAuto() {
        // Only on a plain open (entry button / float / hotkey): a floor tag or a 查看星图 link asked for its own page.
        if (this.autoTried || this.settings.get('guide') || this.hub.openedWith) return;
        this.autoTried = true;
        const steps = guideSteps(await this.status());
        if (!shouldAutoOpen(this.settings.get('guide'), steps)) { if (steps.every(s => s.done)) this.finish('done', true); return; }
        if (this.hub.isOpen) this.hub.go('guide');
    }
    open() { this.hub?.open('guide'); }
    finish(state, silent = false) {
        this.settings.set('guide', { state, at: Date.now(), version: VERSION });
        if (this.nav) this.nav.hidden = true;
        if (!silent) { this.hub?.toast(state === 'done' ? '新手引导完成，祝穿越愉快' : '已跳过新手引导；设置 → 新手引导 可以随时再打开', 3500); this.hub?.go('ov'); }
    }
    async paint() {
        const el = this.el; if (!el) return;
        const st = await this.status(), steps = guideSteps(st), n = steps.filter(s => s.done).length;
        if (el !== this.el) return;
        const btn = (act, label, primary = false, dis = false) => `<button type="button" class="zt-btn small${primary ? ' primary' : ''}" data-guide="${act}"${dis || this.busy ? ' disabled' : ''}>${esc(this.busy === act ? '处理中…' : label)}</button>`;
        const acts = {
            wb: s => s.done ? '' : !st.wb ? btn('wb-open', '打开世界书设置') : st.wb.exists ? btn('wb-update', '更新到最新版（先备份）', true) : btn('wb-install', st.chat.open ? '安装并绑定到当前聊天' : '安装世界书', true),
            api: s => s.done ? btn('api-open', '修改') : btn('api-main', '用酒馆当前的主模型', true) + btn('api-open', '填写独立 API ›'),
            chat: s => s.done ? '' : btn('chat-enable', '在当前聊天启用', true, !st.chat.open),
        };
        el.classList.add('zt-guide-page');
        el.innerHTML = `<div class="zt-eyebrow">FIRST RUN</div><h2 class="zt-h">新手引导</h2>
<p class="zt-sub">三步就能开始：世界书 → AI 接口 → 在当前聊天启用。每一步都可以跳过，以后在「设置 → 新手引导」还能再打开。已完成 ${n} / 3。</p>
<ol class="zt-guide-steps">${steps.map((s, i) => `<li class="zt-card zt-guide-step" data-step="${s.id}" data-done="${s.done ? 1 : 0}"><h3><span class="zt-guide-mark" aria-hidden="true">${s.done ? '✓' : i + 1}</span>${esc(s.title)}<small>${s.done ? '已完成' : '待完成'}</small></h3><p class="zt-sub">${esc(s.text)}</p><div class="zt-actions">${acts[s.id](s)}</div></li>`).join('')}</ol>
${this.note ? `<p class="zt-guide-note" role="status">${esc(this.note)}</p>` : ''}
<div class="zt-actions zt-guide-foot">${n === 3 ? btn('done', '完成', true) : btn('skip', '跳过引导') + btn('later', '先这样，以后再说')}</div>`;
        if (!el.__ztGuide) { el.__ztGuide = true; el.addEventListener('click', e => { const b = e.target.closest('[data-guide]'); if (b && !b.disabled) this.run(b.dataset.guide); }); }
    }
    async run(act) {
        const app = this.app, f = app.features;
        if (act === 'skip') return this.finish('skipped');
        if (act === 'later' || act === 'done') return this.finish(act === 'done' ? 'done' : 'skipped');
        if (act === 'api-open') { this.returning = true; return this.hub.go('api'); }
        if (act === 'wb-open') return f?.openWorldbook();
        this.busy = act; this.note = ''; await this.paint();
        try {
            if (act === 'wb-install') { const r = await f.installWorldbook(app.adapter.currentIdentity() ? 'chat' : 'none'); this.note = `世界书已安装（${r.count} 条）${r.chatBound ? '，已绑定到当前聊天' : ''}。`; }
            else if (act === 'wb-update') { const r = await f.updateWorldbook(); this.note = r.created ? `已安装最新版（${r.count} 条）。` : `已更新：替换 ${r.replaced} 条、新增 ${r.added} 条、保留你自己的 ${r.kept} 条；旧版备份为“${r.backup}”。`; }
            else if (act === 'api-main') { await saveConfigs(app.bridge, this.ns(), { url: MAIN_API_URL }); app.adapter.notify?.(); this.note = '已设置为使用酒馆当前的主模型（不会把请求发到别处）。'; }
            else if (act === 'chat-enable') this.note = await this.enableChat();
        } catch (e) { this.note = '未完成：' + errorLine(e); }
        finally { this.busy = ''; }
        await this.paint();
    }
    /** Step 3: ledger (original init rules) + 莉莉丝 memory through the original 「保存当前聊天设置」 button. */
    async enableChat() {
        const app = this.app, a = app.adapter;
        if (!a.currentIdentity()) throw Error('请先打开单角色聊天。');
        const out = [];
        if (!a.ledger()) { const r = await app.features.initChat(); out.push(r.created ? `账本已创建（系统点 ${r.points}）` : '账本已补齐'); try { app.hub?.reloadEngine?.(); } catch { /* ignore */ } }
        const sh = app.assistant?.shadow;
        if (sh && !this.memoryOn()) {
            const box = sh.getElementById('enabled'), save = sh.getElementById('save-chat'), auto = sh.getElementById('auto');
            if (!box || !save) throw Error('找不到莉莉丝「记忆」页的启用开关；请在 莉莉丝 → 记忆 里手动勾选并保存。');
            box.checked = true;
            // 自动整理 needs a model; without one the original save refuses — keep it off rather than fail.
            if (auto?.checked) { let model = ''; try { model = readConfigs(app.bridge, this.ns()).assistant?.model || ''; } catch { /* none */ } if (!model) auto.checked = false; }
            save.click();
            for (let i = 0; i < 30 && !this.memoryOn(); i++) await wait(100);
            if (!this.memoryOn()) throw Error(((sh.getElementById('status')?.textContent || '').trim() || '莉莉丝没有确认启用') + '（可在 莉莉丝 → 记忆 里手动勾选并保存）');
            out.push('莉莉丝记忆已启用');
        }
        return (out.join('，') || '当前聊天已经启用') + '。';
    }
    /** On the 连接 page during the wizard: a strip to come back after saving. */
    backStrip(page) {
        const sec = this.hub?.shadow?.getElementById('page-api');
        sec?.querySelector(':scope > .zt-guide-back')?.remove();
        if (page !== 'api' || !this.returning) { if (page !== 'api') this.returning = false; return; }
        const d = document.createElement('div'); d.className = 'zt-guide-back';
        d.innerHTML = '<span>新手引导 · 第 2 步：保存好 AI 接口后</span><button type="button" class="zt-btn small primary">‹ 回到新手引导</button>';
        d.querySelector('button').addEventListener('click', () => { this.returning = false; this.hub.go('guide'); });
        sec?.prepend(d);
    }
    dispose() { this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); this.nav?.remove(); }
}
