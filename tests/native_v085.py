"""0.8.5 acceptance (isolated SillyTavern + mock model only; no real keys, no user data):
  * AI 接口设置: plain status line, 3 steps, radios not stretched (desktop + phone 390×844), advanced section closed,
    inconsistent → ⚠ line, save → ✓ 已设置
  * 账本核验: hint under 「立即核验最新正文」; pressed too early → the two switches and the save button are highlighted and
    the status line explains what to do; ticked but not saved → says 还没保存; after saving the original check runs
  * phone: a generation whose end event never arrives (backgrounded browser) no longer leaves the raw <ZhuTianPanel>
    text in the last floor; 兼容诊断 shows 最新楼层 ✅ and has 重新渲染楼层
Usage: python3 tests/native_v085.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots085')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def js(page, body, arg=None): return page.evaluate('(async(arg)=>{const app=__zhutianApp,h=app.hub,sr=h.shadow;' + body + '})', arg)
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'))

FORM_PROBE = """const f=sr.querySelector('#page-api .zt-api-inline form');if(!f)return null;
  const radios=[...f.querySelectorAll('input[name=mode]')].map(r=>{const rr=r.getBoundingClientRect(),t=r.closest('label').querySelector('b').getBoundingClientRect();return {w:Math.round(rr.width),gap:Math.round(t.left-rr.right),sameRow:Math.abs((t.top+t.bottom)/2-(rr.top+rr.bottom)/2)<14}});
  const det=f.querySelector('details');const ls=[...f.querySelectorAll('input[name=mode]')].map(r=>r.closest('label').getBoundingClientRect());
  return {radios,state:f.querySelector('[data-state]').innerText,steps:[...f.querySelectorAll('span[style*="border-radius:50%"]')].filter(s=>s.offsetParent).map(s=>s.textContent),
    advClosed:det&&!det.open,toStatusInAdv:!!det?.querySelector('input[name=toStatus]'),cardGap:Math.round(ls[1].top-ls[0].bottom),title:f.querySelector('b').textContent}"""

def api_form(page, label):
    js(page, "h.open('api');await new Promise(r=>setTimeout(r,1300));")
    r = js(page, FORM_PROBE)
    ok(f'{label}: radios are normal size and sit right next to their text (were stretched to half the row)',
       r and all(x['w'] <= 24 and 0 <= x['gap'] <= 24 and x['sameRow'] for x in r['radios']) and 0 <= r['cardGap'] <= 16, json.dumps(r and [r['radios'], r['cardGap']]))
    ok(f'{label}: 3 numbered steps, title 连接 · AI 接口设置, advanced section closed (保存到… inside it)',
       r and r['steps'] == ['1', '2', '3'] and r['title'] == '连接 · AI 接口设置' and r['advClosed'] and r['toStatusInAdv'], json.dumps(r, ensure_ascii=False)[:300])
    return r

def api_suite(page):
    # two different configs → ⚠ 不一致 in plain words
    js(page, """const m=await import(app.base+'src/api-center.js');const ns=app.original.ZhuTianMemoryCore?.NS;
      await m.saveConfigs(app.bridge,ns,{url:arg,key:'sk-qa-only',model:'mock-zt'},{status:true,assistant:false});
      await m.saveConfigs(app.bridge,ns,{url:'https://example.invalid/v1',key:'sk-qa-other',model:'other'},{status:false,assistant:true});""", args.mock)
    r = api_form(page, 'desktop')
    ok('inconsistent configs: the status line says 两处用的 API 不一致 and names both uses in plain words',
       r and '两处用的 API 不一致' in r['state'] and '状态栏 AI 功能' in r['state'] and '莉莉丝私聊' in r['state'], r and r['state'])
    shot(page, '01-api-inconsistent')
    js(page, """const f=sr.querySelector('#page-api .zt-api-inline form');f.querySelector('input[value=custom]').click();f.url.value=arg;f.key.value='sk-qa-only';f.model.value='mock-zt';
      sr.querySelector('#page-api [data-act=save]').click();await new Promise(r=>setTimeout(r,1500));""", args.mock)
    st = js(page, "return sr.querySelector('#page-api [data-state]').innerText")
    ok('after 保存: ✓ 已设置, one line, both uses share it', '✓ 已设置' in st and '127.0.0.1:5001' in st and '不一致' not in st, st)
    js(page, "const f=sr.querySelector('#page-api .zt-api-inline form');f.querySelector('input[value=main]').click();await new Promise(r=>setTimeout(r,300));")
    r = js(page, "const f=sr.querySelector('#page-api .zt-api-inline form');return {custom:getComputedStyle(f.querySelector('[data-custom]')).display,steps:[...f.querySelectorAll('span[style*=\"border-radius:50%\"]')].filter(s=>s.offsetParent).map(s=>s.textContent)}")
    ok('choosing 直接用酒馆正在用的模型 hides the address/key step and renumbers (1, 2)', r['custom'] == 'none' and r['steps'] == ['1', '2'], json.dumps(r))
    shot(page, '02-api-main-mode')
    js(page, "const f=sr.querySelector('#page-api .zt-api-inline form');f.querySelector('input[value=custom]').click();h.close();await new Promise(r=>setTimeout(r,900));")

def ledger_suite(page):
    js(page, "h.open('memory');await new Promise(r=>setTimeout(r,1200));const s=app.assistant.shadow;for(const id of ['enabled','ledger-assist']){const i=s.getElementById(id);if(i.checked)i.click();}s.getElementById('save-chat').click();await new Promise(r=>setTimeout(r,1200));")
    r = js(page, "const s=app.assistant.shadow,b=s.getElementById('ledger-check');return {btn:!!b,hint:b?.nextElementSibling?.className==='zt-ledger-hint'?b.nextElementSibling.textContent:''}")
    ok('记忆 page: a hint under 「立即核验最新正文」 says what it does and what to tick first', r['btn'] and '在当前聊天启用助手与记忆注入' in r['hint'] and '保存当前聊天设置' in r['hint'], r['hint'][:120])
    js(page, "app.assistant.shadow.getElementById('ledger-check').click();await new Promise(r=>setTimeout(r,500));")
    r = js(page, """const s=app.assistant.shadow;const o=id=>{const e=s.getElementById(id);const l=id==='save-chat'?e:e.closest('label');return getComputedStyle(l).outlineStyle!=='none'};
      return {status:s.getElementById('status').textContent,lit:[o('enabled'),o('ledger-assist'),o('save-chat')],toast:[...document.querySelectorAll('#toast-container .toast')].map(t=>t.textContent).join(' | ')}""")
    ok('pressed before setup: the two switches and the save button are highlighted', all(r['lit']), json.dumps(r['lit']))
    ok('…the status line and a toast explain it in plain words (no more 请先启用当前聊天与账本核验；未写入。)',
       '勾选' in r['status'] and '保存当前聊天设置' in r['status'] and '请先启用当前聊天与账本核验' not in r['status'] and '账本核验' in r['toast'], r['status'][:120])
    shot(page, '03-ledger-guide')
    js(page, "const s=app.assistant.shadow;for(const id of ['enabled','ledger-assist']){const i=s.getElementById(id);if(!i.checked)i.click();}s.getElementById('ledger-check').click();await new Promise(r=>setTimeout(r,700));")
    st = js(page, "return app.assistant.shadow.getElementById('status').textContent")
    ok('ticked but not saved: the original refuses and the line now says 还没保存 → 点「保存当前聊天设置」', '还没保存' in st and '保存当前聊天设置' in st, st[:120])
    js(page, "app.assistant.shadow.getElementById('save-chat').click();await new Promise(r=>setTimeout(r,1500));app.assistant.shadow.getElementById('ledger-check').click();await new Promise(r=>setTimeout(r,1500));")
    st = js(page, "return app.assistant.shadow.getElementById('status').textContent")
    ok('after saving: the original 核验 runs (no setup message any more)', '请先启用' not in st and '还没' not in st and '勾选' not in st, st[:160])
    # leave the chat as the other suites expect it
    js(page, "const s=app.assistant.shadow;for(const id of ['enabled']){const i=s.getElementById(id);if(i.checked)i.click();}s.getElementById('save-chat').click();await new Promise(r=>setTimeout(r,900));h.close();await new Promise(r=>setTimeout(r,900));")

def phone_suite(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda x: x.accept())
    Z.boot(page); Z.open_chat(page)
    api_form(page, 'phone')
    shot(page, '04-phone-api')
    js(page, "h.close();await new Promise(r=>setTimeout(r,900));")
    mes = '第六幕。云府的晨钟响了。\n\n<ZhuTianPanel>\n系统点: 3000\n当前任务: 恢复之名\n任务进度: 35\n系统播报: 主人主人~\n</ZhuTianPanel>'
    r = page.evaluate('''async mes=>{const c=SillyTavern.getContext();
      const stop=document.getElementById('mes_stop');
      // lock check first: GENERATION_STARTED fires before SillyTavern shows the stop button → still counts as generating
      await c.eventSource.emit(c.eventTypes.GENERATION_STARTED,'normal',{},false);
      const lockBeforeButton=__zhutianApp.adapter.isGenerating();
      stop.style.display='flex'; await new Promise(r=>setTimeout(r,200));                // what deactivateSendButtons() does
      const m={name:c.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes,extra:{},swipe_id:0,swipes:[mes]};
      c.chat.push(m);c.addOneMessage(m);await c.eventSource.emit(c.eventTypes.CHARACTER_MESSAGE_RENDERED,c.chat.length-1,'normal');
      await new Promise(r=>setTimeout(r,800));
      const t0=[...document.querySelectorAll('#chat .mes[mesid]')].at(-1).querySelector('.mes_text');
      const skippedWhileStreaming=!t0.querySelector(':scope > .zt-render-mark');                // stop visible → last floor left alone
      stop.style.display='none';                                                           // generation over …and GENERATION_ENDED never comes
      await new Promise(r=>setTimeout(r,2500));
      const t=[...document.querySelectorAll('#chat .mes[mesid]')].at(-1).querySelector('.mes_text');
      return {lockBeforeButton,skippedWhileStreaming,ours:!!t.querySelector(':scope > .zt-render-mark'),raw:/系统点: 3000/.test(t.innerText),tag:!!t.querySelector('.zt-floor-tag-box,[data-floor]'),gen:__zhutianApp.adapter.generating,diag:__zhutianApp.statusbar.diagnoseLast?.()}}''', mes)
    ok('phone, end-of-generation event lost: the last floor still renders (no raw <ZhuTianPanel> text; was the reported bug)', r['ours'] and not r['raw'] and r['tag'], json.dumps(r, ensure_ascii=False)[:300])
    ok('…the stale “generating” flag cleared itself once the stop button disappeared', r['gen'] is False)
    ok('…while the stop button was visible the last floor was left alone (no flicker during streaming)', r['skippedWhileStreaming'])
    ok('send lock unchanged: right after GENERATION_STARTED (button not shown yet) it still counts as generating', r['lockBeforeButton'] is True)
    shot(page, '05-phone-floor-rendered')
    r = page.evaluate('''async()=>{const c=SillyTavern.getContext();
      const stop=document.getElementById('mes_stop');                                       // stuck again, then edit through the real UI
      await c.eventSource.emit(c.eventTypes.GENERATION_STARTED,'normal',{},false);stop.style.display='flex';await new Promise(r=>setTimeout(r,200));stop.style.display='none';await new Promise(r=>setTimeout(r,300));
      const el=[...document.querySelectorAll('#chat .mes[mesid]')].at(-1);
      el.querySelector('.mes_edit').click();await new Promise(r=>setTimeout(r,600));
      const ta=el.querySelector('.edit_textarea');const rawInEditor=/系统点: 3000/.test(ta?.value||'');
      ta.value=ta.value.replace('系统点: 3000','系统点: 3456');ta.dispatchEvent(new Event('input',{bubbles:true}));
      el.querySelector('.mes_edit_done').click();await new Promise(r=>setTimeout(r,2500));
      const t=el.querySelector('.mes_text');
      return {rawInEditor,ours:!!t.querySelector(':scope > .zt-render-mark'),raw:/系统点: 3456/.test(t.innerText),saved:/3456/.test(c.chat.at(-1).mes)}}''')
    ok('phone: 编辑 shows the original text in ST\'s editor (expected); after ✔ the floor renders again (not raw)', r['rawInEditor'] and r['saved'] and r['ours'] and not r['raw'], json.dumps(r))
    js(page, "await app.features.openDiagnostics();await new Promise(r=>setTimeout(r,900));")
    d = page.evaluate("[...document.querySelectorAll('.popup, dialog')].map(x=>x.innerText).join('\\n')")
    ok('兼容诊断 shows 最新楼层 ✅ and a 重新渲染楼层 button', '最新楼层：✅' in d and '重新渲染楼层' in d, [l for l in d.split('\n') if '最新楼层' in l][:1])
    shot(page, '06-phone-diagnostics')
    page.keyboard.press('Escape'); page.wait_for_timeout(500)
    page.evaluate("(async()=>{const c=SillyTavern.getContext();c.chat.pop();await c.saveChat();await c.reloadCurrentChat();})()"); page.wait_for_timeout(1500)
    ok('phone: no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1400, 'height': 900}); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda x: x.accept())
    Z.boot(page); Z.setup_chat(page)
    for name, fn in [('api', api_suite), ('ledger', ledger_suite)]:
        try: fn(page)
        except Exception as e: ok(f'{name} suite ran without exceptions', False, str(e)[:400]); shot(page, f'zz-error-{name}')
    ok('desktop: no page errors', not errs, '; '.join(errs)[:300])
    page.close()
    try: phone_suite(browser)
    except Exception as e: ok('phone suite ran without exceptions', False, str(e)[:400])
    browser.close()

passed = sum(1 for _, c, _ in results if c)
print(f'\n{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
