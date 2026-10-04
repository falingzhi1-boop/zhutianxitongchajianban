"""0.9.0 acceptance — 手机端适配 (isolated SillyTavern + mock model only; no real keys, no user data):
  * phone portrait 390×844 / small 360×640: the terminal fills the screen (no 8 px window, no chat bar under it), even
    when an earlier session left a small remembered window box; every page: nothing sticks out sideways, the page
    does not scroll sideways, header / navigation / group-chat controls are big enough to tap, text fields use 16 px
  * on-screen keyboard (visualViewport shrinks): the terminal shrinks with it, the group-chat input stays visible,
    the ledger strip and the status line step aside; keyboard gone → everything back
  * 私聊 from the header opens on top of the terminal as a full-screen sheet and follows the keyboard too
  * a phone session no longer overwrites the remembered desktop window box
  * floating Lilith waits in the bottom corner while the terminal is open, a tap on her line dismisses it, she goes
    back to her own spot after closing
  * landscape 844×390: navigation becomes a left rail, the content keeps its height, Lilith waits on the right
  * setting 手机上的终端窗口 = 浮动窗口 brings the 0.8.5 window back; desktop (mouse, 1400×900) is unchanged
Usage: python3 tests/native_v090.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots090')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def js(page, body, arg=None): return page.evaluate('(async(arg)=>{const app=__zhutianApp,h=app.hub,sr=h.shadow,d=h.shell.dialog,wait=ms=>new Promise(r=>setTimeout(r,ms));' + body + '})', arg)
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'))

# A controllable visualViewport: headless Chromium has no on-screen keyboard, so the keyboard is simulated by shrinking
# the visual viewport exactly the way phone browsers do (layout viewport unchanged, visualViewport.height smaller).
FAKE_VV = '''(()=>{const fake=new EventTarget();let o=null;
  for(const [k,f] of Object.entries({width:()=>innerWidth,height:()=>innerHeight,offsetTop:()=>0,offsetLeft:()=>0,pageTop:()=>scrollY,pageLeft:()=>scrollX,scale:()=>1}))
    Object.defineProperty(fake,k,{get:()=>o&&o[k]!==undefined?o[k]:f()});
  addEventListener('resize',()=>fake.dispatchEvent(new Event('resize')));
  window.__ztVV={set(v){o=v;fake.dispatchEvent(new Event('resize'));}};
  Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>fake});})()'''

MEASURE = r'''const vw=innerWidth,out={off:[],tap:[],zoom:[],hscroll:0};
  const vis=el=>{const r=el.getBoundingClientRect();if(!r.width||!r.height)return null;const s=getComputedStyle(el);return s.visibility==='hidden'||+s.opacity===0?null:r;};
  const nm=el=>(el.id?'#'+el.id:el.tagName.toLowerCase())+':'+(el.getAttribute('aria-label')||el.title||el.textContent||'').trim().slice(0,14);
  const scroller=el=>{for(let p=el.parentElement;p;p=p.parentElement){if(p===d)return false;const s=getComputedStyle(p);if(/auto|scroll|hidden/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+1)return true;}return false;};
  for(const el of d.querySelectorAll('*')){const r=vis(el);if(!r)continue;
    if((r.right>vw+2||r.left<-2)&&!scroller(el)&&!el.closest('[aria-hidden=true],.zt-world-deco'))out.off.push(nm(el)+' '+Math.round(r.left)+'..'+Math.round(r.right));
    if(el.matches('#drag-handle button,.zt-hub-nav .nav-button,.zt-g-tabs button,.zt-g-send button')&&(r.height<36||r.width<36))out.tap.push(nm(el)+' '+Math.round(r.width)+'x'+Math.round(r.height));
    if(el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]),select,textarea')&&parseFloat(getComputedStyle(el).fontSize)<16)out.zoom.push(nm(el)+' '+getComputedStyle(el).fontSize);}
  const ps=sr.querySelector('.page-scroll');out.hscroll=ps.scrollWidth-ps.clientWidth;
  const f=h.engineFrame;if(f&&f.getBoundingClientRect().width&&h.page==='zt-engine'||(f&&f.offsetParent)){const doc=f.contentDocument;
    for(const el of doc.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]),select,textarea'))if(el.offsetParent&&parseFloat(getComputedStyle(el).fontSize)<16)out.zoom.push('engine '+nm(el)+' '+getComputedStyle(el).fontSize);
    out.engineH=doc.documentElement.scrollWidth-doc.documentElement.clientWidth;}
  for(const k of ['off','tap','zoom'])out[k]=out[k].slice(0,8);return out;'''

def phone_context(browser, w, h):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, device_scale_factor=1)
    ctx.add_init_script(FAKE_VV)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda x: x.accept())
    return ctx, page, errs

def portrait_suite(browser):
    ctx, page, errs = phone_context(browser, 390, 844)
    Z.boot(page); page.evaluate("__zhutianApp.settings.set('floatLilith','auto')"); Z.setup_chat(page)
    js(page, "app.settings.set('mobileLayout','auto');")
    ui_key = js(page, "return Object.keys(app.settings.scriptVariables()).find(k=>k.endsWith('_UI'))||''")
    js(page, "const v=app.settings.scriptVariables();const k=arg||Object.keys(v).find(k=>k.endsWith('_UI'));if(k){v[k]={...(v[k]||{}),window:{x:120,y:60,w:1000,h:720}};app.settings.setScriptVariables(v);}", ui_key)
    # a remembered small floating-window box (what a landscape session used to leave behind)
    js(page, "h.open('ov');await wait(900);d.style.left='8px';d.style.top='8px';d.style.width='380px';d.style.height='354px';await wait(400);")
    r = js(page, "const b=d.getBoundingClientRect();return {mode:d.dataset.ztMobile,box:[b.left,b.top,b.width,b.height].map(Math.round),main:Math.round(sr.querySelector('.page-scroll').getBoundingClientRect().height)}")
    ok('portrait 390×844: the terminal fills the screen even with a small remembered window box', r['mode'] == 'port' and r['box'] == [0, 0, 390, 844], json.dumps(r))
    ok('portrait: the page area is at least 600 px tall (0.8.5: 548 px, 148 px with a remembered small box)', r['main'] >= 600, json.dumps(r))
    shot(page, 'm090-portrait-ov')
    pages = js(page, "return [...new Set([...sr.querySelectorAll('.nav-button[data-page]')].map(b=>b.dataset.page))]")
    bad = {}
    for pg in pages:
        js(page, "h.go(arg);await wait(1100);", pg)
        m = js(page, MEASURE)
        if m['off'] or m['tap'] or m['zoom'] or m['hscroll'] > 1 or (m.get('engineH') or 0) > 1: bad[pg] = m
    ok(f'portrait, all {len(pages)} pages: nothing sticks out, no sideways scroll, tap targets ≥ 36 px, text fields 16 px', not bad, json.dumps(bad, ensure_ascii=False)[:900])
    # keyboard on the group chat
    js(page, "h.go('group');await wait(900);")
    js(page, "const t=sr.querySelector('.zt-g-send textarea');t.focus();window.__ztVV.set({height:470});await wait(700);")
    k = js(page, """const b=d.getBoundingClientRect(),t=sr.querySelector('.zt-g-send textarea').getBoundingClientRect(),top=sr.querySelector('.zt-hub-top');
      return {kb:d.dataset.ztKb||'',h:Math.round(b.height),inputBottom:Math.round(t.bottom),inputTop:Math.round(t.top),topBar:getComputedStyle(top).display,status:getComputedStyle(sr.querySelector('.statusbar')).display,log:Math.round(sr.querySelector('.zt-g-log')?.getBoundingClientRect().height||0)}""")
    ok('keyboard up (visible height 470): the terminal shrinks to 470 px and the group-chat input stays above the keyboard',
       k['kb'] == 'open' and k['h'] == 470 and 0 < k['inputTop'] and k['inputBottom'] <= 470, json.dumps(k))
    ok('keyboard up: ledger strip and status line step aside, the chat log keeps room', k['topBar'] == 'none' and k['status'] == 'none' and k['log'] >= 120, json.dumps(k))
    shot(page, 'm090-portrait-keyboard')
    js(page, "window.__ztVV.set(null);sr.activeElement?.blur();await wait(600);")
    k2 = js(page, "const b=d.getBoundingClientRect();return {kb:d.dataset.ztKb||'',h:Math.round(b.height),topBar:getComputedStyle(sr.querySelector('.zt-hub-top')).display}")
    ok('keyboard gone: full height and the ledger strip come back', k2['kb'] == '' and k2['h'] == 844 and k2['topBar'] != 'none', json.dumps(k2))
    # floating Lilith while the terminal is open
    f = js(page, """const fl=app.float;if(!fl?.active)return {active:false};const r=fl.fig.getBoundingClientRect();
      fl.say('测试台词');await wait(500);const b=fl.bubble.getBoundingClientRect();const shown=fl.speaking;
      fl.bubble.click();await wait(400);return {active:true,figTop:Math.round(r.top),figLeft:Math.round(r.left),bubbleBottom:Math.round(b.bottom),shown,afterTap:fl.speaking}""")
    ok('floating Lilith waits in the bottom corner while the terminal is open (not halfway up the content)', f.get('active') and f['figTop'] > 844 - 220, json.dumps(f))
    ok('a tap on her line dismisses it', f.get('shown') and not f.get('afterTap'), json.dumps(f))
    s = js(page, "const fl=app.float;fl.say('滚动测试');await wait(300);const ps=sr.querySelector('.page-scroll');h.go('set');await wait(900);fl.say('滚动测试');await wait(200);ps.scrollTop=400;ps.dispatchEvent(new Event('scroll'));await wait(300);return {afterScroll:fl.speaking}")
    ok('scrolling the terminal hides her line', not s['afterScroll'], json.dumps(s))
    # 私聊 on top of the full-screen terminal
    js(page, "h.go('ov');await wait(800);")
    av = js(page, "const s=app.assistant.shadow;const a=[s.getElementById('header-avatar'),s.getElementById('entry')].find(e=>e&&e.getBoundingClientRect().width);const r=a?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2}:null")
    if av:
        page.touchscreen.tap(av['x'], av['y']); page.wait_for_timeout(1300)
        pc = js(page, """const s=app.assistant.shadow,p=s.getElementById('lc-panel');const r=p?.getBoundingClientRect();
          const top=r&&r.width?s.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;
          return {hub:h.isOpen,panel:!!p&&!p.hidden,onTop:!!top&&!!p&&p.contains(top),box:r?[r.left,r.top,r.right,r.bottom].map(Math.round):null}""")
        ok('私聊 from the header opens on top of the terminal as a full-screen sheet (0.8.5: a 374×426 floating panel)', pc['hub'] and pc['panel'] and pc['onTop'] and pc['box'] == [0, 0, 390, 844], json.dumps(pc))
        shot(page, 'm090-portrait-private-chat')
        js(page, "const i=app.assistant.shadow.getElementById('lc-input');i?.focus();window.__ztVV.set({height:470});await wait(600);")
        pk = js(page, """const s=app.assistant.shadow,p=s.getElementById('lc-panel').getBoundingClientRect(),i=s.getElementById('lc-input')?.getBoundingClientRect(),cam=s.querySelector('.zt-lc-cam');
          return {h:Math.round(p.height),inputBottom:i?Math.round(i.bottom):-1,inputTop:i?Math.round(i.top):-1,cam:cam?getComputedStyle(cam).display:'none'}""")
        ok('私聊 with the keyboard up: the sheet shrinks to the visible 470 px, the input stays above the keyboard, the close-up band steps aside',
           pk['h'] == 470 and 0 < pk['inputTop'] and pk['inputBottom'] <= 470 and pk['cam'] == 'none', json.dumps(pk))
        shot(page, 'm090-portrait-private-chat-keyboard')
        js(page, "window.__ztVV.set(null);app.assistant.shadow.activeElement?.blur();await wait(400);")
        js(page, "const s=app.assistant.shadow;(s.getElementById('lc-back')||s.getElementById('lc-close'))?.click();await wait(600);")
    else: ok('私聊 button found in the header', False)
    js(page, "h.close();await wait(900);")
    fc = js(page, "const fl=app.float,r=fl.fig.getBoundingClientRect(),p=fl.pos();return {top:Math.round(r.top),saved:Math.round(p.y),tucked:!!p.tucked}")
    ok('after closing she goes back to her own spot', abs(fc['top'] - fc['saved']) < 40, json.dumps(fc))
    # rotate to landscape
    page.set_viewport_size({'width': 844, 'height': 390}); page.wait_for_timeout(500)
    js(page, "h.open('ov');await wait(1200);")
    l = js(page, """const b=d.getBoundingClientRect(),nav=h.shell.nav.getBoundingClientRect(),ps=sr.querySelector('.page-scroll').getBoundingClientRect(),fl=app.float.fig.getBoundingClientRect();
      return {mode:d.dataset.ztMobile,box:[b.left,b.top,b.width,b.height].map(Math.round),navW:Math.round(nav.width),navH:Math.round(nav.height),page:Math.round(ps.height),floatLeft:Math.round(fl.left)}""")
    ok('landscape 844×390: full screen, navigation is a left rail, the page area keeps ≥ 240 px (0.8.5: 122 px)', l['mode'] == 'land' and l['box'] == [0, 0, 844, 390] and l['navW'] < 100 and l['page'] >= 240, json.dumps(l))
    ok('landscape: Lilith waits on the right (the rail is on the left)', l['floatLeft'] > 844 - 120, json.dumps(l))
    shot(page, 'm090-landscape-ov')
    bad = {}
    for pg in ['shop', 'group', 'set', 'work', 'api', 'events']:
        js(page, "h.go(arg);await wait(1000);", pg)
        m = js(page, MEASURE)
        if m['off'] or m['tap'] or m['zoom'] or m['hscroll'] > 1: bad[pg] = m
    ok('landscape, 6 pages: nothing sticks out, no sideways scroll, tap targets, 16 px fields', not bad, json.dumps(bad, ensure_ascii=False)[:700])
    js(page, "h.go('group');await wait(800);")
    shot(page, 'm090-landscape-group')
    js(page, "const t=sr.querySelector('.zt-g-send textarea');t.focus();window.__ztVV.set({height:200});await wait(700);")
    k = js(page, "const t=sr.querySelector('.zt-g-send textarea').getBoundingClientRect();return {h:Math.round(d.getBoundingClientRect().height),inputBottom:Math.round(t.bottom),inputTop:Math.round(t.top),header:getComputedStyle(sr.getElementById('drag-handle')).display}")
    ok('landscape keyboard (visible height 200): the input stays visible, the header steps aside', k['h'] == 200 and 0 < k['inputTop'] and k['inputBottom'] <= 200 and k['header'] == 'none', json.dumps(k))
    js(page, "window.__ztVV.set(null);sr.activeElement?.blur();await wait(500);")
    # setting: floating window
    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(500)
    w = js(page, "app.settings.set('mobileLayout','window');await wait(500);const b=d.getBoundingClientRect();const r={mode:d.dataset.ztMobile||'',w:Math.round(b.width),h:Math.round(b.height)};app.settings.set('mobileLayout','auto');await wait(400);r.back=d.dataset.ztMobile||'';return r")
    ok('setting 浮动窗口 brings the 0.8.5 window back (and 自动 returns to full screen)', w['mode'] == '' and w['w'] < 390 and w['back'] == 'port', json.dumps(w))
    js(page, "h.close();await wait(600);")
    wb = js(page, "const v=app.settings.scriptVariables();const k=arg||Object.keys(v).find(k=>k.endsWith('_UI'));return k?v[k].window||null:'no-ui-key'", ui_key)
    ok('after a whole phone session (pages, keyboard, 私聊, rotation) the remembered desktop window box is untouched (0.8.5 saved the phone box)',
       isinstance(wb, dict) and wb.get('w') == 1000 and wb.get('h') == 720, json.dumps(wb))
    ok('phone: no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

def small_suite(browser):
    ctx, page, errs = phone_context(browser, 360, 640)
    Z.boot(page); page.evaluate("__zhutianApp.settings.set('floatLilith','auto')"); Z.open_chat(page)
    js(page, "h.open('ov');await wait(1200);")
    r = js(page, "const b=d.getBoundingClientRect();return {box:[b.left,b.top,b.width,b.height].map(Math.round),page:Math.round(sr.querySelector('.page-scroll').getBoundingClientRect().height)}")
    ok('small phone 360×640: full screen, page area ≥ 420 px', r['box'] == [0, 0, 360, 640] and r['page'] >= 420, json.dumps(r))
    bad = {}
    for pg in ['ov', 'shop', 'plug', 'group', 'set', 'api', 'plugmgr']:
        js(page, "h.go(arg);await wait(1000);", pg)
        m = js(page, MEASURE)
        if m['off'] or m['tap'] or m['zoom'] or m['hscroll'] > 1: bad[pg] = m
    ok('small phone, 7 pages: nothing sticks out, no sideways scroll, tap targets, 16 px fields', not bad, json.dumps(bad, ensure_ascii=False)[:700])
    js(page, "h.go('shop');await wait(900);")
    shot(page, 'm090-small-shop')
    js(page, "h.close();await wait(600);")
    ok('small phone: no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

def desktop_suite(browser):
    page = browser.new_page(viewport={'width': 1400, 'height': 900}); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    Z.boot(page); page.evaluate("__zhutianApp.settings.set('floatLilith','auto')"); Z.open_chat(page)
    r = js(page, "h.open('ov');await wait(1200);const b=d.getBoundingClientRect();const r={mode:d.dataset.ztMobile||'',w:Math.round(b.width),h:Math.round(b.height),radius:getComputedStyle(d).borderTopLeftRadius};h.close();await wait(500);return r")
    ok('desktop 1400×900 (mouse): unchanged floating window, no phone layout', r['mode'] == '' and r['w'] < 1400 and r['h'] < 900 and r['radius'] != '0px', json.dumps(r))
    ok('desktop: no page errors', not errs, '; '.join(errs)[:300])
    page.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    for name, fn in [('portrait', portrait_suite), ('small', small_suite), ('desktop', desktop_suite)]:
        try: fn(browser)
        except Exception as e: ok(f'{name} suite ran without exceptions', False, str(e)[:500])
    browser.close()

passed = sum(1 for _, c, _ in results if c)
print(f'\n{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
