// Extension-level settings (extension_settings[ID]) plus the native SillyTavern settings drawer.
// Nothing here is chat data; API keys entered in the Lilith connection page live in scriptVariables, which stay
// in the user's local settings.json and are never part of this repository.
import { ID, VERSION } from './contracts.js';
import { HOST_TESTED } from './compat.js';

export const LIVE2D_CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const DEFAULTS = Object.freeze({
    schema: 1,
    assistant: true,             // original Lilith window, memory, workbench, private chat (native bridge)
    statusbar: 'terminal',       // terminal (0.5.0: data blocks go to the terminal, a chip stays in the story) | native (old in-message bar) | off
    floorTag: true,              // terminal mode: the small “系统已记录” chip in place of each data block
    hubPage: 'ov',               // last terminal page (reopens there)
    hubOutsideClose: 'auto',     // auto (phones) | always | never — click outside the terminal closes it
    hubBackClose: true,          // phone back gesture closes the terminal
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

    /** Native settings drawer in the Extensions panel. 0.5.0: everything lives in the terminal; only the entry and the
     *  emergency restore stay here (works on 1.16–1.19: plain inline-drawer markup). */
    mountDrawer(actions) {
        const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!target || this.drawer) return;
        const wrap = document.createElement('div');
        wrap.id = ID + '-settings'; wrap.className = 'zt-settings';
        wrap.innerHTML = `
<div class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header"><b>诸天终端 <small>${VERSION}</small></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
  <div class="inline-drawer-content">
    <div class="zt-set-actions">
      <div class="menu_button" data-act="open">打开诸天终端</div>
      <div class="menu_button" data-act="restore" title="重新启用被“一键接管”停用的旧版正则与酒馆助手脚本">紧急恢复旧版</div>
    </div>
    <small class="zt-set-note">所有功能与设置都在终端里（莉莉丝头像 → 设置）。已验收宿主：SillyTavern ${HOST_TESTED.join(' / ')}；无需酒馆助手、无需导入正则。</small>
  </div>
</div>`;
        wrap.querySelector('.zt-set-actions').addEventListener('click', e => { const act = e.target.closest('[data-act]')?.dataset.act; if (act) actions[act]?.(); });
        target.append(wrap); this.drawer = wrap;
    }
    dispose() { this.drawer?.remove(); this.drawer = null; this.listeners.clear(); }
}
