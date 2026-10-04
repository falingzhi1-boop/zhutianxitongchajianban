// API 中心 (0.8.4: also the terminal 连接 page) — one place for the two API connections the v1.1 install configured separately:
//   * status bar (all AI buttons: 商城进货 / 盲盒 / 许愿 / 招募 / 背包整理 / 天眼 …)
//       original storage: global variable 诸天系统_API {url,key,model} + localStorage sys_api_config
//   * 莉莉丝 assistant (memory recorder, private chat, workbench)
//       original storage: script variable 诸天记忆助手_v1_API {url,key,model,maxTokens}
// The same storage is written, so the original status-bar gear dialog and the Lilith connection page keep showing the
// values chosen here and vice versa. "酒馆当前主API" writes the reserved sentinel URL (th-bridge MAIN_API_URL), which
// the native bridge answers through SillyTavern generateRaw; nothing is ever sent to that host.
import { saveEnvironment } from './save-environment.js';
import { MAIN_API_URL, MAIN_API_MODEL, isMainApi } from './th-bridge.js';
import { ROUTES, MAIN, readRoutes, writeRoutes, withPreset, withoutPreset, withRoute, routeText, cleanName, normalizeStore } from './api-routes.js';

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
    const cap = Number(maxTokens); if (Number.isInteger(cap) && cap >= 64 && cap <= 65536) cfg.maxTokens = cap;
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
const looks = inline => ({
    field: 'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid color-mix(in srgb,var(--accent,#c59bee) 30%,transparent);background:var(--zt-input,#0f0c14);color:inherit;font:inherit',
    btn: inline ? 'class="zt-btn small" style="margin:0;white-space:nowrap"' : 'class="menu_button" style="margin:0;white-space:nowrap"',
});
function formHtml({ status, assistant, inline, routes }) {
    const seed = assistant.url ? assistant : status;
    const main = isMainApi(seed.url);
    const desc = cfg => cfg?.url ? (isMainApi(cfg.url) ? '用酒馆正在用的模型' : esc(cfg.url) + (cfg.model ? ' · 模型 ' + esc(cfg.model) : ' · 还没填模型')) : '还没设置';
    const { field, btn } = looks(inline);
    const tick = 'style="width:auto;min-width:0;flex:none;margin:3px 0 0;accent-color:var(--accent,#c59bee)"';
    const same = sameConfig(status, assistant), anySet = !!(status?.url || assistant?.url);
    const both = status?.url && assistant?.url;
    const saveWarning = saveEnvironment().reason;
    const state = !anySet
        ? `<b style="color:#ffcf8a">⚠ 还没有设置 API</b><span>状态栏里的 AI 功能（进货、盲盒、许愿、招募、天眼…）和莉莉丝私聊都要用它。按下面 3 步填好即可。</span>`
        : same
            ? `<b style="color:#bfe8c8">✓ 已设置</b><span>${desc(status)}</span><span style="opacity:.75">状态栏的 AI 功能和莉莉丝（私聊 / 记忆）都用这一个。想确认能不能用，点下面的「测试连接」。</span>`
            : `<b style="color:#ffcf8a">⚠ 两处用的 API 不一致</b><span>状态栏 AI 功能：${desc(status)}</span><span>莉莉丝私聊 / 记忆：${desc(assistant)}</span><span style="opacity:.75">${both ? '' : '有一处还没设置。'}在下面填好后点「保存」，两处就统一了。</span>`;
    const opt = (value, on, title, sub) => `<label style="display:flex;gap:10px;align-items:flex-start;margin:0;min-height:0;height:auto;padding:10px 12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--accent,#c59bee) ${on ? 55 : 18}%,transparent);cursor:pointer"><input type="radio" name="mode" value="${value}" ${on ? 'checked' : ''} ${tick}><span style="display:grid;gap:2px;min-width:0"><b>${title}</b><small style="opacity:.72">${sub}</small></span></label>`;
    const step = (n, t) => `<div style="display:flex;align-items:center;gap:8px;margin-top:4px"><span style="display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:color-mix(in srgb,var(--accent,#c59bee) 30%,transparent);font-size:12px;flex:none">${n}</span><b>${t}</b></div>`;
    const lbl = 'display:grid;gap:4px';
    return `${saveWarning ? `<p role="alert" data-save-warning>${esc(saveWarning)}</p>` : ''}<form ${inline ? '' : 'method="dialog"'} style="padding:${inline ? '4px 2px' : '18px 20px'};display:grid;gap:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b style="font-size:16px;letter-spacing:1px">${inline ? '连接 · AI 接口设置' : '诸天 · AI 接口设置'}</b>${inline ? '' : `<button value="close" ${btn}>关闭</button>`}</div>
      <div data-state style="display:grid;gap:3px;padding:10px 12px;border-radius:10px;background:#ffffff0a;font-size:13px;overflow-wrap:anywhere">${state}</div>
      <div data-presets style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b style="font-weight:500;white-space:nowrap">接口预设</b><select data-f="preset" aria-label="选择接口预设" style="${field};flex:1 1 140px;min-width:0;width:140px;text-overflow:ellipsis">${presetOptions(routes)}</select><button type="button" data-act="preset-del" ${btn}>删除</button></div>
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
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input data-f="preset-name" maxlength="24" placeholder="预设名称（必填，例如：公益站 A）" aria-label="预设名称" autocomplete="off" style="${field};flex:1 1 160px;min-width:0;width:auto"><button type="button" data-act="preset-save" disabled ${btn}>保存为预设</button></div>
      <small style="opacity:.65;margin-top:-4px">把上面填好的接口存成预设：换接口时在顶部「接口预设」里一选就载入，不用重新填写。只有输入了名称才能保存。</small>
      ${routesHtml(routes, { field, btn })}
      <details style="font-size:12px;opacity:.9"><summary style="cursor:pointer">高级设置（一般不用改）</summary>
        <div style="display:grid;gap:8px;margin-top:8px">
          <label style="${lbl}">默认 / 预设最大输出（tokens，含思考；留空由各功能决定，可分功能覆盖）<input name="max" type="number" min="64" max="65536" style="${field}" value="${esc(status.maxTokens ?? assistant.maxTokens ?? '')}"></label>
          <div>保存到（默认两处都保存，保持一致）：</div>
          <label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="toStatus" checked ${tick}> 状态栏的 AI 功能（进货 / 盲盒 / 许愿 / 招募…）</label>
          <label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="toAssistant" checked ${tick}> 莉莉丝（私聊 / 记忆 / 工作台）</label>
          <div style="opacity:.75">请求超时：终端「设置」页 →「独立 API 超时」。请求一律流式传输。</div>
        </div>
      </details>
      <small style="opacity:.6">密钥只存在你自己的酒馆和浏览器里，不会写进聊天记录，也不会随插件上传。</small>
    </form>`;
}
/** 1.0: options of the preset picker (pure). */
function presetOptions(routes) {
    const list = normalizeStore(routes).presets;
    return `<option value="">${list.length ? `— 选择预设（${list.length} 个），载入到下面 —` : '还没有预设：在下面填好接口后输入名称保存'}</option>` + list.map(p => `<option value="${esc(p.name)}">${esc(p.name)} · ${esc((() => { try { return new URL(p.url).host; } catch { return '?'; } })())}${p.model ? ' · ' + esc(p.model) : ''}</option>`).join('');
}
/** 1.0 分功能 API: one row per feature that calls a model (pure). */
function routesHtml(routes, { field, btn }) {
    const s = normalizeStore(routes), own = Object.keys(s.routes).length;
    const opts = id => {
        const v = s.routes[id], cur = !v ? '' : v === MAIN ? MAIN : typeof v === 'string' ? v : 'own';
        const list = [['', '跟随默认'], [MAIN, '酒馆当前主 API'], ...s.presets.map(p => ['preset:' + p.name, `预设「${p.name}」`])];
        if (cur === 'own') list.push(['own', '单独配置（' + routeText(s, id).replace(/^单独配置 · /, '') + '）']);
        if (typeof v === 'string' && v.startsWith('preset:') && !s.presets.some(p => 'preset:' + p.name === v)) list.push([v, routeText(s, id)]);
        return list.map(([val, t]) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
    };
    let group = '';
    const rows = ROUTES.map(r => {
        const head = r.group !== group ? `<div style="margin-top:6px;font-size:11px;letter-spacing:2px;opacity:.6">${esc((group = r.group))}</div>` : '';
        return `${head}<div data-route="${r.id}" style="display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;padding:6px 0;border-top:1px solid #ffffff10">
<span style="flex:1 1 180px;min-width:0;overflow-wrap:anywhere"><b style="font-weight:500">${esc(r.label)}</b> <small style="opacity:.6">${esc(r.desc)}</small><br><small data-route-now style="opacity:.8">现在：${esc(routeText(s, r.id))}</small></span>
<span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;min-width:0;max-width:100%"><select data-route-sel="${r.id}" aria-label="${esc(r.label)} 用哪个接口" style="${field};flex:1 1 150px;width:150px;min-width:0;max-width:220px;padding:5px 8px;text-overflow:ellipsis">${opts(r.id)}</select><button type="button" data-route-own="${r.id}" title="把上面表单里填写的接口单独给这个功能用" ${btn}>用上面填写的</button></span></div>`;
    }).join('');
    return `<details data-routes ${own ? 'open' : ''} style="min-width:0;font-size:13px;border:1px solid color-mix(in srgb,var(--accent,#c59bee) 25%,transparent);border-radius:10px;padding:8px 10px">
<summary style="cursor:pointer"><b>分功能 API</b> <small data-routes-count style="opacity:.75">${own ? `已单独设置 ${own} 项` : '可选：抽卡、聊天群、莉莉丝等可以各用各的接口'}</small></summary>
<div style="opacity:.75;font-size:12px;margin:6px 0 2px">没单独设置的功能都用上面保存的默认接口。每个功能可以选：酒馆当前主 API、某个预设，或点「用上面填写的」把表单里的接口单独给它。状态栏的 AI 功能会先检查默认接口，所以默认接口要先保存一次。</div>
<div data-routes-body>${rows}</div></details>`;
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
        try { const r = await bridge.customChat(c, [{ role: 'user', content: '回复两个字：成功' }], { maxTokens: 4096, signal: control.signal }); say(`连接正常（${Math.round(performance.now() - t0)} ms · ${r.via === 'st-proxy' ? '经酒馆服务器转发' : r.via === 'st-main' ? '酒馆主 API' : '浏览器直连'}）：${String(r.text).trim().slice(0, 40)}`); }
        catch (e) { say('测试失败：' + (e?.message || e), true); } finally { clearTimeout(timer); }
    });
    // ---------- 1.0: presets ----------
    const presetSel = root.querySelector('[data-f=preset]'), nameIn = root.querySelector('[data-f=preset-name]'), saveP = root.querySelector('[data-act=preset-save]');
    const store = () => readRoutes(bridge);
    const syncName = () => { const n = cleanName(nameIn.value); saveP.disabled = !n; saveP.textContent = n && store().presets.some(p => p.name === n) ? '覆盖预设' : '保存为预设'; };
    const repaint = () => {
        const s = store(), keep = presetSel.value;
        presetSel.innerHTML = presetOptions(s); if (s.presets.some(p => p.name === keep)) presetSel.value = keep;
        const d = root.querySelector('[data-routes]'), open = d?.open;
        if (d) {
            const tmp = root.ownerDocument.createElement('div'); tmp.innerHTML = routesHtml(s, looks(!f.getAttribute('method'))); const nd = tmp.firstElementChild;
            d.querySelector('[data-routes-body]').innerHTML = nd.querySelector('[data-routes-body]').innerHTML;
            d.querySelector('[data-routes-count]').textContent = nd.querySelector('[data-routes-count]').textContent; d.open = open || nd.open;
        }
        syncName();
    };
    nameIn.addEventListener('input', syncName);
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!saveP.disabled) saveP.click(); } });
    presetSel.addEventListener('change', () => {
        const p = store().presets.find(x => x.name === presetSel.value); if (!p) return;
        const r = f.querySelector('input[name=mode][value=custom]'); if (r) r.checked = true; sync();
        f.url.value = p.url; f.key.value = p.key; f.model.value = p.model || ''; nameIn.value = p.name; syncName();
        say(`已载入预设「${p.name}」。点「保存」把它设为默认接口，或在下面「分功能 API」里只给某个功能用。`);
    });
    saveP.addEventListener('click', async () => {
        const name = cleanName(nameIn.value); if (!name) return say('请先输入预设名称，再保存。', true);
        const c = current(); if (mode() === 'main') return say('「酒馆当前主 API」不需要存成预设：在「分功能 API」里直接选它即可。', true);
        const bad = check(c); if (bad) return say(bad, true);
        try { const had = store().presets.some(p => p.name === name); await writeRoutes(bridge, withPreset(store(), name, c)); repaint(); presetSel.value = name; say(had ? `已覆盖预设「${name}」。用它的功能下一次请求即用新接口。` : `已保存预设「${name}」。`); }
        catch (e) { say('保存预设失败：' + (e?.message || e), true); }
    });
    root.querySelector('[data-act=preset-del]').addEventListener('click', async () => {
        const name = presetSel.value; if (!name) return say('先在「接口预设」里选中要删除的预设。', true);
        const users = Object.entries(store().routes).filter(([, v]) => v === 'preset:' + name).length;
        if (!globalThis.confirm(`删除预设「${name}」？${users ? `有 ${users} 个功能在用它，删除后改回跟随默认。` : ''}`)) return;
        try { await writeRoutes(bridge, withoutPreset(store(), name)); repaint(); presetSel.value = ''; say(`已删除预设「${name}」。`); }
        catch (e) { say('删除失败：' + (e?.message || e), true); }
    });
    // ---------- 1.0: 分功能 API ----------
    const label = id => ROUTES.find(r => r.id === id)?.label || id;
    f.addEventListener('change', async e => {
        const sl = e.target.closest?.('[data-route-sel]'); if (!sl) return;
        const id = sl.dataset.routeSel; if (sl.value === 'own') return;
        try { const s = await writeRoutes(bridge, withRoute(store(), id, sl.value)); repaint(); say(`已提交保存：${label(id)} → ${routeText(s, id)}。下一次请求生效。`); }
        catch (err) { say('保存失败：' + (err?.message || err), true); repaint(); }
    });
    f.addEventListener('click', async e => {
        const b = e.target.closest?.('[data-route-own]'); if (!b) return;
        const id = b.dataset.routeOwn, c = current();
        if (mode() !== 'main') { const bad = check(c); if (bad) return say(`${label(id)}：${bad}`, true); }
        try { const s = await writeRoutes(bridge, withRoute(store(), id, mode() === 'main' ? MAIN : c)); repaint(); say(`已提交保存：${label(id)} → ${routeText(s, id)}。只影响这个功能，默认接口不变。`); }
        catch (err) { say('保存失败：' + (err?.message || err), true); }
    });
    syncName();
    root.querySelector('[data-act=save]').addEventListener('click', async () => {
        const c = current(); const bad = check(c); if (bad) return say(bad, true);
        if (!f.toStatus.checked && !f.toAssistant.checked) return say('至少勾选一个应用目标。', true);
        try { await saveConfigs(bridge, ns, c, { status: f.toStatus.checked, assistant: f.toAssistant.checked }); notify(); rerender?.('已提交给酒馆保存；若保存失败请查看诊断，重载后核对。状态栏与莉莉丝助手下一次请求即使用新配置（单独设置过的功能不受影响）。'); if (!rerender) say('已提交给酒馆保存；若保存失败请查看诊断，重载后核对。状态栏与莉莉丝助手下一次请求即使用新配置（单独设置过的功能不受影响）。'); }
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
        box.innerHTML = formHtml({ status, assistant, inline: true, routes: readRoutes(bridge) });
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
        dlg.innerHTML = formHtml({ status, assistant, inline: false, routes: readRoutes(bridge) });
        const api = bindForm(dlg, { bridge, ns, notify, rerender: render });
        if (msg) api.say(msg);
    };
    render();
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
}
