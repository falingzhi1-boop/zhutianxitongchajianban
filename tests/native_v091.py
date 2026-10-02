"""0.9.1 acceptance (isolated SillyTavern + mock model only; no real keys, no user data):
  * 复制诊断信息: the report reaches the clipboard (secure context) and the fallback path (non-secure context, as on a
    phone opening ST by LAN address); it has versions / device / interfaces / endpoint host + model / settings / the
    last plugin errors, and never the (fake) API key — not even when the key appears inside an error message
  * 手机真机自检 on an emulated Android phone, driven like a user: tap the group-chat input (keyboard simulated by
    shrinking visualViewport), tap the 私聊 input, rotate, rotate back, press back → every step ✅, the result is stored
    in the settings, shown in the report, and 复制结果 puts it on the clipboard
  * 结束自检 at the first waiting step ends cleanly; tapping the step card never counts as "outside the terminal"
  * WebViews that resize the whole page for the keyboard (innerHeight drops) are detected as keyboard too
  * desktop: 兼容诊断 has the two new buttons, no page errors
Usage: python3 tests/native_v091.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots091')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
FAKE_KEY = 'sk-' + 'zt091testkeyABCDEFGHIJKLMNOPQRSTUVWXYZ12'
ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def js(page, body, arg=None): return page.evaluate('(async(arg)=>{const app=__zhutianApp,h=app.hub,sr=h.shadow,d=h.shell.dialog,wait=ms=>new Promise(r=>setTimeout(r,ms));' + body + '})', arg)
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'))

FAKE_VV = '''(()=>{const fake=new EventTarget();let o=null;
  for(const [k,f] of Object.entries({width:()=>innerWidth,height:()=>innerHeight,offsetTop:()=>0,offsetLeft:()=>0,pageTop:()=>scrollY,pageLeft:()=>scrollX,scale:()=>1}))
    Object.defineProperty(fake,k,{get:()=>o&&o[k]!==undefined?o[k]:f()});
  addEventListener('resize',()=>fake.dispatchEvent(new Event('resize')));
  window.__ztVV={set(v){o=v;fake.dispatchEvent(new Event('resize'));}};
  Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>fake});})()'''
CARD = "const c=document.getElementById('zhutian-device-check')?.shadowRoot;return c?{t:c.querySelector('.t').textContent,p:c.querySelector('.p').textContent,btns:[...c.querySelectorAll('.btns button')].map(b=>b.textContent)}:null"

def card(page): return js(page, CARD)
def wait_card(page, pattern, ms=40000):
    page.wait_for_function("p=>{const c=document.getElementById('zhutian-device-check')?.shadowRoot;return !!c&&new RegExp(p).test(c.querySelector('.t').textContent+' '+c.querySelector('.p').textContent)}", arg=pattern, timeout=ms)
def tap_card_button(page, label):
    r = js(page, "const b=[...document.getElementById('zhutian-device-check').shadowRoot.querySelectorAll('.btns button')].find(b=>b.textContent===arg);const r=b?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2}:null", label)
    if r: page.touchscreen.tap(r['x'], r['y'])
    return r
def tap_shadow(page, root_js, sel):
    r = js(page, f"const e=({root_js}).querySelector(arg);const r=e?.getBoundingClientRect();return r&&r.width?{{x:r.left+Math.min(30,r.width/2),y:r.top+r.height/2}}:null", sel)
    if r: page.touchscreen.tap(r['x'], r['y'])
    return r

def phone_context(browser, w=390, h=844):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, device_scale_factor=1, user_agent=ANDROID_UA)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=args.base_url)
    ctx.add_init_script(FAKE_VV)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda x: x.accept())
    return ctx, page, errs

def report_suite(browser):
    ctx, page, errs = phone_context(browser)
    Z.boot(page); Z.setup_chat(page)
    js(page, "app.settings.set('mobileLayout','auto');app.settings.set('deviceCheck',null);")
    before = js(page, "const m=await import(app.base+'src/api-center.js');const ns=app.original.ZhuTianMemoryCore?.NS;window.__ztApiBefore=m.readConfigs(app.bridge,ns);await m.saveConfigs(app.bridge,ns,{url:'https://api.example.com/v1',key:arg,model:'m-test-1'});return true", FAKE_KEY)
    js(page, "console.warn('[诸天] 测试报错，带着密钥 '+arg+' 和 https://u:pw@relay.example/v1?key=zzz');", FAKE_KEY)
    js(page, "await app.features.copyDiagnostics();await wait(400);")
    clip = page.evaluate("navigator.clipboard.readText()")
    ok('复制诊断信息 (secure context): the report is on the clipboard', clip.startswith('【诸天终端诊断信息】'), clip[:80])
    for label, needle in [('plugin version', '插件：0.9.1'), ('SillyTavern version', 'SillyTavern：1.19'), ('Android browser', 'Android 14'), ('visible area / keyboard', '可见区域：390×844'),
                          ('phone layout', '手机布局：port'), ('interfaces', '— 宿主接口 —'), ('endpoint host + model', 'api.example.com · m-test-1'), ('settings', '"mobileLayout":"auto"'),
                          ('the plugin error', '测试报错'), ('self-check not yet run', '没有运行过')]:
        ok(f'report contains {label}', needle in clip, needle)
    ok('report never contains the API key, URL credentials or query strings (also inside the error message)', FAKE_KEY[3:] not in clip and 'pw@' not in clip and 'key=zzz' not in clip,
       [l for l in clip.split('\n') if 'sk-' in l or '测试报错' in l][:3])
    # fallback: no secure context (ST opened by LAN address on a phone)
    fb = js(page, """Object.defineProperty(window,'isSecureContext',{configurable:true,get:()=>false});let got='';const f=e=>{got=document.getSelection()?.toString()||e.target?.value||'';};
      document.addEventListener('copy',f,true);await app.features.copyDiagnostics();await wait(300);document.removeEventListener('copy',f,true);
      delete window.isSecureContext;const pop=[...document.querySelectorAll('.popup textarea')].pop();return {copied:got.slice(0,30),popup:!!pop}""")
    ok('复制诊断信息 without a secure context: falls back to the copy command (or shows a box to copy by hand)', fb['copied'].startswith('【诸天终端诊断信息】') or fb['popup'], json.dumps(fb, ensure_ascii=False))
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    js(page, "const m=await import(app.base+'src/api-center.js');const b=window.__ztApiBefore;await app.bridge.updateVariablesWith(v=>{v[m.STATUS_KEY]=b.status;return v;},{type:'global'});await app.bridge.updateVariablesWith(v=>{v[m.assistantKey(app.original.ZhuTianMemoryCore?.NS)]=b.assistant;return v;},{type:'script'});localStorage.removeItem(m.STATUS_LOCAL);")
    ok('phone (report): no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

def selftest_suite(browser):
    ctx, page, errs = phone_context(browser)
    Z.boot(page); Z.open_chat(page)
    js(page, "app.settings.set('mobileLayout','auto');app.settings.set('hubBackClose',true);app.settings.set('deviceCheck',null);if(h.isOpen){h.close();await wait(800);}")
    js(page, "app.deviceCheck.run();")
    try:
        wait_card(page, '聊天群底部的输入框', 90000)
        shot(page, 'v091-selftest-step')
        page.wait_for_timeout(400)
        tap_shadow(page, 'sr', '.zt-g-send textarea'); page.wait_for_timeout(300)
        js(page, "window.__ztVV.set({height:470});")
        wait_card(page, '私聊底部的输入框', 30000)
        js(page, "window.__ztVV.set(null);")
        page.wait_for_timeout(500)
        tap_shadow(page, 'app.assistant.shadow', '#lc-input'); page.wait_for_timeout(300)
        js(page, "window.__ztVV.set({height:470});")
        wait_card(page, '横过来', 30000)
        js(page, "window.__ztVV.set(null);")
        page.set_viewport_size({'width': 844, 'height': 390})
        wait_card(page, '转回竖屏', 30000)
        page.set_viewport_size({'width': 390, 'height': 844})
        wait_card(page, '返回键', 30000)
        page.wait_for_timeout(500)
        page.go_back()
        wait_card(page, '自检完成', 30000)
    except Exception as e:
        ok('self-check walked through all guided steps', False, f'{e} — card: {json.dumps(card(page), ensure_ascii=False)[:300]}')
    shot(page, 'v091-selftest-done')
    res = js(page, "const dc=app.settings.get('deviceCheck');return {text:dc?.text||'',url:location.href}")
    text = res['text']; print('   ', text.replace('\n', '\n    ')[:1800])
    lines = text.split('\n')
    ok('self-check finished and stored its result in the settings', lines[0].startswith('诸天 0.9.1 真机自检'), lines[0] if lines else '')
    for step in ['全屏', '各页面', '聊天群 + 键盘', '私聊 · 全屏', '私聊 · 键盘', '悬浮莉莉丝', '横屏', '返回键']:
        ln = next((l for l in lines if l[2:].startswith(step + '：') or l[1:].strip().startswith(step + '：')), '')
        ok(f'self-check step 「{step}」 ✅', ln.startswith('✅'), ln[:220])
    ok('the back gesture closed the terminal without leaving SillyTavern', js(page, "return !h.isOpen && !!document.getElementById('chat') && !!globalThis.__zhutianApp"), res['url'])
    tap_card_button(page, '复制结果'); page.wait_for_timeout(500)
    clip = page.evaluate("navigator.clipboard.readText()")
    ok('复制结果 puts the self-check on the clipboard', clip.startswith('诸天 0.9.1 真机自检'), clip[:60])
    tap_card_button(page, '关闭'); page.wait_for_timeout(300)
    ok('关闭 removes the step card', not js(page, "return !!document.getElementById('zhutian-device-check')"))
    rep = js(page, "return (await import(app.base+'src/diag-report.js')).buildReport(app)")
    ok('复制诊断信息 now includes the last self-check', '上次真机自检' in rep and '真机自检：✅' in rep, [l for l in rep.split('\n') if '自检' in l][:2])
    # 结束自检 at the first waiting step
    js(page, "app.deviceCheck.run();")
    try:
        wait_card(page, '聊天群底部的输入框', 90000); tap_card_button(page, '结束自检'); wait_card(page, '自检完成', 15000); good = True
    except Exception as e: good = False
    st = js(page, "return app.settings.get('deviceCheck')?.text||''")
    ok('结束自检 ends cleanly (result says 已手动结束, no ❌ for the skipped steps)', good and '已手动结束' in st and not any(l.startswith('❌') for l in st.split('\n')), st.split('\n')[0] + ' … ' + st.split('\n')[-1])
    tap_card_button(page, '关闭'); page.wait_for_timeout(300)
    # the card is never "outside the terminal"
    o = js(page, """app.settings.set('mobileLayout','window');app.settings.set('hubOutsideClose','always');h.open('ov');await wait(1000);
      app.deviceCheck.mount();app.deviceCheck.show(1,1,'测试','点按钮',[{label:'按钮',fn:()=>{window.__ztTapped=1;}}]);await wait(200);return h.isOpen""")
    tap_card_button(page, '按钮'); page.wait_for_timeout(600)
    o2 = js(page, "const r={open:h.isOpen,tapped:!!window.__ztTapped};app.deviceCheck.close();app.settings.set('mobileLayout','auto');app.settings.set('hubOutsideClose','auto');h.close();await wait(700);return r")
    ok('tapping the step card does not close the terminal (even with 点击终端外部时关闭 = 总是)', o and o2['open'] and o2['tapped'], json.dumps(o2))
    # page-resizing keyboard (older Android WebViews)
    js(page, "h.open('group');await wait(1200);")
    tap_shadow(page, 'sr', '.zt-g-send textarea'); page.wait_for_timeout(300)
    page.set_viewport_size({'width': 390, 'height': 470}); page.wait_for_timeout(700)
    k = js(page, "const t=sr.querySelector('.zt-g-send textarea').getBoundingClientRect();return {mode:app.mobile.kbMode,kb:d.dataset.ztKb||'',h:Math.round(d.getBoundingClientRect().height),top:getComputedStyle(sr.querySelector('.zt-hub-top')).display,inputBottom:Math.round(t.bottom)}")
    ok('page-resizing keyboard (innerHeight 844 → 470 while typing) counts as keyboard: ledger strip steps aside, input visible', k['mode'] == 'resize' and k['kb'] == 'open' and k['h'] == 470 and k['top'] == 'none' and k['inputBottom'] <= 470, json.dumps(k))
    js(page, "sr.activeElement?.blur();await wait(200);")
    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(700)
    k2 = js(page, "return {mode:app.mobile.kbMode,kb:d.dataset.ztKb||'',h:Math.round(d.getBoundingClientRect().height)}")
    ok('…and back to normal once the field loses focus and the page is full height again', k2['mode'] == '' and k2['kb'] == '' and k2['h'] == 844, json.dumps(k2))
    js(page, "h.close();await wait(600);")
    ok('phone (self-check): no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

def desktop_suite(browser):
    page = browser.new_page(viewport={'width': 1400, 'height': 900}); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    Z.boot(page); Z.open_chat(page)
    js(page, "await app.features.openDiagnostics();await wait(900);")
    btns = page.evaluate("[...document.querySelectorAll('.popup [data-diag]')].map(b=>b.textContent)")
    ok('desktop: 兼容诊断 shows 复制诊断信息 and 手机真机自检', '复制诊断信息' in btns and '手机真机自检' in btns, btns)
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    s = js(page, "h.open('set');await wait(1200);const b=[...sr.querySelectorAll('[data-act]')].map(x=>x.dataset.act);h.close();await wait(500);return b")
    ok('desktop: the settings page offers copy-diag and selftest', 'copy-diag' in s and 'selftest' in s, [x for x in s if x in ('copy-diag', 'selftest', 'diagnose')])
    ok('desktop: no page errors', not errs, '; '.join(errs)[:300])
    page.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    for name, fn in [('report', report_suite), ('selftest', selftest_suite), ('desktop', desktop_suite)]:
        try: fn(browser)
        except Exception as e: ok(f'{name} suite ran without exceptions', False, str(e)[:500])
    browser.close()

passed = sum(1 for _, c, _ in results if c)
print(f'\n{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
