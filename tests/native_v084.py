"""0.8.4 acceptance (isolated SillyTavern + mock model only; no real keys, no user data):
  * 连接 page in the terminal = the one API form (status bar + Lilith); the original v1.1 form is hidden; models are
    fetched through SillyTavern when the provider blocks browsers (no-CORS mock), and a failed relay returns a readable
    error instead of a browser "截断/Failed to fetch"; chat requests stream (mock sees stream:true)
  * the Lilith private chat survives a reply slower than the original fixed 60 s abort (timeout setting 180 s)
  * 强力模块: a fresh worldbook ships 神豪挥霍 / 诸天打手 off, 外挂管理 can switch them, an old all-on book gets a
    one-click 平衡 button, the engine hides the 神豪 card while the module is off
  * 配色方案: palettes recolour shell + engine, xianxia is no longer green
  * beautification compatibility: a foreign renderer that replaces a code block with an iframe card, a JS beautifier
    that edits a paragraph in place, and an ST regex beautifier all survive the plugin's own floor render (no
    duplicates, original order)
  * phone 390×844, real touch: with the terminal open, tapping the 私聊 button in the header (docked launcher) opens the private chat on top
    and the terminal stays open, five times in a row
Usage: python3 tests/native_v084.py --isolated-test-only --base-url http://127.0.0.1:8019 [--skip-slow]
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
ap.add_argument('--mock-nocors', default='http://127.0.0.1:5002/v1')
ap.add_argument('--nocors-log', default='/var/tmp/qa/mock-nocors.jsonl')
ap.add_argument('--log', default='/var/tmp/qa/mock.jsonl')
ap.add_argument('--shots', default='/var/tmp/qa/shots084')
ap.add_argument('--skip-slow', action='store_true', help='skip the ~75 s slow-reply private chat check')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
WB = '诸天万界最强系统'

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def skip(name, why): print(f'SKIP {name} — {why}', flush=True)
def js(page, body, arg=None): return page.evaluate('(async(arg)=>{const app=__zhutianApp,h=app.hub,sr=h.shadow;' + body + '})', arg)
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'))
def log_lines(path):
    try: return [json.loads(l) for l in Path(path).read_text(encoding='utf8').splitlines() if l.strip()]
    except FileNotFoundError: return []

def push_floors(page, floors):
    page.evaluate('''async floors=>{const c=SillyTavern.getContext();
      for(const mes of floors) c.chat.push({name:c.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes,extra:{},swipe_id:0,swipes:[mes]});
      await c.saveChat(); await c.reloadCurrentChat();}''', floors)
    page.wait_for_timeout(3000)

# ---------------------------------------------------------------- API
def api_suite(page):
    js(page, "h.open('api');await new Promise(r=>setTimeout(r,1200));")
    r = js(page, """const p=sr.getElementById('page-api');const box=p?.querySelector(':scope > .zt-api-inline');
      const orig=[...(p?.children||[])].filter(n=>n!==box&&!n.matches('style'));
      return {box:!!box,form:!!box?.querySelector('form [data-act=models]'),origVisible:orig.filter(n=>n.offsetParent!==null&&n.getClientRects().length).map(n=>n.id||n.className).slice(0,5),
        unified:p?.classList.contains('zt-api-unified')}""")
    ok('连接 page shows the one API form (状态栏 + 莉莉丝)', r['box'] and r['form'] and r['unified'], json.dumps(r, ensure_ascii=False))
    ok('…the original v1.1 connection form is no longer shown (no second API place)', not r['origVisible'], json.dumps(r['origVisible'], ensure_ascii=False))
    # fill the form like a user: a provider that blocks browsers (no CORS)
    js(page, """const f=sr.querySelector('#page-api .zt-api-inline form');f.querySelector('input[value=custom]').click();
      f.url.value=arg;f.key.value='sk-qa-only';f.model.value='';f.dispatchEvent(new Event('change'));""", args.mock_nocors)
    js(page, "sr.querySelector('#page-api [data-act=models]').click();")
    page.wait_for_function("(()=>{const o=__zhutianApp.hub.shadow.querySelector('#page-api [data-out]');return o&&/共 \\d+ 个模型|失败/.test(o.textContent)})()", timeout=30000)
    out = js(page, "return sr.querySelector('#page-api [data-out]').textContent")
    ok('拉取模型 works against a provider that blocks browsers (relayed through SillyTavern, no 截断 error)', '共 2 个模型' in out, out)
    shot(page, '01-api-models')
    js(page, "const f=sr.querySelector('#page-api .zt-api-inline form');f.model.value='mock-zt';sr.querySelector('#page-api [data-act=test]').click();")
    page.wait_for_function("(()=>{const o=__zhutianApp.hub.shadow.querySelector('#page-api [data-out]');return o&&/连接正常|测试失败/.test(o.textContent)})()", timeout=60000)
    out = js(page, "return sr.querySelector('#page-api [data-out]').textContent")
    ok('测试连接 succeeds through the SillyTavern relay', '连接正常' in out and '经酒馆服务器转发' in out, out)
    js(page, "sr.querySelector('#page-api [data-act=save]').click();await new Promise(r=>setTimeout(r,1500));")
    r = js(page, """const p=sr.getElementById('page-api');return {msg:p.querySelector('[data-out]')?.textContent||'',warn:/不一致/.test(p.textContent),
      st:app.settings.get('api')||null,lines:[...p.querySelectorAll('.zt-api-inline form > div:nth-of-type(3) > div')].map(d=>d.textContent)}""")
    ok('保存 writes both copies: no 两处配置不一致 warning afterwards', '已保存' in r['msg'] and not r['warn'], json.dumps(r, ensure_ascii=False)[:300])
    shot(page, '02-api-saved')
    # the shim the original Lilith code uses: streaming + readable errors
    n0 = len(log_lines(args.nocors_log))
    r = js(page, """const f=app.assistant.shimFetch;if(!f)return {missing:true};
      const res=await f(arg+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer sk-qa-only'},body:JSON.stringify({model:'mock-zt',messages:[{role:'user',content:'回复两个字：成功'}],max_tokens:16})});
      const j=await res.json().catch(()=>null);return {status:res.status,text:j?.choices?.[0]?.message?.content||''}""", args.mock_nocors)
    new = log_lines(args.nocors_log)[n0:]
    ok('Lilith requests reach a no-CORS provider via the relay and come back as a normal JSON reply', r.get('status') == 200 and bool(r.get('text')), json.dumps(r, ensure_ascii=False)[:200])
    ok('…and are sent as a stream (keeps long replies alive through proxies: the old 502 / timeout cause)', any(x.get('body', {}).get('stream') is True for x in new), json.dumps([x.get('body', {}).get('stream') for x in new]))
    n0 = len(log_lines(args.log))
    r = js(page, """const res=await app.assistant.shimFetch(arg+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer sk-qa-only'},body:JSON.stringify({model:'mock-zt',messages:[{role:'user',content:'你好'}]})});
      const j=await res.json().catch(()=>null);return {status:res.status,text:j?.choices?.[0]?.message?.content||''}""", args.mock)
    new = log_lines(args.log)[n0:]
    ok('direct (CORS-friendly) provider: streamed too, reply assembled into the JSON the original expects', r.get('status') == 200 and r.get('text', '').count('夜色压着城头') == 1 and r.get('text', '').rstrip().endswith('</ZhuTianPanel>') and any(x.get('body', {}).get('stream') is True for x in new), json.dumps(r, ensure_ascii=False)[:160])
    r = js(page, """try{const res=await app.assistant.shimFetch('http://127.0.0.1:5999/v1/models',{headers:{Authorization:'Bearer x'}});
      const j=await res.json().catch(()=>null);return {status:res.status,msg:j?.error?.message||''}}catch(e){return {threw:String(e?.message||e)}}""")
    ok('unreachable provider: a readable error response, not a thrown browser "Failed to fetch"', not r.get('threw') and r.get('status', 0) >= 400 and bool(r.get('msg')), json.dumps(r, ensure_ascii=False)[:240])
    js(page, "h.close();await new Promise(r=>setTimeout(r,900));")

def gear_suite(page):
    r = page.evaluate("""async()=>{const b=document.querySelector('#chat .zt-statusbar, #chat .zhutian-statusbar');
      const sb=[...document.querySelectorAll('#chat iframe')].find(f=>{try{return f.contentDocument?.querySelector('[data-zt-api], .zt-gear, #zt-gear')}catch{return false}});
      return {frame:!!sb}}""")
    # the gear lives inside the status-bar iframe; call the documented hook the gear uses
    r2 = js(page, "if(typeof app.statusbar?.openApi!=='function')return {fn:false};app.statusbar.openApi();await new Promise(r=>setTimeout(r,1200));return {fn:true,hub:h.isOpen,page:h.page,popup:!!document.getElementById('zt-api-center')?.open}")
    ok('status-bar gear → API opens the same 连接 page in the terminal (not a second form)', r2.get('fn') and ((r2.get('hub') and r2.get('page') == 'api') or r2.get('popup')), json.dumps(r2))
    js(page, "h.close();document.getElementById('zt-api-center')?.close();await new Promise(r=>setTimeout(r,900));")

# ---------------------------------------------------------------- slow private chat (timeout)
def slow_chat_suite(page):
    js(page, "app.settings.set('apiTimeout',180);")
    # point the assistant at the CORS-friendly mock, then send a slow message through the real private chat UI
    js(page, """h.open('api');await new Promise(r=>setTimeout(r,1000));const f=sr.querySelector('#page-api .zt-api-inline form');f.querySelector('input[value=custom]').click();
      f.url.value=arg;f.key.value='sk-qa-only';f.model.value='mock-zt';f.dispatchEvent(new Event('change'));sr.querySelector('#page-api [data-act=save]').click();await new Promise(r=>setTimeout(r,1500));""", args.mock)
    js(page, """const s=app.assistant.shadow;s.getElementById('header-avatar').click();await new Promise(r=>setTimeout(r,900));
      const i=s.getElementById('lc-input');i.value='慢速测试：请慢慢回答';i.dispatchEvent(new Event('input',{bubbles:true}));s.getElementById('lc-send').click();""")
    t0 = time.time(); got = ''; err = ''
    while time.time() - t0 < 110:
        page.wait_for_timeout(3000)
        st = js(page, "const s=app.assistant.shadow,p=s.getElementById('lc-panel');return {log:s.getElementById('lc-log')?.textContent||'',notice:s.getElementById('lc-notice')?.textContent||''}")
        if '慢速回复' in st['log']: got = st['log']; break
        if '超过' in st['notice'] or '取消' in st['notice']: err = st['notice']; break
    took = round(time.time() - t0)
    ok('private chat: a reply slower than the original fixed 60 s abort arrives (timeout setting 180 s), assembled exactly', bool(got) and took > 60 and '慢速回复：' + '流' * 10 in got and got.count('慢速回复') == 1, f'{took}s · ' + (err or got[-60:]))
    shot(page, '03-slow-private-chat')
    js(page, "app.assistant.shadow.getElementById('lc-close')?.click();h.close();await new Promise(r=>setTimeout(r,900));")

# ---------------------------------------------------------------- 强力模块
def modules_suite(page):
    js(page, """const c=SillyTavern.getContext();await fetch('/api/worldinfo/delete',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({name:arg})});
      try{(await import('/scripts/world-info.js')).worldInfoCache?.delete?.(arg);}catch{}   // raw delete bypasses ST's cache (0.8.5: stale book from a previous run)
      await c.updateWorldInfoList?.();await app.features.installWorldbook('none');""", WB)
    r = js(page, "const s=await app.features.moduleStates();return s.list.map(m=>[m.name,m.on])")
    d = dict(r)
    ok('fresh worldbook install: 神豪挥霍 and 诸天打手 start OFF, the other modules ON', d.get('神豪挥霍') is False and d.get('诸天打手') is False and all(v for k, v in d.items() if k not in ('神豪挥霍', '诸天打手')), json.dumps(d, ensure_ascii=False))
    # an old book from v1.1 / ≤0.8.3: everything on → recommendation + one click
    js(page, "await app.features.setModules({'08｜核心｜神豪挥霍':true,'13｜外挂｜诸天打手':true});await app.plugins.refreshModules();h.open('plugmgr');await new Promise(r=>setTimeout(r,1500));")
    r = js(page, "const b=sr.querySelector('[data-mods-balance]');return {btn:!!b,label:b?.textContent||'',rows:sr.querySelectorAll('[data-module]').length}")
    ok('old all-on book: 外挂管理 shows 强力模块 switches and a 一键平衡 button', r['btn'] and r['rows'] >= 6 and '神豪挥霍' in r['label'], json.dumps(r, ensure_ascii=False))
    shot(page, '04-modules-recommend')
    js(page, "sr.querySelector('[data-mods-balance]').click();await new Promise(r=>setTimeout(r,2000));")
    d = dict(js(page, "const s=await app.features.moduleStates();return s.list.map(m=>[m.name,m.on])"))
    ok('一键平衡 switches 神豪挥霍 + 诸天打手 off in the worldbook (saved)', d.get('神豪挥霍') is False and d.get('诸天打手') is False, json.dumps(d, ensure_ascii=False))
    # a single switch, like a user
    js(page, """const i=sr.querySelector('[data-module="08｜核心｜神豪挥霍"]');i.click();await new Promise(r=>setTimeout(r,2000));""")
    d = dict(js(page, "const s=await app.features.moduleStates();return s.list.map(m=>[m.name,m.on])"))
    raw = js(page, "const b=await SillyTavern.getContext().loadWorldInfo(arg);const e=Object.values(b.entries).find(x=>x.comment==='08｜核心｜神豪挥霍');return {disable:e?.disable}", WB)
    ok('switch 神豪挥霍 on in 外挂管理 → the worldbook entry is enabled (disable=false)', d.get('神豪挥霍') is True and raw.get('disable') is False, json.dumps(raw))
    shot(page, '05-modules-switch')
    js(page, """const i=sr.querySelector('[data-module="08｜核心｜神豪挥霍"]');if(i?.checked){i.click();await new Promise(r=>setTimeout(r,2000));}""")
    js(page, "h.open('ov');await new Promise(r=>setTimeout(r,2500));")
    r = js(page, "const d=h.engineFrame?.contentDocument;const c=d?[...d.querySelectorAll('.shenhao-card')]:[];return {n:c.length,off:c.map(x=>x.getAttribute('data-zt-off')),vis:c.filter(x=>x.getClientRects().length&&getComputedStyle(x).display!=='none').length}")
    if r['n']: ok('module off → the engine hides the 神豪 card', all(o == '1' for o in r['off']) and r['vis'] == 0, json.dumps(r))
    else: skip('engine 神豪 card hidden', 'this engine build has no .shenhao-card on the overview page')
    p = js(page, "app.plugins.lastPrompt=null;app.plugins.syncPrompt();return String(app.plugins.lastPrompt||'')")
    ok('the AI is told which modules are not loaded (未装载 list in the plugin prompt)', '神豪挥霍' in p and '诸天打手' in p, p[:160])
    js(page, "h.close();await new Promise(r=>setTimeout(r,900));")

# ---------------------------------------------------------------- 配色方案
def palette_suite(page):
    r = js(page, "const sel=[...sr.querySelectorAll('select')];h.open('set');await new Promise(r=>setTimeout(r,1000));const s=[...sr.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value==='sakura'));return {sel:!!s,n:s?s.options.length:0}")
    ok('设置 has a 配色方案 select (自动 + 7 palettes)', r['sel'] and r['n'] == 8, json.dumps(r))
    js(page, "app.settings.set('palette','auto');app.settings.set('world',{...(app.settings.get('world')||{}),theme:'xianxia'});await new Promise(r=>setTimeout(r,800));h.open('ov');await new Promise(r=>setTimeout(r,2200));")
    r = js(page, """const host=sr.host,cs=getComputedStyle(sr.querySelector('dialog')||host);const d=h.engineFrame?.contentDocument;
      return {world:host.getAttribute('data-zt-world'),accent:cs.getPropertyValue('--accent').trim(),eng:d?getComputedStyle(d.documentElement).getPropertyValue('--accent').trim():''}""")
    ok('仙侠 world default colours are 墨玉金 now (gold accent, not green)', r['world'] == 'xianxia' and r['accent'].lower() in ('#d4b46c',) , json.dumps(r))
    shot(page, '06-xianxia-inkjade')
    seen = {}
    for pid, accent in [('sakura', '#f09ab8'), ('celadon', '#86bfd0'), ('frost', '#8fb4ff'), ('inkgold', '#d9b56a')]:
        js(page, f"app.settings.set('palette','{pid}');await new Promise(r=>setTimeout(r,900));")
        seen[pid] = js(page, """const host=sr.host,cs=getComputedStyle(sr.querySelector('dialog')||host);const d=h.engineFrame?.contentDocument;
          return {pal:host.getAttribute('data-zt-palette'),world:host.getAttribute('data-zt-world'),accent:cs.getPropertyValue('--accent').trim().toLowerCase(),
            eng:d?d.documentElement.getAttribute('data-zt-palette'):null}""")
        seen[pid]['want'] = accent
        if pid == 'sakura': shot(page, '07-palette-sakura')
        if pid == 'celadon': shot(page, '08-palette-celadon')
    ok('a palette recolours the terminal and the engine page, world decorations stay', all(v['pal'] == k and v['accent'] == v['want'] and v['eng'] == k and v['world'] == 'xianxia' for k, v in seen.items()), json.dumps(seen))
    js(page, "app.settings.set('world',{...(app.settings.get('world')||{}),theme:'default'});await new Promise(r=>setTimeout(r,900));")
    r = js(page, "const host=sr.host,cs=getComputedStyle(sr.querySelector('dialog')||host);return {world:host.getAttribute('data-zt-world'),accent:cs.getPropertyValue('--accent').trim().toLowerCase()}")
    ok('palette on the default world also applies (default → plain surfaces)', r['world'] == 'plain' and r['accent'] == '#d9b56a', json.dumps(r))
    shot(page, '09-palette-default-world')
    js(page, "app.settings.set('palette','auto');app.settings.set('world',{...(app.settings.get('world')||{}),theme:'auto'});await new Promise(r=>setTimeout(r,600));h.close();await new Promise(r=>setTimeout(r,900));")

# ---------------------------------------------------------------- beautification compatibility
FOREIGN = r'''(()=>{const c=SillyTavern.getContext();if(window.__qaBeauty)return;window.__qaBeauty=true;
  const run=id=>{const t=document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);if(!t)return;
    // 1) an iframe card renderer (小白X / 前端卡 style): replaces the code block with its own wrapper + iframe
    for(const pre of t.querySelectorAll('pre')){if(!/QA-CARD/.test(pre.textContent))continue;const w=document.createElement('div');w.className='qa-card-render';
      const f=document.createElement('iframe');f.srcdoc='<body style="margin:0;background:#224;color:#fff"><b>QA-CARD</b><script>document.body.dataset.ok=1<\/script></body>';f.style.height='40px';w.append(f);pre.replaceWith(w);}
    // 2) a JS beautifier editing a paragraph in place — late (300 ms, after the plugin's own floor pass)
    setTimeout(()=>{const t=document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);if(t)for(const p of t.querySelectorAll('p')){if(/QA-BEAUTY/.test(p.textContent)&&!p.querySelector('.qa-bx')){const s=document.createElement('span');s.className='qa-bx';s.style.color='#f6c';s.append(...p.childNodes);p.append(s);p.classList.add('qa-beautified');}}},300);};
  c.eventSource.on(c.eventTypes.CHARACTER_MESSAGE_RENDERED,id=>run(id));c.eventSource.on(c.eventTypes.MESSAGE_UPDATED,id=>run(id));
  window.__qaRun=run;})()'''

def beauty_suite(page):
    # 3) an ST regex beautifier (display only)
    page.evaluate("""async()=>{const c=SillyTavern.getContext();const rs=c.extensionSettings.regex||(c.extensionSettings.regex=[]);
      if(!rs.some(x=>x.scriptName==='qa-beauty'))rs.push({id:'qa-beauty-0001',scriptName:'qa-beauty',findRegex:'/「(.+?)」/g',replaceString:'<span class="qa-quote">「$1」</span>',trimStrings:[],placement:[2],disabled:false,markdownOnly:true,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null});
      c.saveSettingsDebounced?.();}""")
    page.evaluate(FOREIGN)
    card = '```html\n<div>QA-CARD 卡片</div>\n```'
    mes = f'第五幕。QA-BEAUTY 夜风很轻。\n\n{card}\n\n他低声道：「走吧。」\n\n莉莉丝：“宿主大人，小心脚下。”\n\n' + Z.PANEL(1400, '40/100', '夜行')
    # exactly SillyTavern's new-message path: add the block, then CHARACTER_MESSAGE_RENDERED (what renderers listen to)
    page.evaluate('''async mes=>{const c=SillyTavern.getContext();const m={name:c.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes,extra:{},swipe_id:0,swipes:[mes]};
      c.chat.push(m);c.addOneMessage(m);await c.eventSource.emit(c.eventTypes.CHARACTER_MESSAGE_RENDERED,c.chat.length-1,'normal');await c.saveChat();}''', mes)
    page.wait_for_timeout(1800)
    probe = """async(rebuild)=>{const app=__zhutianApp,last=[...document.querySelectorAll('#chat .mes[mesid]')].at(-1),t=last.querySelector('.mes_text');
      const w=t.querySelector('.qa-card-render'),f=w?.querySelector('iframe');let loads=0;if(f){f.addEventListener('load',()=>loads++);try{f.contentWindow.__mark=9}catch{}}
      if(rebuild){app.statusbar.rebuild();await new Promise(r=>setTimeout(r,1200));}
      const w2=t.querySelector('.qa-card-render');const kids=[...t.children].filter(n=>!n.hidden);
      const idx=sel=>kids.findIndex(n=>n.matches(sel)||n.querySelector(sel));
      return {card:t.querySelectorAll('.qa-card-render').length,same:!rebuild||w2===w,loads,mark:(()=>{try{return w2?.querySelector('iframe')?.contentWindow?.__mark}catch{return null}})(),
        rawPre:[...t.querySelectorAll('pre')].filter(p=>/QA-CARD/.test(p.textContent)).length,
        beauty:t.querySelectorAll('.qa-bx').length,beautyP:[...t.querySelectorAll('p')].filter(p=>/QA-BEAUTY/.test(p.textContent)).length,
        quote:t.querySelectorAll('.qa-quote,.custom-qa-quote').length,voice:t.querySelectorAll('.zt-lilith-voice,[data-lilith-voice]').length,ours:!!t.querySelector(':scope > .zt-render-mark'),
        order:[idx('.qa-bx'),idx('.qa-card-render'),idx('.qa-quote,.custom-qa-quote'),idx('.zt-lilith-voice,[data-lilith-voice]')]}}"""
    a = page.evaluate(probe, False)
    ok('first plugin render keeps the foreign iframe card (one card, raw code block not duplicated)', a['card'] == 1 and a['rawPre'] == 0 and a['ours'], json.dumps(a))
    ok('…keeps the JS beautifier\'s edit to the paragraph (one paragraph, beautified)', a['beauty'] == 1 and a['beautyP'] == 1, json.dumps(a))
    ok('…shows the ST regex beautifier output (display-only regex)', a['quote'] == 1, json.dumps(a))
    ok('…in the original order with the Lilith voice card', a['voice'] == 1 and a['order'] == sorted(a['order']) and -1 not in a['order'], json.dumps(a['order']))
    b = page.evaluate(probe, True)
    ok('plugin re-render: the iframe card node is reused (not reloaded), nothing duplicated, order unchanged', b['card'] == 1 and b['same'] and b['loads'] == 0 and b['mark'] == 9 and b['beauty'] == 1 and b['beautyP'] == 1 and b['quote'] == 1 and b['voice'] == 1 and b['order'] == sorted(b['order']) and -1 not in b['order'], json.dumps(b))
    shot(page, '10-beautified-floor')
    page.evaluate("""()=>{const c=SillyTavern.getContext();const rs=c.extensionSettings.regex||[];const i=rs.findIndex(x=>x.scriptName==='qa-beauty');if(i>=0)rs.splice(i,1);c.saveSettingsDebounced?.();}""")

# ---------------------------------------------------------------- phone: 私聊 inside the terminal
def phone_suite(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda x: x.accept())
    Z.boot(page); Z.open_chat(page)
    page.evaluate("__zhutianApp.settings.set('hubOutsideClose','auto')")
    fails = []
    for n in range(5):
        js(page, "h.open('ov');await new Promise(r=>setTimeout(r,1400));")
        # phones: the launcher docks into the terminal header and becomes the 私聊 button (title 莉莉丝 · 点击进入私聊)
        av = js(page, "const s=app.assistant.shadow;const a=[s.getElementById('header-avatar'),s.getElementById('entry')].find(e=>e&&e.getBoundingClientRect().width);const r=a?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2,id:a.id,title:a.title}:null")
        if not av: fails.append(f'#{n}: no 私聊 button in the header'); break
        if n == 0: print('   私聊 button:', av.get('id'), av.get('title'))
        page.touchscreen.tap(av['x'], av['y']); page.wait_for_timeout(1300)
        st = js(page, """const s=app.assistant.shadow,p=s.getElementById('lc-panel');const r=p?.getBoundingClientRect();
          const top=r&&r.width?s.elementFromPoint(r.left+r.width/2,r.top+Math.min(r.height-10,r.height/2)):null;
          return {hub:h.isOpen,panel:!!p&&!p.hidden&&!!r&&r.height>120,onTop:!!top&&p.contains(top),h:r?Math.round(r.height):0}""")
        if n == 0: shot(page, '11-phone-private-chat')
        if not (st['hub'] and st['panel'] and st['onTop']): fails.append(f'#{n}: ' + json.dumps(st))
        # type in it (touch) and leave through 返回
        inp = js(page, "const r=app.assistant.shadow.getElementById('lc-input')?.getBoundingClientRect();return r&&r.width?{x:r.left+20,y:r.top+r.height/2}:null")
        if inp: page.touchscreen.tap(inp['x'], inp['y']); page.wait_for_timeout(300)
        if not js(page, "return h.isOpen"): fails.append(f'#{n}: terminal closed after tapping the chat input')
        js(page, "const s=app.assistant.shadow;(s.getElementById('lc-back')||s.getElementById('lc-close'))?.click();await new Promise(r=>setTimeout(r,700));")
        st2 = js(page, "const p=app.assistant.shadow.getElementById('lc-panel');return {hub:h.isOpen,panel:!!p&&!p.hidden}")
        if not st2['hub'] or st2['panel']: fails.append(f'#{n} after 返回: ' + json.dumps(st2))
        js(page, "h.close();await new Promise(r=>setTimeout(r,1100));")
    ok('phone, real touch: 私聊 from the open terminal opens the chat on top and the terminal stays open (5/5)', not fails, '; '.join(fails)[:400])
    ok('phone: no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1400, 'height': 900}); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda x: x.accept())
    Z.boot(page); Z.setup_chat(page)
    for name, fn in [('api', api_suite), ('gear', gear_suite), ('modules', modules_suite), ('palette', palette_suite), ('beauty', beauty_suite)]:
        try: fn(page)
        except Exception as e: ok(f'{name} suite ran without exceptions', False, str(e)[:400]); shot(page, f'zz-error-{name}')
    if args.skip_slow: skip('slow private chat (> 60 s)', '--skip-slow')
    else:
        try: slow_chat_suite(page)
        except Exception as e: ok('slow chat suite ran without exceptions', False, str(e)[:400])
    ok('desktop: no page errors', not errs, '; '.join(errs)[:300])
    page.close()
    try: phone_suite(browser)
    except Exception as e: ok('phone suite ran without exceptions', False, str(e)[:400])
    browser.close()

passed = sum(1 for _, c, _ in results if c)
print(f'\n{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
