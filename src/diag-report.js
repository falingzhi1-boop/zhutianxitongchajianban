// 0.9.1 复制诊断信息 — one block of plain text a user can paste into a bug report.
// What goes in: plugin / SillyTavern / browser versions, screen and phone-layout numbers, plugin settings (allow-list
// below), which host interfaces work, the status-bar / latest-floor state, the AI endpoint HOST + model name, the last
// 真机自检 result and the last plugin errors. What never goes in: API keys, script variables, chat text, ledger values,
// character names. Everything passes redact() once more before it leaves (belt and braces for error messages).
import { VERSION } from './contracts.js';
import { phoneLayout, viewportBox } from './mobile.js';
import { ROUTES, readRoutes, routeText, routeLabel } from './api-routes.js';

/** Masks anything that looks like a secret (pure, for tests). */
export function redact(text) {
    return String(text ?? '')
        .replace(/\b(sk|rk|pk|ak)-[A-Za-z0-9_\-]{8,}/g, '$1-***')
        .replace(/\bAIza[0-9A-Za-z_\-]{20,}/g, 'AIza***')
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=\-]{8,}/gi, '$1 ***')
        .replace(/((?:api[_-]?key|key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&}]{4,}/gi, '$1***')
        .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1***@')
        .replace(/(https?:\/\/[^\s?#"']+)\?[^\s#"']*/gi, '$1?***')
        .replace(/\b[A-Za-z0-9_\-]{40,}\b/g, m => (/^[a-f0-9]{40,64}$/i.test(m) ? m : m.slice(0, 4) + '***'));
}

const SKIP = new Set(['scriptVariables', 'takeoverLog', 'wbUnbound', 'floatPos', 'live2d', 'deviceCheck', 'hubPage']);
/** Plugin settings safe to share (pure, for tests): no script variables (API keys live there), lists become counts. */
export function settingsSnapshot(all = {}) {
    const out = {};
    for (const [k, v] of Object.entries(all || {})) {
        if (SKIP.has(k)) continue;
        if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
        else if (Array.isArray(v)) out[k] = `[${v.length} 项]`;
        else if (typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v).filter(([, x]) => x === null || ['string', 'number', 'boolean'].includes(typeof x)));
    }
    out.takeoverLog = `[${(all?.takeoverLog || []).length} 项]`;
    out.live2d = all?.live2d ? { accepted: !!all.live2d.accepted, model: all.live2d.model ? '已设置' : '' } : null;
    out.wbUnbound = !!all?.wbUnbound;
    return out;
}
/** "host · model" for an endpoint config — never the key or the path (pure, for tests). */
export function endpointText(c) {
    if (!c?.url) return '未设置';
    if (c.key === 'st-main' || /^st-main|酒馆主/.test(String(c.url))) return '酒馆主 API';
    try { return new URL(c.url).host + (c.model ? ' · ' + c.model : ''); } catch { return '地址无法解析'; }
}

/** Last plugin errors: console.error / console.warn lines tagged [诸天…] and page errors from the plugin's files. */
export class ErrorLog {
    constructor(base = '', max = 30) { this.base = base; this.max = max; this.items = []; this.disposers = []; }
    push(kind, args) {
        const text = args.map(a => (a instanceof Error ? `${a.message}${a.stack ? ' @ ' + String(a.stack).split('\n').slice(1, 3).map(s => s.trim()).join(' | ') : ''}` : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
        this.items.push({ t: new Date().toISOString().slice(11, 19), kind, text: redact(text).slice(0, 400) });
        if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
    }
    start() {
        for (const kind of ['error', 'warn']) {
            const orig = console[kind], self = this;
            const wrapped = function (...args) { try { if (typeof args[0] === 'string' && /^\[诸天/.test(args[0])) self.push(kind, args); } catch { /* never break logging */ } return orig.apply(this, args); };
            console[kind] = wrapped;
            this.disposers.push(() => { if (console[kind] === wrapped) console[kind] = orig; });
        }
        const ours = s => !!s && (String(s).includes(this.base || '\u0000') || /zhutian/i.test(String(s)));
        const onErr = e => { if (ours(e.filename) || ours(e.error?.stack)) this.push('page', [e.error || e.message]); };
        const onRej = e => { if (ours(e.reason?.stack)) this.push('promise', [e.reason]); };
        addEventListener('error', onErr); addEventListener('unhandledrejection', onRej);
        this.disposers.push(() => { removeEventListener('error', onErr); removeEventListener('unhandledrejection', onRej); });
        return this;
    }
    dispose() { this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); }
}

/** Safe-area insets as the browser applies them (a probe element with env() padding). */
export function safeArea() {
    try {
        const p = document.createElement('div');
        p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
        document.body.append(p); const s = getComputedStyle(p);
        const r = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(v => Math.round(parseFloat(v) || 0)); p.remove();
        return { top: r[0], right: r[1], bottom: r[2], left: r[3] };
    } catch { return null; }
}
/** Screen / browser numbers that matter for the phone layout. */
export function environment(app) {
    let coarse = false; try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
    const vv = globalThis.visualViewport, box = viewportBox(vv, innerWidth, innerHeight);
    let standalone = false; try { standalone = matchMedia('(display-mode: standalone)').matches; } catch { /* ignore */ }
    return {
        ua: navigator.userAgent, lang: navigator.language, secure: !!globalThis.isSecureContext, standalone,
        inner: `${innerWidth}×${innerHeight}`, screen: `${screen?.width}×${screen?.height}`, dpr: devicePixelRatio, coarse,
        visual: vv ? `${box.w}×${box.h} @${box.top},${box.left} (键盘 ${box.kb}px)` : '不支持 visualViewport',
        safe: safeArea(), layout: phoneLayout(app?.settings?.get('mobileLayout') || 'auto', { w: innerWidth, h: innerHeight, coarse }) || '浮动窗口',
        current: app?.mobile?.mode || '', kbMode: app?.mobile?.kbMode || '',
    };
}

const line = (k, v) => `${k}：${v}`;
/** The whole report as text. Every source is optional; a broken part is reported, never thrown. */
export function buildReport(app, { errors = app?.errorLog?.items || [] } = {}) {
    const out = [`【诸天终端诊断信息】${new Date().toISOString()}`];
    const safe = (title, fn) => { try { const r = fn(); if (r !== undefined && r !== null && r !== '') out.push(...(Array.isArray(r) ? r : [r])); } catch (e) { out.push(`${title}：读取失败（${e.message}）`); } };
    safe('版本', () => [line('插件', VERSION), line('SillyTavern', `${app.adapter?.version || '?'} — ${app.adapter?.support?.reason || ''}`)]);
    safe('设备', () => { const e = environment(app); return ['', '— 设备 —', line('浏览器', e.ua), line('语言', e.lang), line('窗口', `${e.inner}（屏幕 ${e.screen}，像素比 ${e.dpr}）`), line('可见区域', e.visual),
        line('触摸屏', e.coarse ? '是' : '否'), line('安全区', e.safe ? `上 ${e.safe.top} 右 ${e.safe.right} 下 ${e.safe.bottom} 左 ${e.safe.left}` : '未知'), line('HTTPS', e.secure ? '是' : '否（剪贴板等功能受限）'),
        line('添加到主屏幕运行', e.standalone ? '是' : '否'), line('手机布局', `${e.layout}${e.current ? '（当前 ' + e.current + '）' : ''}${e.kbMode ? '，键盘方式 ' + e.kbMode : ''}`)]; });
    safe('接口', () => ['', '— 宿主接口 —', ...(app.adapter?.capabilities || []).map(c => `${c.ok ? '✅' : '❌'} ${c.label}`)]);
    safe('状态栏', () => { const sb = app.statusbar?.state || {}, d = app.statusbar?.diagnoseLast?.(); return ['', '— 运行状态 —', line('状态栏', `${sb.mode || '?'} — ${sb.reason || ''}`), d ? line('最新楼层', `${d.ok === true ? '✅' : d.ok === false ? '⚠' : 'ℹ'} ${d.text}`) : line('最新楼层', '无'),
        line('终端', app.hub ? (app.hub.isOpen ? `打开（${app.hub.page || ''}）` : '已启动') : `未启动 ${app.hubError || ''}`), line('莉莉丝助手', app.assistant ? '运行中' : `未启用 ${app.assistantError || ''}`), line('悬浮莉莉丝', app.float?.active ? '开启' : '关闭')]; });
    safe('动态效果', () => line('动态效果', app.perf ? `${app.perf.lite ? '精简' : '完整'}（${app.perf.reason}）` : '未启动'));
    safe('API', () => { const c = app.features?.apiConfigs?.() || {}; return [line('AI 接口 · 状态栏', endpointText(c.status)), line('AI 接口 · 莉莉丝', endpointText(c.assistant))]; });
    safe('分功能 API', () => { if (!app.bridge) return ''; const r = readRoutes(app.bridge), on = ROUTES.filter(x => r.routes[x.id]); const last = app.bridge.lastRoute; return [line('接口预设', `${r.presets.length} 个`), line('分功能 API', on.length ? on.map(x => `${x.label} → ${routeText(r, x.id)}`).join('；') : '全部跟随默认'), ...(last ? [line('最近一次分功能请求', `${routeLabel(last.id)} · ${last.via}`)] : [])]; });
    safe('设置', () => ['', '— 插件设置 —', JSON.stringify(settingsSnapshot(app.settings?.all))]);
    safe('自检', () => { const d = app.settings?.get('deviceCheck'); return d?.text ? ['', `— 上次真机自检（${d.at || ''}）—`, d.text] : ['', '— 真机自检 —', '没有运行过（设置 → 兼容与维护 → 手机真机自检）']; });
    out.push('', `— 最近的插件报错（${errors.length} 条）—`, ...(errors.length ? errors.map(e => `[${e.t}] ${e.kind}: ${e.text}`) : ['无']));
    return redact(out.join('\n'));
}

/** Clipboard with the fallbacks phones need (ST on a LAN address is not a secure context → no navigator.clipboard). */
export async function copyText(text) {
    try { if (globalThis.isSecureContext && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall back */ }
    try {
        const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px';
        document.body.append(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy'); ta.remove(); return !!ok;
    } catch { return false; }
}
