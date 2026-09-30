// Host compatibility layer for SillyTavern 1.16.0 – 1.19.x.
// Every difference below was checked against the tagged sources (1.16.0, 1.17.0, 1.18.0, 1.19.0):
//  - manifest `hooks` (activate/disable/…) only exist from 1.17.0; 1.16.0 merely injects the module script.
//  - public/script.js exports sendMessageAsUser / is_send_press / generateRaw / addOneMessage in all four tags.
//  - getContext(): every member the extension uses exists in 1.16.0; later tags only add members.
//  - /api/chats/get and /api/chats/save keep the same body ({avatar_url,file_name,chat,force}); 1.19 adds path checks only.
//  - setExtensionPrompt(key,value,position,depth,scan,role,filter) has the same signature in all four tags.
export const HOST_MIN = '1.16.0';
export const HOST_TESTED = Object.freeze(['1.16.0', '1.17.0', '1.18.0', '1.19.0']);
export const HOOKS_SINCE = '1.17.0';

export function parseVersion(value) {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function compareVersion(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    if (!x || !y) return NaN;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
}
/** Support decision for a host version string. `tested` means verified on a real isolated host of that minor line. */
export function hostSupport(version) {
    const v = parseVersion(version);
    if (!v) return { ok: false, tested: false, level: 'unknown', reason: `无法识别酒馆版本（${version || '空'}），已阻止写入。` };
    if (compareVersion(version, HOST_MIN) < 0) return { ok: false, tested: false, level: 'too-old', reason: `当前 SillyTavern ${version} 低于最低支持版本 ${HOST_MIN}。请升级酒馆。` };
    const line = `${v[0]}.${v[1]}.`;
    if (HOST_TESTED.some(t => t.startsWith(line))) return { ok: true, tested: HOST_TESTED.includes(version), level: 'supported', reason: HOST_TESTED.includes(version) ? `SillyTavern ${version}：已在隔离真实宿主验收。` : `SillyTavern ${version}：与已验收的 ${line}0 属同一版本线，按能力探测运行。` };
    return { ok: true, tested: false, level: 'newer', reason: `SillyTavern ${version} 新于已验收范围（${HOST_TESTED[0]}–${HOST_TESTED.at(-1)}）；按接口能力探测运行，缺失接口的功能会自动停用。` };
}
export function hooksSupported(version) { return compareVersion(version, HOOKS_SINCE) >= 0; }

let hostModulePromise = null;
/**
 * Dynamic import instead of a static `import {…} from '/script.js'`: a missing named export in a static import
 * throws a SyntaxError at link time and silently kills the whole extension on hosts that renamed it.
 */
export function loadHostModule() {
    hostModulePromise ??= import('/script.js').then(ns => ns, error => { console.warn('[诸天终端] /script.js 动态导入失败，改用 getContext 能力', error); return {}; });
    return hostModulePromise.then(ns => {
        const context = () => globalThis.SillyTavern?.getContext?.();
        return {
            namespace: ns,
            sendMessageAsUser: typeof ns.sendMessageAsUser === 'function' ? ns.sendMessageAsUser : null,
            // Live binding read on every call; fallback inspects the host's own send-button state.
            isSendPress: () => {
                if ('is_send_press' in ns) return !!ns.is_send_press;
                const button = document.getElementById('send_but');
                return !!button && getComputedStyle(button).display === 'none' && !!document.getElementById('mes_stop') && getComputedStyle(document.getElementById('mes_stop')).display !== 'none';
            },
            generateRaw: typeof ns.generateRaw === 'function' ? ns.generateRaw : (context()?.generateRaw || null),
            saveSettings: typeof ns.saveSettings === 'function' ? ns.saveSettings : null,   // immediate save (takeover before reload)
            context,
        };
    });
}

export async function fetchHostVersion() {
    const r = await fetch('/version', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error('版本接口返回错误');
    const v = await r.json();
    return { pkgVersion: String(v.pkgVersion || ''), gitRevision: v.gitRevision || '', gitBranch: v.gitBranch || '', agent: v.agent || '' };
}

/** Capability probe: never assumes a member exists because the version number says so. */
export function probeCapabilities(c, host = {}) {
    const has = key => typeof c?.[key] === 'function';
    const rows = [
        ['eventSource', !!c?.eventSource?.on, '事件总线'],
        ['eventTypes', !!c?.eventTypes?.APP_READY, '事件类型'],
        ['saveChat', has('saveChat'), '保存聊天'],
        ['saveMetadata', has('saveMetadata'), '保存聊天元数据（变量）'],
        ['setExtensionPrompt', has('setExtensionPrompt'), '提示注入'],
        ['addOneMessage', has('addOneMessage'), '系统记录渲染'],
        ['messageFormatting', has('messageFormatting'), '正文重排（原生状态栏）'],
        ['saveSettingsDebounced', has('saveSettingsDebounced'), '扩展设置保存'],
        ['loadWorldInfo', has('loadWorldInfo') && has('saveWorldInfo'), '世界书读写'],
        ['registerSlashCommand', has('registerSlashCommand'), '斜杠命令'],
        ['registerMacro', has('registerMacro'), '宏'],
        ['sendMessageAsUser', typeof host.sendMessageAsUser === 'function', '以玩家身份发送'],
        ['generateRaw', typeof host.generateRaw === 'function', '主 API 原始生成'],
        ['webLocks', !!globalThis.navigator?.locks, '浏览器 Web Locks'],
    ];
    return rows.map(([key, ok, label]) => ({ key, ok: !!ok, label }));
}
