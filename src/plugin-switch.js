// 1.0 · 一键关闭插件 + a shared confirm box (SillyTavern's own popup, falling back to the browser confirm).
//
// 关闭 = exactly what 酒馆「扩展 → 管理扩展」 does: the extension's folder name goes into disabledExtensions, the
// settings are saved and the page reloads. On 1.17+ SillyTavern calls our `disable` hook first (自动解绑世界书).
// Re-enable: 酒馆顶栏「扩展」→「管理扩展」→ 诸天契约终端 打开开关（页面刷新后生效）.
const REOPEN = '重新开启：酒馆顶栏「扩展」（积木图标）→「管理扩展」→ 找到「诸天契约终端」打开开关，页面刷新后生效。';
export const REENABLE_HINT = REOPEN;

/** The name SillyTavern files this extension under: the path after /scripts/extensions/ (pure). */
export function pluginName(moduleUrl) {
    let path = '';
    try { path = new URL(moduleUrl).pathname; } catch { path = String(moduleUrl || ''); }
    path = decodeURIComponent(path);
    const m = path.match(/\/scripts\/extensions\/(.+?)\/(?:src\/[^/]+|index)\.js$/);
    return m ? m[1] : '';
}
/** Confirm with SillyTavern's popup (keeps the page styled; works inside the terminal dialog). Resolves true / false. */
export async function confirmBox(text, { ok = '确定', cancel = '取消', title = '' } = {}) {
    const c = globalThis.SillyTavern?.getContext?.();
    if (typeof c?.callGenericPopup === 'function' && c.POPUP_TYPE?.CONFIRM !== undefined) {
        try {
            const el = document.createElement('div'); el.style.textAlign = 'left';
            el.innerHTML = (title ? `<h3 style="margin:0 0 8px">${esc(title)}</h3>` : '') + String(text).split('\n').map(l => `<div>${esc(l) || '&nbsp;'}</div>`).join('');
            const r = await c.callGenericPopup(el, c.POPUP_TYPE.CONFIRM, '', { okButton: ok, cancelButton: cancel });
            return r === (c.POPUP_RESULT?.AFFIRMATIVE ?? 1) || r === true;
        } catch (e) { console.warn('[诸天] 酒馆弹窗不可用，改用浏览器确认框', e); }
    }
    return !!globalThis.confirm?.((title ? title + '\n\n' : '') + text);
}
/** SillyTavern's public/scripts/extensions.js, found from where this file is served (pure). */
export function hostModule(moduleUrl) { const u = String(moduleUrl), i = u.indexOf('/scripts/extensions/'); return i < 0 ? '' : u.slice(0, i) + '/scripts/extensions.js'; }
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/**
 * 设置 → 插件开关 → 一键关闭插件. Asks first. Uses SillyTavern's own disableExtension (1.16+); when that is not
 * reachable, says exactly where the switch is. `opts.load` / `opts.reload` are for tests.
 */
export async function disablePlugin(app, { moduleUrl = import.meta.url, load, reload = true, ask = confirmBox } = {}) {
    const t = globalThis.toastr, name = pluginName(moduleUrl);
    const yes = await ask(`关闭后终端、悬浮莉莉丝、状态栏和聊天群都会停用，页面会刷新一次。\n账本、存档和设置都保留，不会删除。${app?.settings?.get?.('wbUnbindOnDisable') === false ? '' : '\n诸天世界书会自动从角色卡上解绑（酒馆 1.17+；可在世界书窗口里恢复绑定）。'}\n\n${REOPEN}`, { ok: '关闭插件', cancel: '取消', title: '一键关闭诸天插件？' });
    if (!yes) return { done: false, cancelled: true };
    let mod = null;
    try { mod = load ? await load() : await import(hostModule(moduleUrl)); } catch (e) { console.warn('[诸天] 无法载入酒馆扩展模块', e); }
    if (!name || typeof mod?.disableExtension !== 'function') {
        const why = '这个酒馆版本没有开放关闭接口，请手动关闭：酒馆顶栏「扩展」→「管理扩展」→ 关掉「诸天契约终端」的开关，然后刷新页面。';
        t?.warning(why, '诸天 · 关闭插件', { timeOut: 15000 });
        return { done: false, manual: true, reason: why };
    }
    try { app?.hub?.close?.(); } catch { /* closing the window is cosmetic */ }
    t?.info('正在关闭诸天插件，页面即将刷新…', '诸天', { timeOut: 4000 });
    await mod.disableExtension(name, reload);
    return { done: true, name };
}
