// 0.9.1 手机真机自检 — the 0.9.0 browser acceptance (tests/native_v090.py), runnable on the user's own phone.
// A small step card at the top of the screen walks through: environment → full screen → every terminal page measured
// → keyboard in the group chat → 私聊 full screen + keyboard → floating Lilith → landscape → back gesture. Steps that
// need the user (tap an input, rotate, press back) wait with a timeout and can be skipped; nothing is written to the
// ledger or the chat. The result is a short ✅ / ⚠ / ❌ list plus the raw numbers, stored in settings.deviceCheck
// (shown in 复制诊断信息) and copyable on the spot.
import { VERSION } from './contracts.js';
import { viewportBox } from './mobile.js';
import { environment, copyText, buildReport, redact } from './diag-report.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const TEXT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=button]):not([type=submit]):not([type=file]):not([type=color]),select,textarea';

/** One page of the terminal: things sticking out sideways, sideways scrolling, small tap targets, fields < 16 px. */
export function measurePage(hub) {
    const d = hub.shell.dialog, sr = hub.shadow, vw = innerWidth, out = { off: [], tap: [], zoom: [], hscroll: 0 };
    const vis = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; const s = getComputedStyle(el); return s.visibility === 'hidden' || +s.opacity === 0 ? null : r; };
    const nm = el => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + ':' + (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 12);
    const scroller = el => { for (let p = el.parentElement; p; p = p.parentElement) { if (p === d) return false; const s = getComputedStyle(p); if (/auto|scroll|hidden/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
    for (const el of d.querySelectorAll('*')) {
        const r = vis(el); if (!r) continue;
        if ((r.right > vw + 2 || r.left < -2) && !scroller(el) && !el.closest('[aria-hidden=true],.zt-world-deco')) out.off.push(nm(el));
        if (el.matches('#drag-handle button,.zt-hub-nav .nav-button,.zt-g-tabs button,.zt-g-send button') && (r.height < 36 || r.width < 36)) out.tap.push(`${nm(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
        if (el.matches(TEXT) && parseFloat(getComputedStyle(el).fontSize) < 16) out.zoom.push(nm(el));
    }
    const ps = sr.querySelector('.page-scroll'); out.hscroll = ps ? ps.scrollWidth - ps.clientWidth : 0;
    const f = hub.engineFrame;
    if (f?.offsetParent) {
        try { const doc = f.contentDocument; for (const el of doc.querySelectorAll(TEXT)) if (el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16) out.zoom.push('引擎 ' + nm(el)); out.engine = doc.documentElement.scrollWidth - doc.documentElement.clientWidth; } catch { /* cross-origin never happens; ignore */ }
    }
    for (const k of ['off', 'tap', 'zoom']) out[k] = [...new Set(out[k])].slice(0, 5);
    out.bad = !!(out.off.length || out.tap.length || out.zoom.length || out.hscroll > 1 || (out.engine || 0) > 1);
    return out;
}
/** Is a box the visible area? (±2 px; pure, for tests) */
export function fillsView(r, box) {
    return !!r && Math.abs(r.left - box.left) <= 2 && Math.abs(r.top - box.top) <= 2 && Math.abs(r.width - box.w) <= 2 && Math.abs(r.height - box.h) <= 2;
}
/** Text summary of the results (pure, for tests). */
export function summarize(results, env) {
    const n = k => results.filter(r => r.state === k).length;
    const head = `诸天 ${VERSION} 真机自检：✅ ${n('ok')} · ⚠ ${n('warn')} · ❌ ${n('fail')} · 跳过 ${n('skip')}`;
    const dev = env ? `设备：${env.ua}\n窗口 ${env.inner}，可见 ${env.visual}，像素比 ${env.dpr}，安全区 ${env.safe ? Object.values(env.safe).join('/') : '?'}` : '';
    return redact([head, dev, ...results.map(r => `${({ ok: '✅', warn: '⚠', fail: '❌', skip: '⏭' })[r.state] || '·'} ${r.title}：${r.text}${r.data ? '  ' + JSON.stringify(r.data) : ''}`)].filter(Boolean).join('\n'));
}

const CSS = `:host{all:initial}
.card{position:fixed;left:50%;top:calc(var(--t,0px) + 8px + env(safe-area-inset-top,0px));transform:translateX(-50%);width:min(440px,calc(100vw - 16px));box-sizing:border-box;z-index:2147483647;
 background:#17111e;color:#f1e8f8;border:1px solid #b48ad866;border-radius:14px;box-shadow:0 12px 40px #000c;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;padding:12px 14px}
.hd{display:flex;align-items:center;gap:8px;font-size:12px;color:#cdb6e6}.hd b{color:#f3d58a;font-weight:600}.hd span{margin-left:auto}
.bar{height:3px;background:#ffffff1a;border-radius:2px;margin:6px 0 8px;overflow:hidden}.bar i{display:block;height:100%;background:#c99be6;width:0;transition:width .3s}
.t{font-weight:600;font-size:15px;margin:0 0 4px}.p{margin:0;color:#e4d9ee;white-space:pre-wrap}.p.small{font-size:12px;color:#bfaed0;max-height:38vh;overflow:auto}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}button{all:unset;box-sizing:border-box;min-height:44px;padding:0 14px;border-radius:10px;background:#2a1f36;border:1px solid #b48ad855;color:#f1e8f8;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font:inherit}
button.main{background:#8a5fb5;border-color:#c99be6}button:focus-visible{outline:2px solid #f3d58a}
.res{margin:6px 0 0;padding:0;list-style:none;max-height:42vh;overflow:auto;font-size:13px}.res li{padding:3px 0;border-bottom:1px solid #ffffff12}
textarea{width:100%;box-sizing:border-box;height:120px;margin-top:8px;font:12px/1.4 ui-monospace,monospace;background:#0f0b14;color:#e4d9ee;border:1px solid #ffffff22;border-radius:8px;padding:6px}`;

export class DeviceCheck {
    constructor(app) { this.app = app; this.host = null; this.results = []; this.running = false; this.skipNow = null; this.disposers = []; }
    get hub() { return this.app.hub; }
    mount() {
        const host = document.createElement('div'); host.id = 'zhutian-device-check'; host.setAttribute('data-zt-keep-hub', '');
        const sh = host.attachShadow({ mode: 'open' });
        sh.innerHTML = `<style>${CSS}</style><div class="card" role="dialog" aria-live="polite" aria-label="手机真机自检"><div class="hd"><b>手机真机自检</b><span class="n"></span></div><div class="bar"><i></i></div><p class="t"></p><p class="p"></p><div class="extra"></div><div class="btns"></div></div>`;
        document.body.append(host); this.host = host; this.sh = sh;
        // stay at the top of what is visible (the keyboard pushes the visual viewport around)
        const follow = () => { const vv = globalThis.visualViewport; host.style.setProperty('--t', Math.round(vv?.offsetTop || 0) + 'px'); };
        globalThis.visualViewport?.addEventListener('resize', follow); globalThis.visualViewport?.addEventListener('scroll', follow);
        this.disposers.push(() => { globalThis.visualViewport?.removeEventListener('resize', follow); globalThis.visualViewport?.removeEventListener('scroll', follow); });
        follow();
    }
    show(step, total, title, text, buttons = [], extra = '') {
        const $ = s => this.sh.querySelector(s);
        $('.n').textContent = total ? `${step} / ${total}` : ''; $('.bar i').style.width = total ? Math.round(step / total * 100) + '%' : '100%';
        $('.t').textContent = title; $('.p').textContent = text; $('.extra').innerHTML = extra;
        const box = $('.btns'); box.innerHTML = '';
        for (const b of buttons) { const el = document.createElement('button'); el.type = 'button'; el.textContent = b.label; if (b.main) el.className = 'main'; el.addEventListener('click', b.fn); box.append(el); }
    }
    add(title, state, text, data) { this.results.push({ title, state, text, data }); }
    /** Waits until cond() is true (polled), the user taps 跳过, or the timeout. → 'ok' | 'skip' | 'timeout' */
    async until(cond, ms) {
        const end = Date.now() + ms; let skipped = false; this.skipNow = () => { skipped = true; };
        while (Date.now() < end) { if (skipped || this.stopped) return 'skip'; try { if (await cond()) return 'ok'; } catch { /* keep waiting */ } await wait(250); }
        return skipped ? 'skip' : 'timeout';
    }
    box() { return viewportBox(globalThis.visualViewport, innerWidth, innerHeight); }
    blur() { try { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; a?.blur?.(); } catch { /* ignore */ } }

    async run() {
        if (this.running) return; this.running = true; this.results = [];
        const app = this.app, hub = this.hub, skipBtn = { label: '跳过这一步', fn: () => this.skipNow?.() };
        const stopBtn = { label: '结束自检', fn: () => { this.stopped = true; this.skipNow?.(); } };
        this.stopped = false;
        if (!hub) { globalThis.toastr?.error('终端未启动，无法自检', '诸天'); this.running = false; return; }
        this.mount();
        const steps = ['环境', '全屏', '各页面', '聊天群 + 键盘', '私聊', '悬浮莉莉丝', '横屏', '返回键']; const N = steps.length; let i = 0;
        const step = (t, text, btns = [skipBtn]) => { if (this.stopped) throw new Error('已手动结束'); this.show(i, N, t, text, [...btns, stopBtn]); };
        try {
            // 1. environment
            i = 1; step('环境', '读取屏幕和浏览器信息…', []);
            this.env = environment(app);
            this.add('环境', this.env.coarse ? 'ok' : 'warn', this.env.coarse ? `触摸屏，窗口 ${this.env.inner}，可见 ${this.env.visual}` : `不是触摸屏（${this.env.inner}）— 这项自检是给手机用的`);
            // 2. full screen
            i = 2; step('全屏', '打开终端并测量…', []);
            if (hub.isOpen) hub.go('ov'); else if (app.openTerminal) app.openTerminal('ov'); else hub.open('ov');
            await wait(1400);
            { const d = hub.shell.dialog, r = d.getBoundingClientRect(), b = this.box(), ps = hub.shadow.querySelector('.page-scroll')?.getBoundingClientRect();
              const mode = app.mobile?.mode || '';
              if (!mode) this.add('全屏', 'warn', '当前不是全屏模式（设置为「浮动窗口」，或屏幕较宽）', { box: [r.left, r.top, r.width, r.height].map(Math.round) });
              else this.add('全屏', fillsView(r, b) ? 'ok' : 'fail', fillsView(r, b) ? `铺满可见区域（${mode === 'land' ? '横屏' : '竖屏'}），内容区 ${Math.round(ps?.height || 0)} px` : '终端没有铺满可见区域', { dialog: [r.left, r.top, r.width, r.height].map(Math.round), view: [b.left, b.top, b.w, b.h] }); }
            // 3. every page
            i = 3; const pages = [...new Set([...hub.shadow.querySelectorAll('.nav-button[data-page]')].map(b => b.dataset.page))], bad = {};
            let skipped = false;
            for (const [k, pg] of pages.entries()) {
                step('各页面', `逐页测量 ${k + 1} / ${pages.length}：${pg}`); this.skipNow = () => { skipped = true; };
                hub.go(pg); await wait(900); if (skipped || this.stopped) break;
                const m = measurePage(hub); if (m.bad) bad[pg] = m;
            }
            this.add('各页面', Object.keys(bad).length ? 'fail' : 'ok', Object.keys(bad).length ? `${Object.keys(bad).length} 页有问题：${Object.keys(bad).join('、')}` : `${pages.length} 页都没有超出屏幕、横向滚动、过小按钮或小字号输入框`, Object.keys(bad).length ? bad : undefined);
            // 4. keyboard in the group chat
            i = 4; hub.go('group'); await wait(900);
            { const ta = () => hub.shadow.querySelector('.zt-g-send textarea, .zt-g-send input');
              if (!ta()) this.add('聊天群 + 键盘', 'skip', '这台设备上聊天群输入框不可用');
              else {
                  step('聊天群 + 键盘', '请点一下聊天群底部的输入框，等键盘完全弹出（最多 25 秒）。\n不用打字。');
                  const h0 = innerHeight; let seen = 0;
                  const res = await this.until(() => { const st = app.mobile?.kbMode; if (st) seen = seen || Date.now(); return st && Date.now() - seen > 900; }, 25000);
                  if (res === 'skip') this.add('聊天群 + 键盘', 'skip', '已跳过');
                  else {
                      const b = this.box(), r = ta().getBoundingClientRect(), d = hub.shell.dialog.getBoundingClientRect(), top = hub.shadow.querySelector('.zt-hub-top');
                      const visible = r.top >= b.top - 1 && r.bottom <= b.top + b.h + 1 && r.height > 0;
                      const data = { kb: app.mobile?.kbMode || '无', view: b.h, inner: `${h0}→${innerHeight}`, dialog: Math.round(d.height), input: [Math.round(r.top), Math.round(r.bottom)], topBar: top ? getComputedStyle(top).display : '' };
                      if (res === 'timeout') this.add('聊天群 + 键盘', visible ? 'warn' : 'fail', visible ? '没有检测到键盘弹出（输入框仍可见）' : '没有检测到键盘，而且输入框不在可见区域', data);
                      else this.add('聊天群 + 键盘', visible && Math.abs(d.height - b.h) <= 2 ? 'ok' : 'fail', visible ? `键盘弹出后终端高 ${Math.round(d.height)} px，输入框可见` : '键盘挡住了输入框', data);
                  }
                  this.blur(); await wait(700);
              } }
            // 5. private chat
            i = 5; step('私聊', '打开私聊并测量…', []);
            { const s = app.assistant?.shadow, av = s && [s.getElementById('header-avatar'), s.getElementById('entry')].find(e => e && e.getBoundingClientRect().width);
              if (!av) this.add('私聊', 'skip', '找不到私聊入口');
              else {
                  av.click(); await wait(1300);
                  const p = s.getElementById('lc-panel'), r = p?.getBoundingClientRect(), b = this.box();
                  if (!p || p.hidden) this.add('私聊', 'fail', '私聊没有打开');
                  else {
                      this.add('私聊 · 全屏', !app.mobile?.mode ? 'warn' : fillsView(r, b) ? 'ok' : 'fail', !app.mobile?.mode ? '不是全屏模式' : fillsView(r, b) ? '私聊铺满可见区域' : '私聊没有铺满', { panel: [r.left, r.top, r.width, r.height].map(Math.round) });
                      const inp = s.getElementById('lc-input');
                      if (inp) {
                          step('私聊', '请点一下私聊底部的输入框，等键盘弹出（最多 25 秒）。'); let seen = 0;
                          const res = await this.until(() => { const st = app.mobile?.kbMode; if (st) seen = seen || Date.now(); return st && Date.now() - seen > 900; }, 25000);
                          if (res === 'skip') this.add('私聊 · 键盘', 'skip', '已跳过');
                          else { const ir = inp.getBoundingClientRect(), b2 = this.box(), ok = ir.top >= b2.top - 1 && ir.bottom <= b2.top + b2.h + 1;
                                 this.add('私聊 · 键盘', res === 'timeout' ? (ok ? 'warn' : 'fail') : ok ? 'ok' : 'fail', res === 'timeout' ? '没有检测到键盘' : ok ? '输入框在键盘上方' : '键盘挡住了私聊输入框', { input: [Math.round(ir.top), Math.round(ir.bottom)], view: b2.h }); }
                          this.blur(); await wait(600);
                      }
                      (s.getElementById('lc-back') || s.getElementById('lc-close'))?.click(); await wait(600);
                  }
              } }
            // 6. floating Lilith
            i = 6; step('悬浮莉莉丝', '测量位置…', []);
            if (!app.float?.active) this.add('悬浮莉莉丝', 'skip', '悬浮莉莉丝未开启');
            else { if (!hub.isOpen) hub.open('ov'); await wait(700); const r = app.float.fig.getBoundingClientRect(), vh = innerHeight;
                   this.add('悬浮莉莉丝', !app.mobile?.mode || r.top > vh - r.height - 140 ? 'ok' : 'warn', r.top > vh - r.height - 140 ? '终端打开时停在下角' : '终端打开时不在下角', { top: Math.round(r.top), left: Math.round(r.left), h: Math.round(r.height) }); }
            // 7. landscape
            i = 7; hub.go('ov');
            step('横屏', '请把手机横过来（需要开着自动旋转；不想测可以跳过，最多 30 秒）。');
            { const res = await this.until(() => innerWidth > innerHeight && app.mobile?.mode === 'land', 30000);
              if (res !== 'ok') this.add('横屏', 'skip', res === 'skip' ? '已跳过' : '30 秒内没有检测到横屏');
              else { await wait(900); const nav = hub.shell.nav.getBoundingClientRect(), ps = hub.shadow.querySelector('.page-scroll').getBoundingClientRect(), d = hub.shell.dialog.getBoundingClientRect(), b = this.box();
                     this.add('横屏', fillsView(d, b) && nav.width < 110 && ps.height >= 180 ? 'ok' : 'fail', `左侧导航 ${Math.round(nav.width)} px，内容区 ${Math.round(ps.height)} px`, { dialog: [d.width, d.height].map(Math.round), view: [b.w, b.h] });
                     step('横屏', '好了，请转回竖屏。'); await this.until(() => innerHeight > innerWidth, 30000); await wait(700); } }
            // 8. back gesture
            i = 8;
            if (app.settings.get('hubBackClose') === false) this.add('返回键', 'skip', '设置里关闭了「手机返回手势关闭终端」');
            else {
                if (!hub.isOpen) { hub.open('ov'); await wait(900); }
                const href = location.href;
                step('返回键', '最后一步：请按一下手机的返回键（或从屏幕边缘侧滑返回）。终端应该关闭，酒馆页面不变。');
                const res = await this.until(() => !hub.isOpen, 20000); await wait(500);
                if (res === 'skip') this.add('返回键', 'skip', '已跳过');
                else this.add('返回键', res === 'ok' && location.href.split('#')[0] === href.split('#')[0] ? 'ok' : 'fail', res === 'ok' ? '返回键关闭了终端，酒馆页面还在' : '20 秒内终端没有关闭');
            }
        } catch (e) {
            this.add('自检中断', this.stopped ? 'skip' : 'fail', e.message);
        }
        this.finish();
    }
    finish() {
        const text = summarize(this.results, this.env);
        try { this.app.settings.set('deviceCheck', { at: new Date().toISOString(), version: VERSION, text: text.slice(0, 8000) }); } catch { /* ignore */ }
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        const list = `<ul class="res">${this.results.map(r => `<li>${({ ok: '✅', warn: '⚠', fail: '❌', skip: '⏭' })[r.state]} <b>${esc(r.title)}</b>：${esc(r.text)}</li>`).join('')}</ul><textarea readonly aria-label="自检结果">${esc(text)}</textarea>`;
        const copy = async (t, what) => { const ok = await copyText(t); globalThis.toastr?.[ok ? 'success' : 'warning'](ok ? `已复制${what}，可以直接粘贴发送` : '浏览器不允许自动复制：请长按下面的文字框全选复制', '诸天'); if (!ok) this.sh.querySelector('textarea')?.select(); };
        this.show(0, 0, '自检完成', text.split('\n')[0], [
            { label: '复制结果', main: true, fn: () => copy(text, '自检结果') },
            { label: '复制完整诊断信息', fn: () => copy(buildReport(this.app), '诊断信息') },
            { label: '关闭', fn: () => this.close() },
        ], list);
        this.running = false;
    }
    close() { this.skipNow?.(); this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); this.host?.remove(); this.host = null; this.running = false; }
    dispose() { this.close(); }
}
