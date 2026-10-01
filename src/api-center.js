// API 中心 (0.8.4: also the terminal 连接 page) — one place for the two API connections the v1.1 install configured separately:
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

/** The API form (shared by the popup and the terminal's 连接 page). `inline` = inside the terminal's shadow root, where
 *  SillyTavern's .menu_button styles do not reach, so buttons carry their own look and colours follow the theme vars.
 *  0.8.5: written for someone who has never seen it — one status line at the top in plain words, then 3 numbered steps.
 *  The old "状态栏 / 莉莉丝助手" table and the "应用到…" boxes (read as some kind of 绑定) moved into 高级. Radios and
 *  checkboxes carry width:auto because the original connection page styles every input as width:100%. */
function formHtml({ status, assistant, inline }) {
    const seed = assistant.url ? assistant : status;
    const main = isMainApi(seed.url);
    const desc = cfg => cfg?.url ? (isMainApi(cfg.url) ? '用酒馆正在用的模型' : esc(cfg.url) + (cfg.model ? ' · 模型 ' + esc(cfg.model) : ' · 还没填模型')) : '还没设置';
    const field = 'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid color-mix(in srgb,var(--accent,#c59bee) 30%,transparent);background:var(--zt-input,#0f0c14);color:inherit;font:inherit';
    const btn = inline ? 'class="zt-btn small" style="margin:0;white-space:nowrap"' : 'class="menu_button" style="margin:0;white-space:nowrap"';
    const tick = 'style="width:auto;min-width:0;flex:none;margin:3px 0 0;accent-color:var(--accent,#c59bee)"';
    const same = sameConfig(status, assistant), anySet = !!(status?.url || assistant?.url);
    const both = status?.url && assistant?.url;
    const state = !anySet
        ? `<b style="color:#ffcf8a">⚠ 还没有设置 API</b><span>状态栏里的 AI 功能（进货、盲盒、许愿、招募、天眼…）和莉莉丝私聊都要用它。按下面 3 步填好即可。</span>`
        : same
            ? `<b style="color:#bfe8c8">✓ 已设置</b><span>${desc(status)}</span><span style="opacity:.75">状态栏的 AI 功能和莉莉丝（私聊 / 记忆）都用这一个。想确认能不能用，点下面的「测试连接」。</span>`
            : `<b style="color:#ffcf8a">⚠ 两处用的 API 不一致</b><span>状态栏 AI 功能：${desc(status)}</span><span>莉莉丝私聊 / 记忆：${desc(assistant)}</span><span style="opacity:.75">${both ? '' : '有一处还没设置。'}在下面填好后点「保存」，两处就统一了。</span>`;
    const opt = (value, on, title, sub) => `<label style="display:flex;gap:10px;align-items:flex-start;margin:0;min-height:0;height:auto;padding:10px 12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--accent,#c59bee) ${on ? 55 : 18}%,transparent);cursor:pointer"><input type="radio" name="mode" value="${value}" ${on ? 'checked' : ''} ${tick}><span style="display:grid;gap:2px;min-width:0"><b>${title}</b><small style="opacity:.72">${sub}</small></span></label>`;
    const step = (n, t) => `<div style="display:flex;align-items:center;gap:8px;margin-top:4px"><span style="display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:color-mix(in srgb,var(--accent,#c59bee) 30%,transparent);font-size:12px;flex:none">${n}</span><b>${t}</b></div>`;
    const lbl = 'display:grid;gap:4px';
    return `<form ${inline ? '' : 'method="dialog"'} style="padding:${inline ? '4px 2px' : '18px 20px'};display:grid;gap:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b style="font-size:16px;letter-spacing:1px">${inline ? '连接 · AI 接口设置' : '诸天 · AI 接口设置'}</b>${inline ? '' : `<button value="close" ${btn}>关闭</button>`}</div>
      <div data-state style="display:grid;gap:3px;padding:10px 12px;border-radius:10px;background:#ffffff0a;font-size:13px;overflow-wrap:anywhere">${state}</div>
      ${step(1, '选择用哪个 AI')}
      <div style="display:grid;gap:8px">
        ${opt('custom', !main, '单独的 API（推荐）', '填一个 OpenAI 兼容接口（中转站 / 官方都行），不占用你正在聊天的模型')}
        ${opt('main', main, '直接用酒馆正在用的模型', '不用另填地址和密钥；但每次请求会占用主聊天，主聊天生成时要等它')}
      </div>
      <div data-custom style="display:grid;gap:10px">
        ${step(2, '填写接口')}
        <label style="${lbl}">接口地址<input name="url" style="${field}" placeholder="例如 https://api.example.com/v1" value="${main ? '' : esc(seed.url)}" autocomplete="off"><small style="opacity:.65">一般以 /v1 结尾，从你的 API 服务商那里复制。</small></label>
        <label style="${lbl}">API 密钥<input name="key" type="password" style="${field}" placeholder="sk-…" value="${main ? '' : esc(seed.key)}" autocomplete="off"></label>
        <div style="${lbl}"><span>模型</span><div style="display:flex;gap:6px"><input name="model" list="zt-api-models" style="${field}" placeholder="先点右边「拉取模型」，或直接手填" value="${main ? '' : esc(seed.model)}" autocomplete="off" aria-label="模型"><button type="button" data-act="models" ${btn}>拉取模型</button></div><datalist id="zt-api-models"></datalist>
        <select data-models hidden style="${field}" aria-label="从列表选择模型"></select></div>
      </div>
      ${step(main ? 2 : 3, '测试并保存')}
      <output data-out style="min-height:1.6em;font-size:12px;opacity:.95;white-space:pre-wrap"></output>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button type="button" data-act="test" ${btn}>测试连接</button><button type="button" data-act="save" ${btn}>保存</button></div>
      <details style="font-size:12px;opacity:.9"><summary style="cursor:pointer">高级设置（一般不用改）</summary>
        <div style="display:grid;gap:8px;margin-top:8px">
          <label style="${lbl}">莉莉丝单次回复长度上限（tokens，可留空；思考模型可填 4096）<input name="max" type="number" min="64" max="65536" style="${field}" value="${esc(assistant.maxTokens ?? '')}"></label>
          <div>保存到（默认两处都保存，保持一致）：</div>
          <label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="toStatus" checked ${tick}> 状态栏的 AI 功能（进货 / 盲盒 / 许愿 / 招募…）</label>
          <label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="toAssistant" checked ${tick}> 莉莉丝（私聊 / 记忆 / 工作台）</label>
          <div style="opacity:.75">请求超时：终端「设置」页 →「独立 API 超时」。请求一律流式传输。</div>
        </div>
      </details>
      <small style="opacity:.6">密钥只存在你自己的酒馆和浏览器里，不会写进聊天记录，也不会随插件上传。</small>
    </form>`;
}
export function sameConfig(a, b) { return ['url', 'key', 'model'].every(k => String(a?.[k] || '').trim() === String(b?.[k] || '').trim()); }

/** Wires a rendered form. `root` is the element that contains it (dialog or inline box). */
function bindForm(root, { bridge, ns, notify, rerender }) {
    const f = root.querySelector('form'), out = root.querySelector('[data-out]');
    const mode = () => f.querySelector('input[name=mode]:checked')?.value || 'custom';
    const sync = () => {
        root.querySelector('[data-custom]').style.display = mode() === 'main' ? 'none' : 'grid';
        for (const r of f.querySelectorAll('input[name=mode]')) r.closest('label').style.borderColor = `color-mix(in srgb,var(--accent,#c59bee) ${r.checked ? 55 : 18}%,transparent)`;
        const nums = [...f.querySelectorAll(':scope > div > span[style*="border-radius:50%"]')]; if (nums[1]) nums[1].textContent = mode() === 'main' ? '2' : '3';
    };
    f.addEventListener('change', sync); sync();
    f.addEventListener('submit', e => { if (!f.getAttribute('method')) e.preventDefault(); });
    const current = () => mode() === 'main' ? { url: MAIN_API_URL, key: 'st-main', model: MAIN_API_MODEL, maxTokens: f.max.value } : { url: f.url.value.trim(), key: f.key.value.trim(), model: f.model.value.trim(), maxTokens: f.max.value };
    const check = c => { if (isMainApi(c.url)) return ''; const bad = validateUrl(c.url); if (bad) return bad; if (!c.key) return '请填写 API 密钥（状态栏的 AI 功能要求地址和密钥都不为空）'; return ''; };
    const say = (t, bad) => { out.textContent = t; out.style.color = bad ? '#ff9aa8' : '#bfe8c8'; };
    const pickSel = root.querySelector('[data-models]');
    pickSel.addEventListener('change', () => { if (pickSel.value) f.model.value = pickSel.value; });
    root.querySelector('[data-act=models]').addEventListener('click', async () => {
        const c = current(); const bad = validateUrl(c.url); if (bad) return say(bad, true);
        say('正在拉取模型列表…（浏览器被拦截时自动经酒馆服务器转发）');
        try {
            const list = await bridge.listModels(c.url, c.key);
            root.querySelector('#zt-api-models').innerHTML = list.map(m => `<option value="${esc(m)}">`).join('');
            // datalist pickers are unreliable on phones: a plain select as well
            pickSel.innerHTML = `<option value="">— 从 ${list.length} 个模型中选择 —</option>` + list.map(m => `<option value="${esc(m)}" ${m === f.model.value ? 'selected' : ''}>${esc(m)}</option>`).join('');
            pickSel.hidden = false;
            say(`共 ${list.length} 个模型。`); if (!f.model.value && list[0]) f.model.value = list[0];
        } catch (e) { say('拉取失败：' + (e?.message || e) + '\n（拉不到列表时也可以直接手动填写模型名。）', true); }
    });
    root.querySelector('[data-act=test]').addEventListener('click', async () => {
        const c = current(); const bad = check(c); if (bad) return say(bad, true);
        say('测试中…'); const t0 = performance.now(), control = new AbortController(), timer = setTimeout(() => control.abort(), 45000);
        try { const r = await bridge.customChat(c, [{ role: 'user', content: '回复两个字：成功' }], { maxTokens: 16, signal: control.signal }); say(`连接正常（${Math.round(performance.now() - t0)} ms · ${r.via === 'st-proxy' ? '经酒馆服务器转发' : r.via === 'st-main' ? '酒馆主 API' : '浏览器直连'}）：${String(r.text).trim().slice(0, 40)}`); }
        catch (e) { say('测试失败：' + (e?.message || e), true); } finally { clearTimeout(timer); }
    });
    root.querySelector('[data-act=save]').addEventListener('click', async () => {
        const c = current(); const bad = check(c); if (bad) return say(bad, true);
        if (!f.toStatus.checked && !f.toAssistant.checked) return say('至少勾选一个应用目标。', true);
        try { await saveConfigs(bridge, ns, c, { status: f.toStatus.checked, assistant: f.toAssistant.checked }); notify(); rerender?.('已保存。状态栏与莉莉丝助手下一次请求即使用新配置。'); if (!rerender) say('已保存。状态栏与莉莉丝助手下一次请求即使用新配置。'); }
        catch (e) { say('保存失败：' + (e?.message || e), true); }
    });
    return { say };
}

/** 0.8.4: the terminal's 连接 page shows this form instead of the original v1.1 connection form (which wrote only the
 *  Lilith copy, so the two places drifted apart). The original section stays in the DOM, hidden, untouched. */
export function mountApiInline(section, { bridge, ns, notify = () => {} }) {
    if (!section) return null;
    section.classList.add('zt-api-unified');
    let box = section.querySelector(':scope > .zt-api-inline');
    if (!box) { box = section.ownerDocument.createElement('div'); box.className = 'zt-api-inline zt-card'; section.prepend(box); }
    const render = msg => {
        const { status, assistant } = readConfigs(bridge, ns);
        box.innerHTML = formHtml({ status, assistant, inline: true });
        const api = bindForm(box, { bridge, ns, notify, rerender: render });
        if (msg) api.say(msg);
    };
    render();
    return { box, render };
}

export function openApiCenter({ bridge, ns, notify = () => {} }) {
    document.getElementById('zt-api-center')?.remove();
    const dlg = document.createElement('dialog'); dlg.id = 'zt-api-center';
    dlg.setAttribute('style', 'max-width:min(560px,94vw);width:560px;padding:0;border:1px solid #c4a0d655;border-radius:14px;background:#1b1622;color:#eee5f5;box-shadow:0 20px 60px #000a;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif');
    const render = msg => {
        const { status, assistant } = readConfigs(bridge, ns);
        dlg.innerHTML = formHtml({ status, assistant, inline: false });
        const api = bindForm(dlg, { bridge, ns, notify, rerender: render });
        if (msg) api.say(msg);
    };
    render();
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
}
