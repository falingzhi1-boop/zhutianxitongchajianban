"""0.8.2 acceptance (isolated SillyTavern + mock model only):
  * character-card status bars: a Tavern Helper render wrapper (div.TH-render + iframe) in a floor survives the
    plugin's floor re-render (same node, iframe not reloaded); with the real Tavern Helper installed (optional), the
    card's front-end status bars render with the plugin on — also on floors that carry a Lilith voice line / 诸天 block
  * worldbook: one-click unbind from cards (primary + extra), global and the open chat; restore; the extension
    `disable` hook unbinds automatically (1.17+), the next start tells the user once
  * floating Lilith on a phone: replaces the launcher, tap opens the terminal, long-press drag to the edge tucks her
    (saved), tap the peek brings her out, double tap pokes, her lines pop up next to her while the portrait is hidden
Usage: python3 tests/native_v082.py --isolated-test-only --base-url http://127.0.0.1:8019
"""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / 'qa'))
import zt_common as Z
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--isolated-test-only', action='store_true', required=True)
ap.add_argument('--base-url', default='http://127.0.0.1:8019')
ap.add_argument('--mock', default='http://127.0.0.1:5001/v1')
ap.add_argument('--shots', default='/var/tmp/qa/shots082')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
WB = '诸天万界最强系统'
EXT = 'third-party/zhutianxitongchajianban'

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def skip(name, why): print(f'SKIP {name} — {why}', flush=True)
def js(page, body): return page.evaluate('(async()=>{const app=__zhutianApp,h=app.hub,sr=h.shadow;' + body + '})()')
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'))
def fl(page, body): return page.evaluate("(()=>{const f=__zhutianApp.float,sh=document.getElementById('zhutian-lilith-float').shadowRoot,el=sh.querySelector('.fl');" + body + "})()")

def push_floors(page, floors):
    page.evaluate('''async floors=>{const c=SillyTavern.getContext();
      for(const mes of floors) c.chat.push({name:c.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes,extra:{},swipe_id:0,swipes:[mes]});
      await c.saveChat(); await c.reloadCurrentChat();}''', floors)
    page.wait_for_timeout(3000)

CARD_SB = '```html\n<!DOCTYPE html><html><body style="margin:0;background:#123;color:#fff"><div style="padding:10px">卡片状态栏 HP {hp}</div><script>document.body.dataset.ok=1</script></body></html>\n```'

def statusbar_suite(page):
    Z.setup_chat(page)
    th = page.evaluate('!!globalThis.TavernHelper')
    push_floors(page, [f'第四幕。莉莉丝：“看我的。”\n\n{CARD_SB.format(hp=90)}\n\n' + Z.PANEL(1300, '31/100', '引气入体')])
    # --- a foreign render wrapper (what Tavern Helper inserts) survives our re-render ---
    r = page.evaluate('''async()=>{const app=__zhutianApp,last=[...document.querySelectorAll('#chat .mes[mesid]')].at(-1),t=last.querySelector('.mes_text');
      let w=t.querySelector('div.TH-render');
      if(!w){const pre=t.querySelector('pre');w=document.createElement('div');w.className='TH-render';pre.replaceWith(w);w.append(pre);
        const f=document.createElement('iframe');f.srcdoc='<body>x</body>';w.append(f);await new Promise(r=>f.onload=r);}
      const f=w.querySelector('iframe');let loads=0;f.addEventListener('load',()=>loads++);const win=f.contentWindow;win.__mark=7;
      app.statusbar.rebuild();await new Promise(r=>setTimeout(r,900));
      const w2=t.querySelector('div.TH-render');
      return {same:w2===w,connected:w.isConnected,loads,mark:f.contentWindow?.__mark,voice:!!t.querySelector('.zt-lilith-voice,[data-lilith-voice]'),chip:!!t.querySelector('[data-floor]'),
        order:[...t.children].map(n=>n.className||n.tagName).join('|').slice(0,200),ours:!!t.querySelector(':scope > .zt-render-mark')}}''')
    ok('card status bar wrapper (div.TH-render) is kept by the plugin re-render: same node, iframe not reloaded', r['same'] and r['connected'] and r['loads'] == 0 and r['mark'] == 7, json.dumps(r, ensure_ascii=False))
    ok('the same floor still gets the Lilith voice card and the 诸天 floor chip', r['voice'] and r['chip'] and r['ours'], r['order'])
    if th:
        frames = page.evaluate("[...document.querySelectorAll('#chat .mes iframe')].filter(f=>{try{return f.contentDocument.body.dataset.ok==='1'}catch{return false}}).length")
        ok('real Tavern Helper: the card status bar renders with the plugin on (voice line + 诸天 block in the same floor)', frames >= 1, str(frames))
    else: skip('real Tavern Helper card status bar', 'Tavern Helper not installed in this host')
    shot(page, '01-floor-with-card-statusbar')

def unbind_suite(page):
    # three extra cards: two with the book as primary, one with it as an extra book; global on; open chat bound
    page.evaluate('''async(wb)=>{let c=SillyTavern.getContext();
      await c.saveWorldInfo(wb,{entries:{0:{uid:0,comment:'t',content:'t',key:[],constant:true}}},true).catch(()=>0);
      for(const name of ['解绑测试甲','解绑测试乙','解绑测试丙']){ if(c.characters.some(x=>x.name===name)) continue;
        const card={spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'QA',personality:'',scenario:'',first_mes:'hi',mes_example:'',creator_notes:'TEST',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'qa',character_version:'1',extensions:{}}};
        const fd=new FormData(); fd.append('avatar',new Blob([JSON.stringify(card)],{type:'application/json'}),'f.json'); fd.append('file_type','json');
        const h=c.getRequestHeaders(); delete h['Content-Type']; await fetch('/api/characters/import',{method:'POST',headers:h,body:fd}); }
      await c.getCharacters(); c=SillyTavern.getContext();
      const id=n=>c.characters.findIndex(x=>x.name===n);
      await c.writeExtensionField(id('解绑测试甲'),'world',wb); await c.writeExtensionField(id('解绑测试乙'),'world',wb);
      const wi=await import('/scripts/world-info.js'); await c.updateWorldInfoList?.();
      const av=c.characters[id('解绑测试丙')].avatar; wi.world_info.charLore=(wi.world_info.charLore||[]).filter(e=>e.name!==av); wi.world_info.charLore.push({name:av,extraBooks:[wb]});
      if(!wi.selected_world_info.includes(wb)) wi.onWorldInfoChange({state:'on',silent:'true'},wb);
      c.chatMetadata.world_info=wb; await c.saveMetadata();
    }''', WB)
    page.wait_for_timeout(800)
    b = js(page, "const r=await app.features.bindings();return {chars:r.chars.map(c=>c.name),extra:r.extra.length,global:r.global,chat:!!r.chat,total:r.total}")
    ok('bindings found: 2 cards + 1 extra book + global + open chat', set(b['chars']) >= {'解绑测试甲', '解绑测试乙'} and b['extra'] >= 1 and b['global'] and b['chat'], json.dumps(b, ensure_ascii=False))
    # settings → 一键解绑世界书 (confirm dialog accepted by the page handler)
    js(page, "h.open('set');return 1"); page.wait_for_timeout(700)
    js(page, "sr.querySelector('[data-act=\"wb-unbind\"]').click();return 1"); page.wait_for_timeout(2500)
    after = js(page, "const r=await app.features.bindings();return {total:r.total,auto:app.settings.get('worldbookAuto'),rec:app.settings.get('wbUnbound')}")
    rec = after['rec'] or {}
    ok('一键解绑: nothing bound any more, auto-binding switched off', after['total'] == 0 and after['auto'] is False, json.dumps({k: after[k] for k in ('total', 'auto')}))
    ok('the unbind is recorded (cards, extra, global, chat) for restore', len(rec.get('chars', [])) >= 2 and len(rec.get('extra', [])) >= 1 and rec.get('global') and rec.get('chat'), json.dumps({k: rec.get(k) for k in ('count', 'global', 'chat')}, ensure_ascii=False))
    srv = page.evaluate('''async()=>{const c=SillyTavern.getContext();const a=c.characters.find(x=>x.name==='解绑测试甲').avatar;
      const r=await fetch('/api/characters/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar_url:a})});const d=await r.json();return d?.data?.extensions?.world??null}''')
    ok('card change is saved on the server (character file re-read)', srv == '', repr(srv))
    exists = page.evaluate(f"(async()=>!!(await SillyTavern.getContext().loadWorldInfo({json.dumps(WB)}))?.entries)()")
    ok('the worldbook itself is not deleted', exists)
    r = js(page, "const r=await app.features.restoreWorldbook();const b=await app.features.bindings();return {r,total:b.total}")
    ok('恢复绑定 puts every binding back', r['total'] >= 4 and r['r']['count'] >= 4, json.dumps(r, ensure_ascii=False))
    js(page, "app.settings.set('worldbookAuto',true);h.close();return 1")

def disable_hook_suite(page):
    ver = page.evaluate("(async()=>{try{return (await (await fetch('/version')).json()).pkgVersion}catch{return ''}})()")
    major, minor = (int(x) for x in ver.split('.')[:2])
    if (major, minor) < (1, 17):
        skip('disable hook auto-unbind', f'SillyTavern {ver} has no extension hooks'); return
    page.evaluate("(async(ext)=>{const m=await import('/scripts/extensions.js');await m.disableExtension(ext,false);})(%s)" % json.dumps(EXT))
    page.wait_for_timeout(1500)
    r = page.evaluate('''async(wb)=>{const c=SillyTavern.getContext();const wi=await import('/scripts/world-info.js');
      return {cards:c.characters.filter(x=>x.data?.extensions?.world===wb).length,global:wi.selected_world_info.includes(wb),chat:c.chatMetadata.world_info===wb,
        rec:c.extensionSettings['zhutian-covenant-terminal']?.wbUnbound||null,app:!!globalThis.__zhutianApp,disabled:c.extensionSettings.disabledExtensions.includes('third-party/zhutianxitongchajianban')}}''', WB)
    rec = r['rec'] or {}
    ok('disable hook: extension stopped and the worldbook unbound everywhere', r['disabled'] and not r['app'] and r['cards'] == 0 and not r['global'] and not r['chat'], json.dumps({k: r[k] for k in ('cards', 'global', 'chat', 'app', 'disabled')}))
    ok('disable hook: record kept in extension settings (auto, not yet noticed)', rec.get('auto') is True and rec.get('noticed') is False and rec.get('count', 0) >= 4, json.dumps({k: rec.get(k) for k in ('auto', 'noticed', 'count')}))
    page.evaluate("(async(ext)=>{const m=await import('/scripts/extensions.js');await m.enableExtension(ext,false);await SillyTavern.getContext().saveSettings?.();})(%s)" % json.dumps(EXT))
    page.wait_for_timeout(1500)
    page.reload(); Z.boot(page); Z.open_chat(page); page.wait_for_timeout(3500)
    n = page.evaluate("__zhutianApp.settings.get('wbUnbound')")
    toast = page.evaluate("[...document.querySelectorAll('#toast-container .toast')].map(t=>t.textContent).join(' | ')")
    ok('after re-enabling: told once what was unbound (toast), record marked noticed', (n or {}).get('noticed') is True and '关闭插件时' in toast, toast[:160])
    r = js(page, "const r=await app.features.restoreWorldbook();return r")
    ok('restore after the disable hook', r['count'] >= 3, json.dumps(r))

def float_suite(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    Z.boot(page); Z.open_chat(page)
    page.evaluate("__zhutianApp.settings.set('floatPos',null);__zhutianApp.settings.set('floatLilith','auto');__zhutianApp.float.sync()"); page.wait_for_timeout(600)
    st = fl(page, "const e=__zhutianApp.assistant?.shadow?.getElementById('entry');return {vis:!el.hidden,rect:el.getBoundingClientRect().toJSON(),entry:e?getComputedStyle(e).display:'none',src:sh.querySelector('img.on')?.src||''}")
    ok('phone: floating Lilith shown (expression still), the old launcher pill hidden', st['vis'] and st['entry'] == 'none' and 'variants/neutral.webp' in st['src'], json.dumps(st)[:200])
    shot(page, '10-phone-float-default')
    # tap the peek (default: tucked at the left edge) → she comes out
    fl(page, "f.tap();return 1"); page.wait_for_timeout(700)
    out = fl(page, "return {tucked:el.dataset.tucked,x:el.getBoundingClientRect().left,bubble:sh.querySelector('.bubble').classList.contains('show'),text:sh.querySelector('.bubble span').textContent}")
    ok('tap the peek: she comes out of hiding and says so', out['tucked'] == 'false' and out['x'] >= 0 and out['bubble'], json.dumps(out, ensure_ascii=False))
    page.wait_for_timeout(2600)
    # tap → terminal opens
    fl(page, "f.tap();return 1"); page.wait_for_timeout(1500)
    ok('tap: opens the terminal', page.evaluate("__zhutianApp.hub.isOpen"))
    stage = page.evaluate("__zhutianApp.lilith.stageVisible()")
    said = page.evaluate("__zhutianApp.lilith.say('fx:reward',{items:'定海珠'},{force:true})")
    page.wait_for_timeout(500)
    b = fl(page, "return {show:sh.querySelector('.bubble').classList.contains('show'),text:sh.querySelector('.bubble span').textContent,tucked:el.dataset.tucked,top:getComputedStyle(el).zIndex}")
    ok('terminal open on a phone (portrait hidden): her reaction pops up next to the floating Lilith', not stage and said and b['show'] and '定海珠' in b['text'], json.dumps(b, ensure_ascii=False))
    shot(page, '11-phone-terminal-open-bubble')
    page.evaluate("__zhutianApp.hub.close()"); page.wait_for_timeout(1200)
    # broadcast while the terminal is closed → said right away (was: kept until the terminal opens)
    page.evaluate("__zhutianApp.lilith.heard='';__zhutianApp.lilith.readBroadcast({querySelector:()=>({textContent:'宿主大人，新任务来了！'})})"); page.wait_for_timeout(400)
    b = fl(page, "return {show:sh.querySelector('.bubble').classList.contains('show'),text:sh.querySelector('.bubble span').textContent}")
    ok('system broadcast with the terminal closed: shown in her bubble at once', b['show'] and '新任务' in b['text'], json.dumps(b, ensure_ascii=False))
    shot(page, '12-phone-broadcast')
    page.wait_for_timeout(4000)
    # long press + drag to the right edge (touch pointer events) → tucked right, saved
    box = fl(page, "const r=sh.querySelector('.fig').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}")
    page.evaluate('''async p=>{const sh=document.getElementById('zhutian-lilith-float').shadowRoot,fig=sh.querySelector('.fig');
      const ev=(t,x,y)=>fig.dispatchEvent(new PointerEvent(t,{bubbles:true,composed:true,pointerId:9,pointerType:'touch',clientX:x,clientY:y,isPrimary:true,button:0}));
      ev('pointerdown',p.x,p.y); await new Promise(r=>setTimeout(r,520)); for(let i=1;i<=8;i++){ev('pointermove',p.x+i*48,p.y-i*10);await new Promise(r=>setTimeout(r,16));}
      ev('pointerup',p.x+384,p.y-80);}''', box)
    page.wait_for_timeout(900)
    try: page.wait_for_function("document.getElementById('zhutian-lilith-float').shadowRoot.querySelector('.fl').dataset.tucked==='true'", timeout=12000)
    except Exception: pass
    page.wait_for_timeout(700)
    t = fl(page, "return {tucked:el.dataset.tucked,edge:el.dataset.edge,saved:__zhutianApp.settings.get('floatPos'),left:el.getBoundingClientRect().left}")
    ok('long press + drag to the right edge: she hides there (peek only) and the spot is saved', t['edge'] == 'right' and (t['saved'] or {}).get('tucked') is True and (t['saved'] or {}).get('edge') == 'right' and t['left'] > 390 - 78, json.dumps(t))
    shot(page, '13-phone-tucked-right')
    # a short touch without hold does NOT drag
    box = fl(page, "const r=sh.querySelector('.fig').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}")
    page.evaluate('''async p=>{const sh=document.getElementById('zhutian-lilith-float').shadowRoot,fig=sh.querySelector('.fig');
      const ev=(t,x,y)=>fig.dispatchEvent(new PointerEvent(t,{bubbles:true,composed:true,pointerId:10,pointerType:'touch',clientX:x,clientY:y,isPrimary:true,button:0}));
      ev('pointerdown',p.x,p.y); ev('pointermove',p.x-60,p.y); ev('pointerup',p.x-60,p.y);}''', box)
    page.wait_for_timeout(500)
    ok('quick swipe without a long press does not move her', (page.evaluate("__zhutianApp.settings.get('floatPos')") or {}).get('edge') == 'right')
    # reload: position kept
    page.reload(); Z.boot(page); Z.open_chat(page); page.wait_for_timeout(1200)
    try: page.wait_for_function("document.getElementById('zhutian-lilith-float').shadowRoot.querySelector('.fl').dataset.tucked==='true'", timeout=12000)
    except Exception: pass
    t = fl(page, "return {edge:el.dataset.edge,tucked:el.dataset.tucked}")
    ok('position survives a reload (tucked at the right edge)', t['edge'] == 'right' and t['tucked'] == 'true', json.dumps(t))
    # double tap → poke line
    fl(page, "f.poke();return 1"); page.wait_for_timeout(300)
    b = fl(page, "return sh.querySelector('.bubble span').textContent")
    ok('double tap (poke): a reaction line', bool(b), b)
    ok('no page errors (phone)', not errs, str(errs[:2]))
    page.evaluate("__zhutianApp.settings.set('floatPos',null)")
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1400, 'height': 900}); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    Z.boot(page)
    statusbar_suite(page)
    d = page.evaluate("(()=>{const sh=document.getElementById('zhutian-lilith-float')?.shadowRoot;return {float:sh?!sh.querySelector('.fl').hidden:null,entry:getComputedStyle(__zhutianApp.assistant.shadow.getElementById('entry')).display}})()")
    ok('desktop (auto): no floating Lilith, original launcher kept', d['float'] is False and d['entry'] != 'none', json.dumps(d))
    unbind_suite(page)
    disable_hook_suite(page)
    ok('no page errors (desktop)', not errs, str(errs[:2]))
    page.close()
    float_suite(browser)
    browser.close()

passed = sum(1 for _, c, _ in results if c)
print(f'{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
