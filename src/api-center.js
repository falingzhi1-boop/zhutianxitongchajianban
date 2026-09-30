// API 中心 — one place for the two API connections the v1.1 install configured separately:
//   * status bar (all AI buttons: 商城进货 / 盲盒 / 许愿 / 招募 / 背包整理 / 天眼 …)
//       original storage: global variable 诸天系统_API {url,key,model} + localStorage sys_api_config
//   * 莉莉丝 assistant (memory recorder, private chat, workbench)
//       original storage: script variable 诸天记忆助手_v1_API {url,key,model,maxTokens}
// The same storage is written, so the original status-bar gear dialog and the Lilith connection page keep showing the
// values chosen here and vice versa. "酒馆当前主API" writes the reserved sentinel URL (th-bridge MAIN_API_URL), which
// the native bridge answers through SillyTavern generateRaw; nothing is ever sent to that host.
import { MAIN_API_URL, MAIN_API_MODEL, isMainApi } from './th-bridge.js';

export const STATUS_KEY = '诸天系统_API';
export const STATUS_LOCAL = 'sys_api_config';
export const assistantKey = ns => (ns || '诸天记忆助手_v1') + '_API';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Validation shared with the original assistant: https (http only for loopback), no credentials/query/hash. */
export function validateUrl(url) {
    let u; try { u = new URL(String(url || '').trim()); } catch { return '地址格式不正确'; }
    const loop = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loop)) return '只允许 https（本机地址可用 http）';
    if (u.username || u.password || u.search || u.hash) return '地址里不能带账号、查询参数或 #';
    return '';
}
export function readConfigs(bridge, ns) {
    const g = bridge.getVariables({ type: 'global' })?.[STATUS_KEY] || {};
    let local = {}; try { local = JSON.parse(localStorage.getItem(STATUS_LOCAL) || '{}') || {}; } catch { /* ignore */ }
    const status = (g.url || g.key || g.model) ? g : local;
    const assistant = bridge.getVariables({ type: 'script' })?.[assistantKey(ns)] || {};
    return { status, assistant };
}
export async function saveConfigs(bridge, ns, { url, key, model, maxTokens }, { status = true, assistant = true } = {}) {
    const main = isMainApi(url);
    const cfg = main ? { url: MAIN_API_URL, key: 'st-main', model: MAIN_API_MODEL } : { url: String(url).trim(), key: String(key).trim(), model: String(model || '').trim() };
    if (status) {
        await bridge.updateVariablesWith(v => { v[STATUS_KEY] = { ...cfg }; return v; }, { type: 'global' });
        try { localStorage.setItem(STATUS_LOCAL, JSON.stringify(cfg)); } catch { /* private mode */ }
    }
    if (assistant) {
        const a = { ...cfg }; const n = Number(maxTokens); if (Number.isInteger(n) && n >= 64 && n <= 65536) a.maxTokens = n;
        await bridge.updateVariablesWith(v => { v[assistantKey(ns)] = a; return v; }, { type: 'script' });
    }
    return cfg;
}

export function openApiCenter({ bridge, ns, notify = () => {} }) {
    document.getElementById('zt-api-center')?.remove();
    const { status, assistant } = readConfigs(bridge, ns);
    const seed = assistant.url ? assistant : status;
    const main = isMainApi(seed.url);
    const dlg = document.createElement('dialog'); dlg.id = 'zt-api-center';
    dlg.setAttribute('style', 'max-width:min(560px,94vw);width:560px;padding:0;border:1px solid #c4a0d655;border-radius:14px;background:#1b1622;color:#eee5f5;box-shadow:0 20px 60px #000a;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif');
    const line = (label, cfg) => `<div style="display:flex;gap:8px;font-size:12px;opacity:.85"><b style="min-width:5.5em">${label}</b><span style="overflow-wrap:anywhere">${cfg?.url ? (isMainApi(cfg.url) ? '酒馆当前主API' : esc(cfg.url) + (cfg.model ? ' · ' + esc(cfg.model) : '')) + (cfg.key && !isMainApi(cfg.url) ? ' · 密钥已设置' : '') : '<i>未设置</i>'}</span></div>`;
    const field = 'width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid #ffffff26;background:#0f0c14;color:inherit;font:inherit';
    dlg.innerHTML = `<form method="dialog" style="padding:18px 20px;display:grid;gap:12px">
      <div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:16px;letter-spacing:1px">诸天 · API 中心</b><button value="close" class="menu_button" style="margin:0">关闭</button></div>
      <div style="display:grid;gap:3px;padding:9px 11px;border-radius:10px;background:#ffffff0a">${line('状态栏', status)}${line('莉莉丝助手', assistant)}</div>
      <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="mode" value="custom" ${main ? '' : 'checked'}> 独立 API（OpenAI 兼容，推荐：不占用主聊天）</label>
      <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="mode" value="main" ${main ? 'checked' : ''}> 使用酒馆当前连接的主 API（无需另填密钥）</label>
      <div data-custom style="display:grid;gap:8px">
        <label>接口地址<input name="url" style="${field}" placeholder="https://api.example.com/v1" value="${main ? '' : esc(seed.url)}" autocomplete="off"></label>
        <label>API 密钥<input name="key" type="password" style="${field}" value="${main ? '' : esc(seed.key)}" autocomplete="off"></label>
        <label>模型<div style="display:flex;gap:6px"><input name="model" list="zt-api-models" style="${field}" value="${main ? '' : esc(seed.model)}" autocomplete="off"><button type="button" data-act="models" class="menu_button" style="margin:0;white-space:nowrap">拉取模型</button></div><datalist id="zt-api-models"></datalist></label>
      </div>
      <label>助手单次输出上限（tokens，可空）<input name="max" type="number" min="64" max="65536" style="${field}" value="${esc(assistant.maxTokens ?? '')}"></label>
      <div style="display:flex;gap:14px;flex-wrap:wrap"><label><input type="checkbox" name="toStatus" checked> 应用到状态栏</label><label><input type="checkbox" name="toAssistant" checked> 应用到莉莉丝助手</label></div>
      <output data-out style="min-height:1.6em;font-size:12px;opacity:.9;white-space:pre-wrap"></output>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" data-act="test" class="menu_button" style="margin:0">测试连接</button><button type="button" data-act="save" class="menu_button" style="margin:0">保存</button></div>
      <small style="opacity:.6">密钥只保存在本机酒馆设置 / 浏览器里，不会写进聊天记录，也不会随插件上传。</small>
    </form>`;
    document.body.append(dlg);
    const f = dlg.querySelector('form'), out = dlg.querySelector('[data-out]');
    const mode = () => f.mode.value;
    const sync = () => { dlg.querySelector('[data-custom]').style.display = mode() === 'main' ? 'none' : 'grid'; };
    f.addEventListener('change', sync); sync();
    const current = () => mode() === 'main' ? { url: MAIN_API_URL, key: 'st-main', model: MAIN_API_MODEL, maxTokens: f.max.value } : { url: f.url.value.trim(), key: f.key.value.trim(), model: f.model.value.trim(), maxTokens: f.max.value };
    const check = c => { if (isMainApi(c.url)) return ''; const bad = validateUrl(c.url); if (bad) return bad; if (!c.key) return '请填写 API 密钥（状态栏的 AI 功能要求地址和密钥都不为空）'; return ''; };
    const say = (t, bad) => { out.textContent = t; out.style.color = bad ? '#ff9aa8' : '#bfe8c8'; };
    dlg.querySelector('[data-act=models]').addEventListener('click', async () => {
        const c = current(); const bad = validateUrl(c.url); if (bad) return say(bad, true);
        say('正在拉取模型列表…');
        try { const list = await bridge.listModels(c.url, c.key); dlg.querySelector('#zt-api-models').innerHTML = list.map(m => `<option value="${esc(m)}">`).join(''); say(`共 ${list.length} 个模型，点模型输入框选择。`); if (!f.model.value && list[0]) f.model.value = list[0]; }
        catch (e) { say('拉取失败：' + (e?.message || e), true); }
    });
    dlg.querySelector('[data-act=test]').addEventListener('click', async () => {
        const c = current(); const bad = check(c); if (bad) return say(bad, true);
        say('测试中…'); const t0 = performance.now(), control = new AbortController(), timer = setTimeout(() => control.abort(), 45000);
        try { const r = await bridge.customChat(c, [{ role: 'user', content: '回复两个字：成功' }], { maxTokens: 16, signal: control.signal }); say(`连接正常（${Math.round(performance.now() - t0)} ms）：${String(r.text).trim().slice(0, 40)}`); }
        catch (e) { say('测试失败：' + (e?.message || e), true); } finally { clearTimeout(timer); }
    });
    dlg.querySelector('[data-act=save]').addEventListener('click', async () => {
        const c = current(); const bad = check(c); if (bad) return say(bad, true);
        if (!f.toStatus.checked && !f.toAssistant.checked) return say('至少勾选一个应用目标。', true);
        try { await saveConfigs(bridge, ns, c, { status: f.toStatus.checked, assistant: f.toAssistant.checked }); say('已保存。状态栏与莉莉丝助手下一次请求即使用新配置。'); notify(); }
        catch (e) { say('保存失败：' + (e?.message || e), true); }
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
}
