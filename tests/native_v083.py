"""0.8.3 acceptance (isolated SillyTavern + mock model only), phone context 390×844 with real touch input:
  * the floating Lilith is smaller by default (75 %) and the size setting resizes her live (xs … xl), position kept
  * with the terminal open (outside-tap closing on, the phone default), a real touch tap on her does NOT close the
    terminal: she peeks out, says a line, and slips back; a double tap pokes; the terminal stays open throughout
  * a tap on the chat behind the terminal still closes it (the outside rule itself still works)
Usage: python3 tests/native_v083.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots083')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'))
def fl(page, body): return page.evaluate("(()=>{const f=__zhutianApp.float,sh=document.getElementById('zhutian-lilith-float').shadowRoot,el=sh.querySelector('.fl');" + body + "})()")
def rect(page): return fl(page, "const r=sh.querySelector('.fig').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:el.offsetWidth,h:el.offsetHeight,left:r.left,right:r.right}")
def is_open(page): return page.evaluate("__zhutianApp.hub.isOpen")
def bubble(page): return fl(page, "return sh.querySelector('.bubble').classList.contains('show')?sh.querySelector('.bubble span').textContent:''")
def settle_wait(page, ms=700): page.wait_for_timeout(ms)

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    # make sure the fixture chat exists (desktop context), then switch to the phone
    d = browser.new_page(viewport={'width': 1400, 'height': 900}); d.on('dialog', lambda x: x.accept())
    Z.boot(d); Z.setup_chat(d); d.close()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda x: x.accept())
    Z.boot(page); Z.open_chat(page)
    page.evaluate("""(()=>{const s=__zhutianApp.settings;s.set('floatLilith','auto');s.set('floatSize',undefined);s.set('hubOutsideClose','auto');
      s.set('floatPos',{x:8,y:420,edge:'',tucked:false});__zhutianApp.float.applySize();__zhutianApp.float.sync();})()""")
    settle_wait(page, 900)

    # ---- size ----
    r = rect(page)
    ok('default size is 75 % of 0.8.2 (59×78 instead of 78×104)', (r['w'], r['h']) == (59, 78), json.dumps(r))
    shot(page, '01-default-size')
    sizes = {}
    for k in ['xs', 's', 'l', 'xl']:
        page.evaluate(f"__zhutianApp.settings.set('floatSize','{k}')"); settle_wait(page, 300)
        sizes[k] = (rect(page)['w'], rect(page)['h'])
    ok('size setting resizes her live: xs 43×57, s 51×68, l 70×94, xl 78×104', sizes == {'xs': (43, 57), 's': (51, 68), 'l': (70, 94), 'xl': (78, 104)}, json.dumps(sizes))
    page.evaluate("__zhutianApp.settings.set('floatSize','xs')"); settle_wait(page, 500); shot(page, '02-size-xs')
    pos = page.evaluate("__zhutianApp.settings.get('floatPos')")
    ok('changing the size keeps her position', pos and pos.get('x') == 8 and pos.get('y') == 420 and not pos.get('tucked'), json.dumps(pos))
    page.evaluate("__zhutianApp.settings.set('floatSize','m')"); settle_wait(page, 400)
    # settings row exists
    page.evaluate("__zhutianApp.hub.open('set')"); settle_wait(page, 900)
    has_row = page.evaluate("(()=>{const sr=__zhutianApp.hub.shadow;return [...sr.querySelectorAll('select')].some(s=>[...s.options].some(o=>o.value==='xl'&&/特大/.test(o.textContent)))})()")
    ok('设置 → 莉莉丝 has the 悬浮莉莉丝大小 select', has_row)
    page.evaluate("__zhutianApp.hub.close()"); settle_wait(page, 1200)

    # ---- tap her (real touch) while the terminal is open ----
    r = rect(page); page.touchscreen.tap(r['x'], r['y']); settle_wait(page, 1800)
    ok('terminal closed: a touch tap opens it', is_open(page))
    settle_wait(page, 600)
    t = fl(page, "return {tucked:el.dataset.tucked,temp:f.tempTuck}")
    ok('terminal open: she moves to the edge out of the way', t['tucked'] == 'true' and t['temp'], json.dumps(t))
    r = rect(page)
    page.touchscreen.tap(max(2, r['right'] - 8), r['y']); settle_wait(page, 700)   # the visible peek
    b = bubble(page)
    ok('touch tap on her with the terminal open does NOT close the terminal (was: closed by the outside-tap rule)', is_open(page), f'open={is_open(page)}')
    ok('…she peeks out and says a line instead', bool(b) and fl(page, "return f.peeking") is True, b)
    shot(page, '03-terminal-open-tap-talks')
    page.wait_for_timeout(6500)
    t = fl(page, "return {tucked:el.dataset.tucked,peeking:f.peeking,saved:__zhutianApp.settings.get('floatPos')}")
    ok('…then slips back to the edge; her saved spot is unchanged', t['tucked'] == 'true' and not t['peeking'] and t['saved'].get('x') == 8 and not t['saved'].get('tucked'), json.dumps(t))
    r = rect(page)
    page.touchscreen.tap(max(2, r['right'] - 8), r['y']); page.wait_for_timeout(120); page.touchscreen.tap(max(2, r['right'] - 8), r['y']); settle_wait(page, 600)
    ok('double tap (poke) with the terminal open: reaction line, terminal still open', is_open(page) and bool(bubble(page)), bubble(page))
    page.wait_for_timeout(3500)
    # the outside rule still works for real outside taps — the chat area is covered by the full-screen terminal on a phone,
    # so dispatch the pointerdown on the chat element directly (what a tap on an uncovered area does)
    page.evaluate("document.getElementById('chat').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true,pointerType:'touch'}))"); settle_wait(page, 1200)
    ok('a tap outside both (on the chat) still closes the terminal', not is_open(page))
    settle_wait(page, 800)
    t = fl(page, "return {tucked:el.dataset.tucked,left:el.getBoundingClientRect().left}")
    ok('terminal closed: she comes back to her spot', t['tucked'] == 'false' and 0 <= t['left'] < 40, json.dumps(t))
    ok('no page errors', not errs, str(errs[:2]))
    page.evaluate("(()=>{const s=__zhutianApp.settings;s.set('floatPos',null);s.set('floatSize','m');})()")
    ctx.close(); browser.close()

passed = sum(1 for _, c, _ in results if c)
print(f'{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
