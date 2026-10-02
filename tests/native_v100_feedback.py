"""1.0.0 player-feedback round (version unchanged) — isolated SillyTavern + mock model only.
  * 接口预设: 保存 stays disabled until a name is typed; the preset is stored; picking it fills the form;
  * 分功能 API: a feature routed to a preset / own config really sends to that address, key and model (mock log);
    unrouted features keep the default connection; Lilith 私聊 routed through the assistant fetch;
  * 品阶鉴定: a story skill / item booked as 凡品 is raised by the AI appraisal (routed API) or by hand; system-made
    entries are not listed; 「收录:功法名[更高品阶]」 in a later data block raises a story skill;
  * 一键关闭插件: confirm popup → cancel keeps it on; OK → SillyTavern disables the extension and reloads (re-enabled after);
  * 关闭悬浮莉莉丝: drag her onto 「关闭悬浮窗」 → the popup says the console is in SillyTavern's 扩展 panel → closed;
    right click menu; the drawer button brings her back; on a phone the same with a real touch long-press.
Usage: python3 tests/native_v100_feedback.py --isolated-test-only --base-url http://127.0.0.1:8019
"""
import argparse, json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / 'qa'))
import zt_common as Z
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--isolated-test-only', action='store_true', required=True)
ap.add_argument('--base-url', default='http://127.0.0.1:8019')
ap.add_argument('--mock', default='http://127.0.0.1:5001/v1')
ap.add_argument('--mock-log', default='/var/tmp/qa/mock.jsonl')
ap.add_argument('--shots', default='/var/tmp/qa/shots100fb')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
EXT = '/scripts/extensions/third-party/zhutianxitongchajianban/src/'
KEY = 'sk-qa1000notrealkey000000'          # fake: the mock never checks it
PKEY = 'sk-qa1000presetkey000000'           # fake preset key
GKEY = 'sk-qa1000ownroutekey0000'           # fake own-config key

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def z(page): return page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
def routes(page): return page.evaluate("()=>__zhutianApp.bridge.getVariables({type:'global'})['诸天系统_API路由']||null")
def log_lines():
    try: return Path(args.mock_log).read_text(encoding='utf-8').splitlines()
    except FileNotFoundError: return []
def new_requests(since):
    out = []
    for l in log_lines()[since:]:
        try: out.append(json.loads(l))
        except Exception: pass
    return out
def sys_of(rec):
    for m in (rec.get('body') or {}).get('messages') or []:
        if m.get('role') == 'system': return str(m.get('content'))
    return ''
def popup(page, timeout=6000):
    page.wait_for_selector('dialog.popup[open]', timeout=timeout)
    return page.evaluate("()=>[...document.querySelectorAll('dialog.popup[open]')].at(-1)?.innerText||''")
def popup_click(page, which):
    page.locator(f'dialog.popup[open] .popup-button-{which}').last.click(); page.wait_for_timeout(500)
def hub(page, js): return page.evaluate("()=>{const sh=__zhutianApp.hub.shadow;" + js + "}")

READY = "(()=>{try{return SillyTavern.getContext().eventSource.autoFireLastArgs?.has?.(SillyTavern.getContext().eventTypes.APP_READY)}catch{return false}})()"
def wait_host(page):
    """SillyTavern loaded (after a reload we did not start ourselves): keep dismissing first-run popups."""
    for _ in range(180):
        try:
            btn = page.locator('dialog.popup[open] .popup-button-ok:visible')
            if btn.count(): btn.first.click(); page.wait_for_timeout(600); continue
            if page.evaluate(READY): return True
        except Exception: pass          # the page is still navigating
        page.wait_for_timeout(500)
    return False
ENABLE = "async()=>{const m=await import('/scripts/extensions.js');const n=(SillyTavern.getContext().extensionSettings.disabledExtensions||[]).find(x=>x.endsWith('zhutianxitongchajianban'));if(n){await m.enableExtension(n,false);return n;}return '';}"
def ensure_enabled(page):
    """An earlier interrupted run may have left the plugin disabled by the 一键关闭 test: switch it back on first."""
    page.goto(args.base_url.rstrip('/') + '/', timeout=90000); wait_host(page)
    if page.evaluate(ENABLE): print('note: the plugin was left disabled by an earlier run — re-enabled', flush=True)

def run(browser):
    ctx = browser.new_context(viewport={'width': 1280, 'height': 860})
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    ensure_enabled(page)
    Z.boot(page)
    page.evaluate("async()=>{const m=await import('" + EXT + "api-center.js');await m.saveConfigs(__zhutianApp.bridge,'诸天记忆助手_v1',{url:'" + args.mock + "',key:'" + KEY + "',model:'mock-zt',maxTokens:1500});"
                  "await __zhutianApp.bridge.updateVariablesWith(v=>{delete v['诸天系统_API路由'];return v;},{type:'global'});}")
    Z.setup_chat(page)

    # ---------- 接口预设 ----------
    page.evaluate("()=>__zhutianApp.hub.open('api')"); page.wait_for_timeout(1200)
    name_in = page.locator('#page-api [data-f=preset-name]'); save = page.locator('#page-api [data-act=preset-save]')
    ok('preset: 保存为预设 is disabled while the name is empty', name_in.count() == 1 and save.is_disabled())
    name_in.fill('   '); page.wait_for_timeout(150)
    ok('preset: spaces only still count as no name', save.is_disabled())
    save.click(force=True); page.wait_for_timeout(400)
    ok('preset: a forced click without a name stores nothing', not (routes(page) or {}).get('presets'), json.dumps(routes(page), ensure_ascii=False))
    # the form holds the preset's connection: type it in, then save it under a name
    page.evaluate("""([u,k])=>{const f=__zhutianApp.hub.shadow.querySelector('#page-api form')||__zhutianApp.hub.shadow.querySelector('#page-api');
      const set=(sel,v)=>{const el=f.querySelector(sel);if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
      const r=f.querySelector('input[name=mode][value=custom]');if(r&&!r.checked){r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));}
      set('[name=url]',u);set('[name=key]',k);set('[name=model]','mock-zt-mini');}""", [args.mock, PKEY])
    name_in.fill('公益站A'); page.wait_for_timeout(150)
    ok('preset: typing a name enables the button', not save.is_disabled() and save.inner_text().strip() == '保存为预设', save.inner_text())
    save.click(); page.wait_for_timeout(900)
    r = routes(page) or {}
    p = (r.get('presets') or [{}])[0]
    ok('preset: saved with its name, address and model (global variable, not the chat)', p.get('name') == '公益站A' and p.get('url') == args.mock and p.get('model') == 'mock-zt-mini' and p.get('key') == PKEY,
       json.dumps({k: v for k, v in p.items() if k != 'key'}, ensure_ascii=False))
    name_in.fill('公益站A'); page.wait_for_timeout(150)
    ok('preset: the same name offers 覆盖预设', save.inner_text().strip() == '覆盖预设', save.inner_text())
    name_in.fill(''); page.wait_for_timeout(150)
    ok('preset: clearing the name disables it again', save.is_disabled())
    chat_vars = page.evaluate("()=>JSON.stringify(SillyTavern.getContext().chatMetadata?.variables||{})")
    ok('preset: the preset key is not in the chat file', PKEY not in chat_vars)
    page.screenshot(path=str(SHOTS / 'fb-presets.png'))

    # ---------- 分功能 API ----------
    page.evaluate("()=>{const d=__zhutianApp.hub.shadow.querySelector('#page-api details[data-routes]');if(d)d.open=true;}"); page.wait_for_timeout(300)
    sel = page.locator('#page-api [data-route-sel=appraise]')
    opts = sel.evaluate("s=>[...s.options].map(o=>o.textContent)") if sel.count() else []
    ok('routes: each feature row offers 跟随默认 / 酒馆主 API / the preset', len(opts) >= 3 and '跟随默认' in opts[0] and any('公益站A' in o for o in opts), json.dumps(opts, ensure_ascii=False))
    rows = page.evaluate("()=>[...__zhutianApp.hub.shadow.querySelectorAll('#page-api [data-route]')].map(r=>r.dataset.route)")
    ok('routes: 抽卡、聊天群、莉莉丝私聊 … all listed', all(x in rows for x in ['gacha', 'group', 'chat', 'memory', 'shop', 'appraise']), json.dumps(rows))
    sel.select_option('preset:公益站A'); page.wait_for_timeout(900)
    r = routes(page) or {}
    ok('routes: picking the preset for 品阶鉴定 is saved', (r.get('routes') or {}).get('appraise') == 'preset:公益站A', json.dumps(r.get('routes'), ensure_ascii=False))
    now = page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-api [data-route=appraise] [data-route-now]')?.textContent||''")
    ok('routes: the row says where it goes now (no key shown)', '公益站A' in now and 'sk-' not in now, now)
    # own config for 商城进货 (written through the module, the UI path is the same writeRoutes)
    page.evaluate("async([u,k])=>{const m=await import('" + EXT + "api-routes.js');const b=__zhutianApp.bridge;await m.writeRoutes(b,m.withRoute(m.readRoutes(b),'shop',{url:u,key:k,model:'mock-zt-own'}));"
                  "await m.writeRoutes(b,m.withRoute(m.readRoutes(b),'chat','preset:公益站A'));}", [args.mock, GKEY])
    # the status bar's 商城 · AI 进货 request (same system prompt as statusbar 3.1 sysFetchAPI) built from the default connection
    n0 = len(log_lines())
    out = page.evaluate("async([u,k])=>{try{return await __zhutianApp.bridge.generateRaw({user_input:'进货',ordered_prompts:[{role:'system',content:'只输出规定的格式列表，不要任何废话。'},'user_input'],custom_api:{apiurl:u,key:k,model:'mock-zt',max_tokens:800,temperature:0.7}});}catch(e){return 'ERR '+e.message}}", [args.mock, KEY])
    reqs = [x for x in new_requests(n0) if x.get('path', '').endswith('/chat/completions')]
    last = reqs[-1] if reqs else {}
    ok('routes: 商城进货 (own config) goes out with its own key and model', last.get('auth') == 'Bearer ' + GKEY and (last.get('body') or {}).get('model') == 'mock-zt-own' and '凡品' in str(out),
       json.dumps({'auth': str(last.get('auth'))[:30], 'model': (last.get('body') or {}).get('model'), 'out': str(out)[:60]}, ensure_ascii=False))
    n0 = len(log_lines())
    page.evaluate("async([u,k])=>{try{return await __zhutianApp.bridge.generateRaw({user_input:'抽',ordered_prompts:[{role:'system',content:'你是诸天系统的奖励生成器，严格遵守格式。'},'user_input'],custom_api:{apiurl:u,key:k,model:'mock-zt',max_tokens:800,temperature:0.7}});}catch(e){return 'ERR '+e.message}}", [args.mock, KEY])
    reqs = [x for x in new_requests(n0) if x.get('path', '').endswith('/chat/completions')]
    last = reqs[-1] if reqs else {}
    ok('routes: an unrouted feature (抽卡) still uses the default connection', last.get('auth') == 'Bearer ' + KEY and (last.get('body') or {}).get('model') == 'mock-zt', json.dumps({'auth': str(last.get('auth'))[:30], 'model': (last.get('body') or {}).get('model')}))
    # Lilith 私聊 through the assistant's fetch (the original assistant builds it from its default connection)
    n0 = len(log_lines())
    res = page.evaluate("""async([u,k])=>{const f=__zhutianApp.assistant?.shimFetch;if(!f)return 'no assistant';
      const send=async sys=>{const r=await f(u+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+k},body:JSON.stringify({model:'mock-zt',max_tokens:300,messages:[{role:'system',content:sys},{role:'user',content:'在吗'}]})});return r.status;};
      return [await send('你是契约恶魔莉莉丝，正在和宿主私聊。'),await send('你是诸天系统外挂世界书的事实记录员。本轮原文：……')];}""", [args.mock, KEY])
    reqs = [x for x in new_requests(n0) if x.get('path', '').endswith('/chat/completions')]
    chat_req = next((x for x in reqs if '私聊' in sys_of(x)), {}); mem_req = next((x for x in reqs if '事实记录员' in sys_of(x)), {})
    ok('routes: Lilith 私聊 routed to the preset (key + model), 记忆 stays on the default', res != 'no assistant' and chat_req.get('auth') == 'Bearer ' + PKEY and (chat_req.get('body') or {}).get('model') == 'mock-zt-mini' and mem_req.get('auth') == 'Bearer ' + KEY,
       json.dumps({'res': res, 'chat': [str(chat_req.get('auth'))[:28], (chat_req.get('body') or {}).get('model')], 'mem': str(mem_req.get('auth'))[:28]}, ensure_ascii=False))
    n0 = len(log_lines())
    page.evaluate("async([u,k])=>{const f=__zhutianApp.assistant?.shimFetch;if(f)await f(u+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+k},body:JSON.stringify({model:'mock-zt',max_tokens:16,messages:[{role:'user',content:'只回复：成功'}]})});}", [args.mock, KEY])
    reqs = [x for x in new_requests(n0) if x.get('path', '').endswith('/chat/completions')]
    ok('routes: Lilith 连接页「测试连接」 still tests the default connection (not the 私聊 route)', reqs and reqs[-1].get('auth') == 'Bearer ' + KEY, json.dumps([str(x.get('auth'))[:28] for x in reqs]))
    diag = page.evaluate("async()=>{try{const t=await __zhutianApp.features.diagnosticsText?.();return String(t||'')}catch(e){return 'ERR '+e.message}}")
    if diag and not diag.startswith('ERR'):
        ok('routes: diagnostics show the routing summary but no preset key', PKEY not in diag and GKEY not in diag, '')

    # ---------- 品阶鉴定 ----------
    page.evaluate("""async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const z=v.诸天系统;
      z.功法库=[{名称:'太虚剑意',品阶:'凡品',上限:100,熟练度:100,圆满:true,来源:'收录',描述:'一剑开天门'},{名称:'基础吐纳',品阶:'凡品',上限:100,熟练度:5,来源:'商城'},{名称:'残月刀法',品阶:'凡品',上限:100,熟练度:20,来源:'数据块'}];
      z.背包=[{名称:'古剑',品级:'凡品',数量:1,来源:'',价格:0,分类:'武器',效果:'剑身有龙纹'},{名称:'引气丹',品级:'凡品',数量:3,来源:'商城',价格:500,分类:'消耗品'}];return v;},{type:'chat'});}""")
    page.wait_for_timeout(600)
    page.evaluate("()=>__zhutianApp.hub.go('appraise')"); page.wait_for_timeout(900)
    listed = hub(page, "return [...sh.querySelectorAll('#page-appraise [data-ap-row]')].map(r=>r.dataset.apRow)")
    ok('appraise: story skills / items listed, shop-bought ones not', 'skill:太虚剑意' in listed and 'item:古剑|凡品' in listed and not any('基础吐纳' in x or '引气丹' in x for x in listed), json.dumps(listed, ensure_ascii=False))
    page.screenshot(path=str(SHOTS / 'fb-appraise.png'))
    n0 = len(log_lines())
    page.locator('#page-appraise [data-ap-row="skill:太虚剑意"] [data-ap-ai]').click()
    page.wait_for_function("()=>{const s=(__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.功法库||[]).find(x=>x.名称==='太虚剑意');return s&&s.品阶!=='凡品'}", timeout=30000)
    zz = z(page); s = next(x for x in zz['功法库'] if x['名称'] == '太虚剑意')
    ok('appraise: AI 鉴定 raises 太虚剑意 凡品 → 仙品, cap 2000, 圆满 cleared, stamped', s['品阶'] == '仙品' and s['上限'] == 2000 and not s.get('圆满') and (s.get('鉴定') or {}).get('方式') == 'AI 鉴定', json.dumps(s, ensure_ascii=False))
    reqs = [x for x in new_requests(n0) if '品阶鉴定官' in sys_of(x)]
    ok('appraise: the request went to the routed preset (key + model)', reqs and reqs[-1].get('auth') == 'Bearer ' + PKEY and (reqs[-1].get('body') or {}).get('model') == 'mock-zt-mini', json.dumps([str(reqs[-1].get('auth'))[:28] if reqs else None]))
    log = [x for x in (zz.get('功法记录') or []) if x.get('名称') == '太虚剑意']
    ok('appraise: logged in 功法记录', any('凡品→仙品' in str(x.get('变化')) for x in log), json.dumps(log[-1:] if log else None, ensure_ascii=False))
    try: page.wait_for_function("()=>(__zhutianApp.hub.shadow.querySelector('#page-appraise [data-ap-out]')?.textContent||'').includes('仙品')", timeout=8000)
    except Exception: pass
    out_txt = hub(page, "return sh.querySelector('#page-appraise [data-ap-out]')?.textContent||''")
    ok('appraise: the page says the result and the reason', '仙品' in out_txt and '理由' in out_txt, out_txt)
    # manual raise (native confirm is accepted by the dialog handler)
    page.locator('#page-appraise [data-ap-row="item:古剑|凡品"] [data-ap-pick]').select_option('灵品')
    page.wait_for_function("()=>(__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.背包||[]).some(x=>x.名称==='古剑'&&x.品级==='灵品')", timeout=15000)
    it = next(x for x in z(page)['背包'] if x['名称'] == '古剑')
    ok('appraise: 手动修正 raises 古剑 to 灵品, recycle value stays the 凡品 one', it['品级'] == '灵品' and it.get('价格') == 100 and (it.get('鉴定') or {}).get('方式') == '手动修正', json.dumps(it, ensure_ascii=False))
    opts = hub(page, "return [...sh.querySelectorAll('#page-appraise [data-ap-row=\"skill:太虚剑意\"] [data-ap-pick] option')].map(o=>o.value).filter(Boolean)")
    ok('appraise: after 仙品 only higher grades are offered (no way down)', opts == ['神品'], json.dumps(opts, ensure_ascii=False))
    # the 修行 strip and the 背包 tab link to the page
    page.evaluate("()=>__zhutianApp.hub.go('cult')"); page.wait_for_timeout(1500)
    has_btn = hub(page, "return !!sh.querySelector('#zt-engine-tools [data-sk-appraise]')")
    page.evaluate("()=>__zhutianApp.hub.go('bag')"); page.wait_for_timeout(1500)
    has_link = hub(page, "return !!sh.querySelector('#zt-engine-tools .zt-appraise-link')")
    ok('appraise: reachable from 修行 and 背包', has_btn and has_link, json.dumps([has_btn, has_link]))
    # 「收录:残月刀法[灵品]」 in a new data block raises the story skill
    page.evaluate("()=>__zhutianApp.hub.go('cult')"); page.wait_for_timeout(600)
    page.evaluate("""async()=>{const c=SillyTavern.getContext();
      c.chat.push({name:c.name1,is_user:true,is_system:false,send_date:new Date().toISOString(),mes:'继续修炼。',extra:{},swipe_id:0,swipes:['继续修炼。']});
      const mes='第四幕。残月刀法的真正来历揭晓。\\n\\n<ZhuTianPanel>\\n系统点: 1200\\n当前任务: 引气入体\\n任务进度: 40\\n功法修炼: 收录:残月刀法[灵品]\\n系统播报: 刀法品阶更正\\n</ZhuTianPanel>';
      c.chat.push({name:c.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes,extra:{},swipe_id:0,swipes:[mes]});
      await c.saveChat();await c.reloadCurrentChat();}""")
    try:
        page.wait_for_function("()=>{const s=(__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.功法库||[]).find(x=>x.名称==='残月刀法');return s&&s.品阶==='灵品'}", timeout=25000)
        raised = True
    except Exception: raised = False
    s = next((x for x in z(page).get('功法库') or [] if x['名称'] == '残月刀法'), {})
    ok('收录:残月刀法[灵品] raises the story skill once (cap 500, 收录更正)', raised and s.get('上限') == 500 and (s.get('鉴定') or {}).get('方式') == '收录更正', json.dumps(s, ensure_ascii=False))
    inj = page.evaluate("()=>Object.entries(SillyTavern.getContext().extensionPrompts||{}).filter(([k])=>k.endsWith('/grade')).map(([,v])=>v.value).join('')")
    ok('appraise: one prompt line tells the AI to write the grade', '收录:功法名[品阶]' in inj, inj[:80])

    # ---------- 关闭悬浮莉莉丝 ----------
    page.evaluate("()=>{__zhutianApp.hub.close?.()}"); page.wait_for_timeout(1500)   # the close animation ends with onHub(false): let it settle first
    page.evaluate("()=>{__zhutianApp.settings.set('floatLilith','on');__zhutianApp.settings.set('floatPos',{x:500,y:300,edge:'',tucked:false});__zhutianApp.float.tempTuck=false;__zhutianApp.float.sync();}"); page.wait_for_timeout(1500)
    page.evaluate("()=>__zhutianApp.float.quiet?.()"); page.wait_for_timeout(600)
    page.evaluate("()=>{for(const t of document.querySelectorAll('#toast-container .toast'))t.remove();}")
    box = page.evaluate("()=>{const r=__zhutianApp.float.fig.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}")
    at = page.evaluate("([x,y])=>{const e=document.elementFromPoint(x,y);return e?(e.id||e.tagName)+' '+(e.shadowRoot?.elementFromPoint?.(x,y)?.className||''):'none'}", [box['x'], box['y']])
    page.mouse.move(box['x'], box['y']); page.mouse.down(); page.mouse.move(box['x'] + 10, box['y'] + 10, steps=3); page.mouse.move(box['x'] + 30, box['y'] + 30, steps=4)
    page.wait_for_timeout(250)
    bin_ = page.evaluate("()=>{const b=__zhutianApp.float.bin;const r=b.getBoundingClientRect();return {show:b.classList.contains('show'),x:r.x+r.width/2,y:r.y+r.height/2,text:b.textContent}}")
    ok('float: dragging shows 「拖到这里关闭悬浮窗」 at the bottom', bin_['show'] and '关闭悬浮窗' in bin_['text'] and bin_['y'] > 700, json.dumps(bin_, ensure_ascii=False) + ' at=' + at + ' box=' + json.dumps(box))
    page.mouse.move(bin_['x'], bin_['y'], steps=10); page.wait_for_timeout(150)
    hot = page.evaluate("()=>__zhutianApp.float.bin.classList.contains('hot')")
    page.screenshot(path=str(SHOTS / 'fb-float-bin.png'))
    page.mouse.up()
    text = popup(page)
    ok('float: dropping on it asks first, and says the console is in SillyTavern\'s 扩展 panel', hot and '扩展' in text and '打开诸天终端' in text, text[:160].replace('\n', ' '))
    page.wait_for_timeout(700); page.screenshot(path=str(SHOTS / 'fb-float-confirm.png'))
    popup_click(page, 'cancel')
    ok('float: 留着她 keeps her', page.evaluate("__zhutianApp.settings.get('floatLilith')") == 'on' and page.evaluate("__zhutianApp.float.active"))
    # right click menu (desktop)
    box = page.evaluate("()=>{const r=__zhutianApp.float.fig.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}")
    page.mouse.click(box['x'], box['y'], button='right'); page.wait_for_timeout(300)
    menu = page.evaluate("()=>{const m=__zhutianApp.float.menu;return {open:!m.hidden,items:[...m.querySelectorAll('button')].map(b=>b.textContent)}}")
    ok('float: right click opens 打开诸天终端 / 藏到屏幕边 / 关闭悬浮窗', menu['open'] and len(menu['items']) == 3 and '关闭悬浮窗' in menu['items'][2], json.dumps(menu, ensure_ascii=False))
    page.evaluate("()=>__zhutianApp.float.menu.querySelector('[data-m=close]').click()")
    popup(page); popup_click(page, 'ok'); page.wait_for_timeout(800)
    toast = page.evaluate("()=>[...document.querySelectorAll('#toast-container .toast')].map(t=>t.innerText).join(' | ')")
    ok('float: confirmed → closed (setting off, hidden) and the toast says where the console is', page.evaluate("__zhutianApp.settings.get('floatLilith')") == 'off' and not page.evaluate("__zhutianApp.float.active") and '扩展' in toast, toast[:160])
    page.evaluate("()=>document.querySelector('#zhutian-covenant-terminal-settings [data-act=float]')?.click()"); page.wait_for_timeout(900)
    ok('float: drawer 「显示悬浮莉莉丝」 brings her back', page.evaluate("__zhutianApp.float.active") and page.evaluate("__zhutianApp.settings.get('floatLilith')") in ('on', 'auto'))
    page.evaluate("async()=>{__zhutianApp.settings.set('floatLilith','auto');try{const m=await import('/script.js');await m.saveSettings();}catch{await new Promise(r=>setTimeout(r,2500));}}"); page.wait_for_timeout(500)

    # ---------- 一键关闭插件 ----------
    page.evaluate("()=>{__zhutianApp.hub.open('set')}"); page.wait_for_timeout(900)
    row = hub(page, "const b=sh.querySelector('#page-set [data-act=\"plugin-off\"]');return b?{tier:b.closest('details')?.dataset.tier||'common',text:b.closest('.zt-row')?.innerText||''}:null")
    ok('plugin-off: 设置 → 插件开关 → 一键关闭插件 (常用)', row and row['tier'] == 'common' and '管理扩展' in row['text'], json.dumps(row, ensure_ascii=False)[:160])
    hub(page, "sh.querySelector('#page-set [data-act=\"plugin-off\"]').click()")
    text = popup(page)
    ok('plugin-off: asks first; the popup says how to turn it back on', '管理扩展' in text and '保留' in text, text[:160].replace('\n', ' '))
    page.wait_for_timeout(700); page.screenshot(path=str(SHOTS / 'fb-plugin-off-confirm.png'))
    popup_click(page, 'cancel'); page.wait_for_timeout(500)
    still = page.evaluate("()=>!!globalThis.__zhutianApp && !(SillyTavern.getContext().extensionSettings.disabledExtensions||[]).some(n=>n.includes('zhutian'))")
    ok('plugin-off: 取消 keeps the plugin on', still)
    hub(page, "sh.querySelector('#page-set [data-act=\"plugin-off\"]').click()")
    popup(page)
    with page.expect_navigation(timeout=60000):
        popup_click(page, 'ok')
    wait_host(page); page.wait_for_timeout(5000)
    st = page.evaluate("()=>({app:!!globalThis.__zhutianApp,disabled:SillyTavern.getContext().extensionSettings.disabledExtensions||[],float:!!document.getElementById('zhutian-lilith-float')})")
    ok('plugin-off: OK → SillyTavern lists it as disabled, the page reloaded without the plugin', not st['app'] and not st['float'] and any(n.endswith('zhutianxitongchajianban') for n in st['disabled']), json.dumps(st, ensure_ascii=False))
    page.screenshot(path=str(SHOTS / 'fb-plugin-off-after.png'))
    # turn it back on the way a user does (SillyTavern's own enableExtension = the 管理扩展 switch)
    page.evaluate(ENABLE)
    page.wait_for_timeout(1000)
    Z.reboot(page)
    back = page.evaluate("()=>({app:!!globalThis.__zhutianApp,disabled:(SillyTavern.getContext().extensionSettings.disabledExtensions||[]).filter(n=>n.includes('zhutian'))})")
    ok('plugin-off: re-enabled from 管理扩展, the plugin starts again', back['app'] and not back['disabled'], json.dumps(back, ensure_ascii=False))
    # leave the shared test host as we found it (later suites expect no presets / routes)
    page.evaluate("async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{delete v['诸天系统_API路由'];return v;},{type:'global'});try{const m=await import('/script.js');await m.saveSettings();}catch{await new Promise(r=>setTimeout(r,2500));}}")
    page.wait_for_timeout(800)
    ok('no page errors', not errs, ' | '.join(errs[:3]))
    ctx.close()


ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
def phone_close(browser):
    """Phone: a real touch long-press (CDP touch events → pointerType 'touch') picks her up, the bin shows, dragging
    onto it and lifting the finger asks first with the 扩展-panel hint; confirming closes her."""
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, user_agent=ANDROID_UA)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    Z.boot(page)
    page.evaluate("()=>{__zhutianApp.hub.close?.()}"); page.wait_for_timeout(1500)
    page.evaluate("()=>{__zhutianApp.settings.set('floatLilith','on');__zhutianApp.settings.set('floatPos',{x:150,y:330,edge:'',tucked:false});__zhutianApp.float.tempTuck=false;__zhutianApp.float.sync();}"); page.wait_for_timeout(1500)
    page.evaluate("()=>__zhutianApp.float.quiet?.()"); page.wait_for_timeout(600)
    page.evaluate("()=>{for(const t of document.querySelectorAll('#toast-container .toast'))t.remove();}")
    box = page.evaluate("()=>{const r=__zhutianApp.float.fig.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height*0.45)}}")
    cdp = ctx.new_cdp_session(page)
    def touch(kind, x=None, y=None):
        pts = [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'id': 1, 'radiusX': 4, 'radiusY': 4, 'force': 1}]
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': pts})
    touch('touchStart', box['x'], box['y']); page.wait_for_timeout(250)
    early = page.evaluate("()=>__zhutianApp.float.bin.classList.contains('show')")
    page.wait_for_timeout(450)
    held = page.evaluate("()=>({bin:__zhutianApp.float.bin.classList.contains('show'),drag:__zhutianApp.float.el.classList.contains('drag')})")
    ok('phone float: a finger resting < 0.4 s does nothing; a long press picks her up and shows 「拖到这里关闭悬浮窗」', not early and held['bin'] and held['drag'], json.dumps([early, held]))
    b = page.evaluate("()=>{const r=__zhutianApp.float.bin.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:r.width}}")
    for i in range(1, 13):
        touch('touchMove', round(box['x'] + (b['x'] - box['x']) * i / 12), round(box['y'] + (b['y'] - box['y']) * i / 12)); page.wait_for_timeout(30)
    page.wait_for_timeout(150)
    hot = page.evaluate("()=>__zhutianApp.float.bin.classList.contains('hot')")
    page.screenshot(path=str(SHOTS / 'fb-phone-float-bin.png'))
    ok('phone float: the bin sits at the bottom of the screen (SillyTavern phone layout: <html> transformed, height 0) and lights up under the finger', hot and 844 * 0.8 < b['y'] < 844 - 20 and b['x'] - b['w'] / 2 >= 0, json.dumps(b))
    touch('touchEnd')
    text = popup(page)
    page.wait_for_timeout(600); page.screenshot(path=str(SHOTS / 'fb-phone-float-confirm.png'))
    ok('phone float: lifting the finger on it asks first, with the 扩展 → 打开诸天终端 hint', '扩展' in text and '打开诸天终端' in text, text[:160].replace('\n', ' '))
    popup_click(page, 'ok'); page.wait_for_timeout(900)
    toast = page.evaluate("()=>[...document.querySelectorAll('#toast-container .toast')].map(t=>t.innerText).join(' | ')")
    ok('phone float: confirmed → closed, toast repeats where the console is', page.evaluate("__zhutianApp.settings.get('floatLilith')") == 'off' and not page.evaluate("__zhutianApp.float.active") and '扩展' in toast, toast[:160])
    page.evaluate("async()=>{__zhutianApp.settings.set('floatLilith','auto');try{const m=await import('/script.js');await m.saveSettings();}catch{await new Promise(r=>setTimeout(r,2500));}}"); page.wait_for_timeout(500)
    # same phone-layout trap (<html> transformed, height 0) for the other fixed boxes outside the terminal
    pos = page.evaluate("""async()=>{const o=__zhutianApp.fx.host();if(!o)return null;o.root.innerHTML='<div style="height:80px">x</div>';await new Promise(r=>setTimeout(r,500));const f=o.root.getBoundingClientRect();o.root.innerHTML='';
      const H=document.createElement('div');document.body.append(H);const sh=H.attachShadow({mode:'open'});sh.innerHTML='<link rel=stylesheet href="'+__zhutianApp.base+'styles/hub.css"><button class="zt-fb-entry">e</button>';await new Promise(r=>setTimeout(r,600));const e=sh.querySelector('button').getBoundingClientRect();H.remove();
      return {fx:[Math.round(f.top),Math.round(f.bottom)],entry:[Math.round(e.top),Math.round(e.bottom)],ih:innerHeight}}""")
    ok('phone: 演出 cards outside the terminal and the fallback entry button sit on screen near the bottom', pos and pos['ih'] * 0.6 < pos['fx'][0] and pos['fx'][1] < pos['ih'] and pos['ih'] * 0.6 < pos['entry'][0] and pos['entry'][1] < pos['ih'], json.dumps(pos))
    ok('phone float: no page errors', not errs, ' | '.join(errs[:3]))
    ctx.close()

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=['--no-sandbox'])
    try: run(browser); phone_close(browser)
    except Exception as e:
        ok('suite ran to the end', False, repr(e)[:400])
    finally: browser.close()
passed = sum(1 for r in results if r[1]); print(f'{passed}/{len(results)} passed', flush=True)
sys.exit(0 if passed == len(results) else 1)
