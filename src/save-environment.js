// Saving needs a secure context and Web Locks. HTTP loopback may be secure; HTTPS alone is not a capability check.
// Never include host settings, credentials, chat text or full URLs in these diagnostic events.
export function saveEnvironment() {
    const secure = typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : null;
    const protocol = String(globalThis.location?.protocol || '').replace(/:$/, '') || '未知';
    const locks = typeof globalThis.navigator?.locks?.request === 'function';
    const canSave = secure === null ? null : secure && locks;
    const port = /^\d{1,5}$/.test(globalThis.location?.port || '') ? ':' + globalThis.location.port : '';
    let reason = '';
    if (secure === false) reason = `当前环境无法保存：页面不是安全上下文，不能安全使用 Web Locks。本机运行酒馆时，请在同一台电脑打开 http://localhost${port} 或 http://127.0.0.1${port}；手机访问电脑时，localhost 指的是手机自己，请为酒馆配置浏览器信任的 HTTPS 地址后访问。更换访问源前请先备份，不要清空浏览器数据。`;
    else if (secure === true && !locks) reason = '当前环境无法保存：页面处于安全上下文，但 Web Locks 不可用。请用支持 Web Locks 的较新 Chrome / Edge / Firefox / Safari 浏览器直接打开酒馆，退出受限内嵌 WebView；HTTPS 不能代替浏览器能力。';
    return { secure, protocol, locks, canSave, reason };
}
const recorded = new WeakSet();
export function recordSaveFailure(error, scope = '保存') {
    if (error && typeof error === 'object') { if (recorded.has(error)) return; recorded.add(error); }
    const detail = error?.code === 'ZT_SAVE_UNAVAILABLE' ? error.message : '保存失败；请查看页面提示并重载核对。诊断不记录设置内容或密钥。';
    console.warn('[诸天保存]', scope + '：' + detail);
}
export function assertSaveEnvironment({ requireLocks = false } = {}) {
    const state = saveEnvironment();
    if (state.canSave === false || (requireLocks && !state.locks)) {
        const error = Error(state.reason || '当前环境无法保存：Web Locks 不可用，请使用安全上下文及支持 Web Locks 的浏览器。');
        error.code = 'ZT_SAVE_UNAVAILABLE'; recordSaveFailure(error, '环境预检'); throw error;
    }
    return state;
}
