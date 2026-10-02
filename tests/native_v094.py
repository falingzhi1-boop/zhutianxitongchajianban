"""0.9.4 acceptance (isolated SillyTavern + mock model only): 聊天群 → 群员 → 发布招募令.
With「随机世界」selected, a name typed into the field used to be ignored (the recruit was random anyway). Now typing
switches the mode to「指定世界」, the request really asks for that world, going back to 随机 clears the field, and an
empty 指定世界 / 指定角色 is refused before the 100-point fee. Real keyboard input through Playwright (phone viewport).
Usage: python3 tests/native_v094.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--mock-log', default='/var/tmp/qa/mock.jsonl')
ap.add_argument('--shots', default='/var/tmp/qa/shots094')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def mock_requests():
    try: return [json.loads(l) for l in open(args.mock_log, encoding='utf8') if l.strip()]
    except FileNotFoundError: return []
def body_text(req): return '\n'.join(str(m.get('content')) for m in req['body'].get('messages', []))
def recruit_reqs(before): return [body_text(r) for r in mock_requests()[before:] if '你是诸天万界聊天群的招募系统。' in body_text(r)]
def z(page): return page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
def form(page): return page.evaluate("()=>{const el=__zhutianApp.hub.shadow.getElementById('page-group');const m=el.querySelector('[data-f=rmode]'),i=el.querySelector('[data-f=rhint]');return {mode:m?.value,hint:i?.value,ph:i?.placeholder}}")
def toast(page): return page.evaluate("()=>{const t=__zhutianApp.hub.shadow.getElementById('zt-hub-toast');return t&&!t.hidden?t.textContent:''}")

def suite(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, user_agent=ANDROID_UA)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    Z.boot(page)
    page.evaluate("""async()=>{const m=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/api-center.js');
      await m.saveConfigs(__zhutianApp.bridge,'诸天记忆助手_v1',{url:'""" + args.mock + """',key:'qa-key-not-real',model:'mock-zt',maxTokens:1500});}""")
    Z.setup_chat(page)
    page.evaluate("async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const z=v.诸天系统;z.系统点=3000000;delete z.聊天群;return v;},{type:'chat'});}")
    page.evaluate("()=>{__zhutianApp.hub.open('group');}"); page.wait_for_timeout(700)
    page.evaluate("()=>{__zhutianApp.hub.shadow.querySelector('#page-group [data-gtab=\"members\"]').click()}"); page.wait_for_timeout(500)
    mode = page.locator('#page-group [data-f=rmode]'); hint = page.locator('#page-group [data-f=rhint]')
    f = form(page)
    ok('starts on 随机世界 with a placeholder that says what typing does', f['mode'] == 'rand' and '自动改为「指定世界」' in (f['ph'] or ''), json.dumps(f, ensure_ascii=False))
    hint.click(); page.keyboard.type('青丘'); page.wait_for_timeout(200)
    f = form(page)
    ok('typing a name under 随机世界 switches the mode to 指定世界 (text kept)', f['mode'] == 'world' and f['hint'] == '青丘' and '世界名' in f['ph'], json.dumps(f, ensure_ascii=False))
    page.screenshot(path=str(SHOTS / 'v094-typed.png'))
    mode.select_option('char'); page.wait_for_timeout(150)
    f = form(page)
    ok('the user can still pick 指定角色 afterwards; the text stays', f['mode'] == 'char' and f['hint'] == '青丘' and '角色名' in f['ph'], json.dumps(f, ensure_ascii=False))
    mode.select_option('rand'); page.wait_for_timeout(150)
    f = form(page)
    ok('back to 随机世界 clears the field (it would not be used)', f['mode'] == 'rand' and f['hint'] == '', json.dumps(f, ensure_ascii=False))
    # empty 指定 → refused, no fee
    mode.select_option('char'); p0 = z(page)['系统点']; before = len(mock_requests())
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-group [data-g=recruit]').click()"); page.wait_for_timeout(900)
    ok('指定角色 without a name: clear message, no 100-point fee, no model request', z(page)['系统点'] == p0 and not recruit_reqs(before) and '请填写角色名' in toast(page), f"{p0}->{z(page)['系统点']} toast={toast(page)!r}")
    # the real flow: type under 随机 → 发布 → the request asks for that world
    mode.select_option('rand'); hint.click(); page.keyboard.type('青丘'); page.wait_for_timeout(150)
    p0 = z(page)['系统点']; before = len(mock_requests())
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-group [data-g=recruit]').click()"); page.wait_for_timeout(3000)
    reqs = recruit_reqs(before); c = (z(page).get('聊天群') or {}).get('候选') or {}
    ok('发布 after typing under 随机: the model is asked for 来自世界「青丘」 (not a random world), 100 charged', reqs and '来自世界「青丘」' in reqs[-1] and z(page)['系统点'] == p0 - 100, (reqs[-1][:160] if reqs else 'no request'))
    ok('…and the candidate comes from that world (mock: 白浅)', c.get('名称') == '白浅', json.dumps(c, ensure_ascii=False)[:200])
    # 随机 with an empty field is still random
    mode.select_option('rand'); before = len(mock_requests())
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-group [data-g=recruit]').click()"); page.wait_for_timeout(3000)
    reqs = recruit_reqs(before)
    ok('随机世界 with an empty field still recruits from a random world type', reqs and '类型世界的角色' in reqs[-1] and '来自世界「' not in reqs[-1], (reqs[-1][:160] if reqs else 'no request'))
    page.screenshot(path=str(SHOTS / 'v094-after.png'))
    ok('no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    try: suite(browser)
    except Exception as e: ok('suite ran without exceptions', False, str(e)[:500])
    browser.close()
passed = sum(1 for _, c, _ in results if c)
print(f'\n{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
