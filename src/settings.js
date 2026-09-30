// Extension-level settings (extension_settings[ID]) plus the native SillyTavern settings drawer.
// Nothing here is chat data; API keys entered in the Lilith connection page live in scriptVariables, which stay
// in the user's local settings.json and are never part of this repository.
import { ID, VERSION } from './contracts.js';
import { HOST_TESTED } from './compat.js';

export const LIVE2D_CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const DEFAULTS = Object.freeze({
    schema: 1,
    assistant: true,             // original Lilith window, memory, workbench, private chat (native bridge)
    statusbar: 'auto',           // auto | native | off
    statusbarMaxDepth: 1,        // original regex maxDepth 1: floors at depth 0..1 get the live bar, older ones the compact card
    compactHistory: true,        // original "旧楼层精简显示": 系统点 · 好感 · 任务 one-liner (click to expand)
    voiceBox: true,              // original "莉莉丝专属语音框" regex, switchable
    promptStripPanels: true,     // original "旧楼层不发给AI": status blocks of older floors are removed from the prompt
    promptPanelKeepDepth: 2,     // original minDepth 2: the two newest floors keep their panel in the prompt
    worldbookAuto: true,         // install + bind the 诸天 worldbook on 诸天 chats (never overwrites, skips if already active)
    macroLike: true,             // {{get_chat_variable::…}} for the worldbook without Tavern Helper
    touchGestures: true,         // stroke / long-press / touch look on the Lilith portrait
    haptics: true,               // vibration feedback for touch gestures (phones that support it)
    takeoverLog: [],             // legacy v1.1 items switched off by 一键接管 (for 恢复旧版)
    terminalLauncher: false,     // the 0.2.0 terminal keeps its own launcher only on request (one Lilith on screen)
    hud: true,                   // compact ledger HUD above the input bar
    hotkeys: true,               // Alt+Z Lilith, Alt+X terminal, Alt+S latest status bar
    portrait: { mode: 'rig', variant: 'default', autoMood: true },   // rig | variants | live2d
    live2d: { accepted: false, coreUrl: LIVE2D_CORE_URL, model: '', scale: 1, x: 0, y: 0, follow: true, lipsync: true, idle: true, moodMap: {} },
    scriptVariables: {},
    legacyImported: false,
});
const merge = (base, over) => {
    const out = structuredClone(base);
    for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? merge(out[k], v) : v;
    return out;
};
/** Adds missing keys (recursively for plain objects) without replacing anything the user already has. */
export function fillDefaults(target, defaults) {
    for (const [k, v] of Object.entries(defaults)) {
        if (!(k in target) || target[k] === undefined) target[k] = structuredClone(v);
        else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) fillDefaults(target[k], v);
    }
    return target;
}

export class Settings {
    constructor(adapter) { this.adapter = adapter; this.listeners = new Set(); this.drawer = null; }
    ctx() { return this.adapter.context(); }
    /** The stored object keeps its identity: defaults are filled in place, never by swapping in a clone
     *  (a swap on every read made `all[key] = f(all[key])` write into an already-discarded object). */
    get all() {
        const store = this.ctx().extensionSettings;
        if (!store[ID] || typeof store[ID] !== 'object') store[ID] = {};
        fillDefaults(store[ID], DEFAULTS);
        return store[ID];
    }
    get(key) { return this.all[key]; }
    set(key, value) { const all = this.all; all[key] = value; this.save(); this.emit(key); }
    patch(key, part) { const all = this.all; all[key] = merge(all[key] || {}, part); this.save(); this.emit(key); }
    save() { this.ctx().saveSettingsDebounced(); }
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(key) { for (const fn of this.listeners) try { fn(key); } catch (e) { console.warn('[诸天设置]', e); } }
    scriptVariables() { const v = this.all.scriptVariables; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    setScriptVariables(v) { this.all.scriptVariables = v; this.save(); }

    /** Native settings drawer in the Extensions panel (works on 1.16–1.19: plain inline-drawer markup). */
    mountDrawer(actions) {
        const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!target || this.drawer) return;
        const s = this.all, wrap = document.createElement('div');
        wrap.id = ID + '-settings'; wrap.className = 'zt-settings';
        wrap.innerHTML = `
<div class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header"><b>诸天 · 莉莉丝契约终端 <small>${VERSION}</small></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
  <div class="inline-drawer-content">
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="assistant"> 莉莉丝助手（原版窗口、记忆、工作台、私聊）</label></div>
    <div class="zt-set-row"><label>原生状态栏
      <select data-k="statusbar" class="text_pole"><option value="auto">自动（旧正则 + 酒馆助手仍启用时让位）</option><option value="native">强制原生渲染</option><option value="off">关闭</option></select></label></div>
    <div class="zt-set-row"><label>完整状态栏显示到第几层（0=仅最新楼）<input type="number" min="0" max="6" data-k="statusbarMaxDepth" class="text_pole" style="width:5em"></label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="compactHistory"> 旧楼层精简显示（系统点 · 好感 · 任务，一键展开）</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="voiceBox"> 莉莉丝专属语音框（语音美化）</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="promptStripPanels"> 旧楼层状态栏不发给 AI（省 token）</label> <label>保留最新 <input type="number" min="0" max="6" data-k="promptPanelKeepDepth" class="text_pole" style="width:4em"> 层</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="worldbookAuto"> 诸天存档自动安装并绑定世界书（不覆盖已改过的条目）</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="macroLike"> 世界书变量宏 {{get_chat_variable::…}}（酒馆助手已开启时自动让位）</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="touchGestures"> 莉莉丝真实触摸互动（抚摸 / 长按 / 视线跟随手指）</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="haptics"> 触摸震动反馈（手机）</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="terminalLauncher"> 契约终端独立入口按钮</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="hud"> 输入框上方账本速览（系统点 / 任务）</label></div>
    <div class="zt-set-row"><label class="checkbox_label"><input type="checkbox" data-k="hotkeys"> 快捷键 Alt+Z 莉莉丝 · Alt+X 终端 · Alt+S 最新状态栏</label></div>
    <div class="zt-set-row"><label>立绘模式
      <select data-k="portrait.mode" class="text_pole"><option value="rig">原版分层参数动画</option><option value="variants">AI 差分立绘（表情随语气切换）</option><option value="live2d">真 Live2D（Cubism 模型）</option></select></label></div>
    <div class="zt-set-actions">
      <div class="menu_button" data-act="open">打开莉莉丝</div><div class="menu_button" data-act="terminal">契约终端</div>
      <div class="menu_button" data-act="live2d">Live2D 设置</div><div class="menu_button" data-act="worldbook">世界书安装/绑定</div>
      <div class="menu_button" data-act="init">新聊天初始化</div><div class="menu_button" data-act="migrate">旧存档迁移/回滚</div>
      <div class="menu_button" data-act="api">API 中心</div><div class="menu_button" data-act="diagnose">兼容诊断</div>
      <div class="menu_button" data-act="takeover">一键接管旧版</div><div class="menu_button" data-act="restore">恢复旧版</div>
    </div>
    <small class="zt-set-note">已验收宿主：SillyTavern ${HOST_TESTED.join(' / ')}。无需酒馆助手、无需导入正则：世界书、状态栏、语音框、旧楼层处理、莉莉丝助手全部由本插件提供。</small>
  </div>
</div>`;
        const read = key => key.split('.').reduce((o, k) => o?.[k], s);
        for (const input of wrap.querySelectorAll('[data-k]')) {
            const key = input.dataset.k, v = read(key);
            if (input.type === 'checkbox') input.checked = !!v; else input.value = String(v);
            input.addEventListener('change', () => {
                const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Math.max(Number(input.min) || 0, Math.min(Number(input.max) || 6, Math.floor(Number(input.value)) || 0)) : input.value;
                const [head, tail] = key.split('.');
                if (tail) this.patch(head, { [tail]: value }); else this.set(head, value);
            });
        }
        wrap.querySelector('.zt-set-actions').addEventListener('click', e => { const act = e.target.closest('[data-act]')?.dataset.act; if (act) actions[act]?.(); });
        target.append(wrap); this.drawer = wrap;
    }
    dispose() { this.drawer?.remove(); this.drawer = null; this.listeners.clear(); }
}
