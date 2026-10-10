"""1.1.5 browser regression: disposable SillyTavern + deterministic mock model only (NOT a real model, NOT a phone).
python3 tests/qa/mock_model.py &   # :5001
python3 tests/native_v115.py --isolated-test-only --base-url http://127.0.0.1:8019
Covers: 系统助手人设（设置页 → 系统光球 → 界面 / 头像 / 世界书 / 私聊请求 → 换回莉莉丝）· 功能开关（模块关闭 → 导航 /
注入 / 斜杠命令；页面隐藏）· 聊天群「从世界书召唤」→ 邀请 → 群聊带条目资料 → 正文提到 TA 时注入群员记忆。
"""
import argparse, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent / 'qa'))
import zt_common as Z
ap = argparse.ArgumentParser(); ap.add_argument('--isolated-test-only', action='store_true', required=True)
ap.add_argument('--base-url', default='http://127.0.0.1:8019'); ap.add_argument('--mock', default='http://127.0.0.1:5001/v1')
ap.add_argument('--mock-log', default='/var/tmp/qa/mock.jsonl')
ap.add_argument('--output', default='/tmp/zt-v115-evidence'); args = ap.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=True); Z.configure(args.base_url, args.mock, out)
EXT = '/scripts/extensions/third-party/zhutianxitongchajianban'
results = []
def ok(name, cond, detail=''):
    results.append({'name': name, 'pass': bool(cond), 'detail': str(detail)[:400]}); print(('PASS ' if cond else 'FAIL ') + name + ' ' + str(detail)[:400], flush=True)
def js(s, arg=None): return page.evaluate(s, arg) if arg is not None else page.evaluate(s)
def hub(body, arg=None): return page.evaluate(f"(async(arg)=>{{const app=__zhutianApp,h=app.hub,sr=h.shadow,as=app.assistant.shadow;{body}}})", arg)
def wait(ms): page.wait_for_timeout(ms)
def mock_requests():
    p = Path(args.mock_log)
    return [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines() if l.strip()] if p.exists() else []
def all_text(req): return '\n'.join(str(m.get('content', '')) for m in (req.get('body') or {}).get('messages', []))
def send_main(text):
    js("(async()=>{__zhutianApp.hub.close?.();await new Promise(r=>setTimeout(r,700));})()")
    n = js("SillyTavern.getContext().chat.length")
    page.locator('#send_textarea').fill(text); page.locator('#send_but').click()
    page.wait_for_function(f"SillyTavern.getContext().chat.length>={n + 2}", timeout=60000)
    page.wait_for_function("getComputedStyle(document.querySelector('#mes_stop')).display==='none'", timeout=60000)
    wait(2500)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox']); ctx = browser.new_context(viewport={'width': 1280, 'height': 860})
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
    Z.boot(page); Z.setup_chat(page); wait(1500)
    ok('main API connected to mock', Z.connect_main_api(page) not in (None, 'no_connection'))
    ver = js(f"(async()=>(await import('{EXT}/src/contracts.js')).VERSION)()")
    ok('version 1.1.5 loaded', ver == '1.1.5', ver)
    js(f"""async(url)=>{{const a=__zhutianApp;const api=await import('{EXT}/src/api-center.js');
      await api.saveConfigs(a.bridge,'诸天记忆助手_v1',{{url,key:'qa-key-not-real',model:'mock-zt'}});a.settings.patch('fx',{{mode:'off',outside:false}});
      a.settings.set('persona',{{...a.settings.get('persona'),preset:'lilith'}});a.settings.set('modules',{{group:true,groupAuto:true,plugins:true,slash:true,guide:true}});a.settings.set('navHidden',[]);
      await a.bridge.updateVariablesWith(v=>{{const z=v.诸天系统;z.系统点=500000;z.聊天群={{成员:[]}};return v;}},{{type:'chat',verify:true}});}}""", args.mock)

    # ---------- 系统助手人设 ----------
    hub("h.open('set');await new Promise(r=>setTimeout(r,500));")
    r = hub("const b=sr.querySelector('#page-set [data-act=persona]');if(!b)return 'missing';b.click();await new Promise(r=>setTimeout(r,500));return h.page")
    ok('设置 → 系统助手人设 opens the persona page', r == 'persona', r)
    hub("const i=sr.querySelector('#page-persona input[value=orb]');i.checked=true;i.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,300));"
        "const c=sr.querySelector('#page-persona [data-p=code]');c.value='007';c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,300));"
        "sr.querySelector('#page-persona [data-p-act=save]').click();await new Promise(r=>setTimeout(r,800));")
    st = hub("""const host=app.assistant.hostElement;return {saved:app.settings.get('persona').preset,code:app.settings.get('persona').code,name:app.persona.name,attr:host.getAttribute('data-zt-persona'),
      portrait:(as.getElementById('lilith-portrait').getAttribute('src')||'').slice(0,26),entry:(as.getElementById('entry-avatar').getAttribute('src')||'').slice(0,26),
      nav:[...sr.querySelectorAll('.zt-nav-title')].map(e=>e.textContent),float:app.float?.wanted?.(),stage:getComputedStyle(as.querySelector('.portrait .zt-stage')||document.body).display}""")
    ok('preset 系统光球 saved and applied without reload', st['saved'] == 'orb' and st['code'] == '007' and st['name'] == '系统007' and st['attr'] == 'orb', st)
    ok('portrait + launcher show the numbered orb; layered Lilith stage hidden', st['portrait'].startswith('data:image/svg+xml') and st['entry'].startswith('data:image/svg+xml') and st['stage'] in ('none', 'block'), st)
    ok('interface text follows the persona (nav group 系统007), no floating Lilith', '系统007' in st['nav'] and '莉莉丝' not in st['nav'] and st['float'] is False, st)
    page.screenshot(path=str(out / 'v115-persona-orb.png'))
    # worldbook rule swapped for this generation only (the file is untouched)
    n0 = len(mock_requests())
    send_main('人设测试：系统在吗')
    reqs = [r for r in mock_requests()[n0:] if 'Write ' in all_text(r) or 'ZhuTian' in all_text(r) or '诸天' in all_text(r)]
    main = reqs[-1] if reqs else {}
    t = all_text(main)
    ok('story prompt uses the persona rule (系统007), not 莉莉丝', '系统007' in t and '【系统007】：“' in t and '莉莉丝专属设定' not in t, t[:200] if not reqs else len(t))
    ok('persona rule carries the 称呼对照 note (old 莉莉丝 lines mean 系统007)', '【称呼对照】' in t and '指系统助手「系统007」' in t, len(t))
    raw = js("""async()=>{const c=SillyTavern.getContext();const w=await c.loadWorldInfo('诸天万界最强系统');return JSON.stringify(w).includes('系统助手莉莉丝专属设定')}""")
    ok('worldbook file itself still says 莉莉丝 (read-only override)', raw is True, raw)
    # private chat request carries the persona prompt
    n0 = len(mock_requests())
    hub("as.getElementById('header-avatar').click();await new Promise(r=>setTimeout(r,900));const i=as.getElementById('lc-input');i.value='在吗';i.dispatchEvent(new Event('input',{bubbles:true}));as.getElementById('lc-send').click();")
    got = ''
    for _ in range(20):
        wait(1000); got = hub("return as.getElementById('lc-log')?.textContent||''")
        if 'PERSONA_OK' in got: break
    priv = [r for r in mock_requests()[n0:] if '在吗' in all_text(r)]
    ok('private chat: system prompt is the persona (你是系统007…), reply shown', 'PERSONA_OK' in got and priv and all_text(priv[-1]).startswith('你是系统007'), (all_text(priv[-1])[:60] if priv else 'no request') + ' | ' + got[-60:])
    title = hub("return as.getElementById('lc-title')?.textContent||''")
    ok('private chat title renamed', '系统007' in title, title)
    hub("as.getElementById('lc-close')?.click();await new Promise(r=>setTimeout(r,400));")
    # back to Lilith
    hub("app.settings.set('persona',{...app.settings.get('persona'),preset:'lilith'});await new Promise(r=>setTimeout(r,600));")
    st = hub("return {attr:app.assistant.hostElement.getAttribute('data-zt-persona'),portrait:(as.getElementById('lilith-portrait').getAttribute('src')||'').slice(0,22),nav:[...sr.querySelectorAll('.zt-nav-title')].map(e=>e.textContent),title:as.getElementById('lc-title')?.textContent}")
    ok('换回莉莉丝 restores portrait, names and attribute live', st['attr'] is None and st['portrait'].startswith('data:image/webp') and '莉莉丝' in st['nav'] and '莉莉丝' in (st['title'] or ''), st)

    # ---------- 功能开关 ----------
    r = hub("h.go('set');await new Promise(r=>setTimeout(r,400));sr.querySelector('#page-set [data-act=switches]').click();await new Promise(r=>setTimeout(r,500));return {page:h.page,rows:sr.querySelectorAll('#page-switches tr').length}")
    ok('设置 → 功能开关 opens the table', r['page'] == 'switches' and r['rows'] >= 45, r)
    page.screenshot(path=str(out / 'v115-switches.png'))
    hub("const cb=sr.querySelector('#page-switches input[data-sw]'+'[aria-label=\"聊天群\"]');cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,600));")
    st = hub("const c=SillyTavern.getContext();return {mod:app.settings.get('modules').group,hidden:sr.querySelector('.nav-button[data-page=group]').hidden,prompt:c.extensionPrompts['zhutian-covenant-terminal/group']?.value||''}")
    ok('聊天群 off: nav button hidden, story injection empty', st['mod'] is False and st['hidden'] is True and st['prompt'] == '', st)
    r = hub("h.go('group');await new Promise(r=>setTimeout(r,300));return h.page")
    ok('go(group) while off stays on the current page', r != 'group', r)
    n0 = len(mock_requests()); send_main('聊天群关闭时的一轮剧情。')
    main = [r for r in mock_requests()[n0:] if '验收' in all_text(r) or 'Write ' in all_text(r)]
    ok('聊天群 off: the plugin worldbook rule 36 (与正文衔接) is not sent either', main and '与正文衔接' not in all_text(main[-1]) and '诸天万界' in all_text(main[-1]), len(main))
    hub("h.open('switches');await new Promise(r=>setTimeout(r,600));")
    hub("const cb=sr.querySelector('#page-switches input[aria-label=\"聊天群\"]');cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,500));")
    ok('聊天群 back on', hub("return !sr.querySelector('.nav-button[data-page=group]').hidden && app.settings.get('modules').group===true") is True)
    hub("const cb=sr.querySelector('#page-switches input[aria-label=\"斜杠命令 /zt\"]');cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,300));")
    slash = js("(async()=>{const c=SillyTavern.getContext();const r=await c.executeSlashCommandsWithOptions?.('/zt status');return r?.pipe||''})()")
    ok('斜杠命令 off: /zt answers that it is switched off', '功能开关' in str(slash), slash)
    hub("const cb=sr.querySelector('#page-switches input[aria-label=\"斜杠命令 /zt\"]');cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,300));")
    hub("const cb=sr.querySelector('#page-switches input[data-page-sw=shop]');cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,400));")
    st = hub("return {hidden:sr.querySelector('.nav-button[data-page=shop]').hidden,list:app.settings.get('navHidden')}")
    ok('终端页面: 商城 taken out of the navigation', st['hidden'] is True and st['list'] == ['shop'], st)
    hub("sr.querySelector('#page-switches [data-sw-act=all-on]').click();await new Promise(r=>setTimeout(r,500));")
    ok('全部开启 restores pages', hub("return !sr.querySelector('.nav-button[data-page=shop]').hidden && app.settings.get('navHidden').length===0") is True)

    # ---------- 聊天群 × 世界书 ----------
    hub("h.open('ov');await new Promise(r=>setTimeout(r,400));h.go('group');await new Promise(r=>setTimeout(r,500));sr.querySelector('#page-group [data-gtab=members]').click();await new Promise(r=>setTimeout(r,400));")
    r = hub("const el=sr.getElementById('page-group');const opts=[...el.querySelectorAll('[data-f=wbook] option')].map(o=>o.value);const s=el.querySelector('[data-f=wbook]');s.value='Eldoria';el.querySelector('[data-f=wq]').value='glade';el.querySelector('[data-g=wb-find]').click();await new Promise(r=>setTimeout(r,1200));return {opts,hits:[...el.querySelectorAll('.zt-g-wbhit b')].map(b=>b.textContent)}")
    ok('从世界书召唤: lists books (without the 诸天 book) and finds entries', 'Eldoria' in r['opts'] and '诸天万界最强系统' not in r['opts'] and 'glade' in r['hits'], r)
    hub("sr.querySelector('#page-group [data-wb-summon]').click();await new Promise(r=>setTimeout(r,2500));")
    cand = hub("return app.group.group().候选")
    ok('召唤 → candidate carries 来源 {book, uid, comment}', cand and cand.get('来源', {}).get('book') == 'Eldoria' and cand.get('名称') == 'glade', cand)
    hub("sr.querySelector('#page-group [data-g=invite]').click();await new Promise(r=>setTimeout(r,1500));")
    mem = hub("return app.group.group().成员.find(m=>m.来源)||null")
    ok('邀请入群 keeps the worldbook source on the member', mem and mem['来源']['book'] == 'Eldoria', mem)
    chip = hub("return !!sr.querySelector('#page-group .zt-g-member .zt-chip')")
    ok('member card shows 📖 世界书', chip is True)
    page.screenshot(path=str(out / 'v115-group-worldbook.png'))
    n0 = len(mock_requests())
    hub("app.group.view='chat';app.group.paint();await new Promise(r=>setTimeout(r,300));const i=sr.querySelector('#zt-g-input');i.value='大家好';sr.querySelector('#page-group [data-g=send]').click();await new Promise(r=>setTimeout(r,3500));")
    grp_req = [r for r in mock_requests()[n0:] if '你是诸天万界聊天群。' in all_text(r)]
    ok('group round prompt includes the entry (世界书资料)', grp_req and '【世界书资料（只读参考）】' in all_text(grp_req[-1]) and 'glade' in all_text(grp_req[-1]), len(grp_req))
    n0 = len(mock_requests())
    send_main('我走进了 glade，四处张望。')
    main = [r for r in mock_requests()[n0:] if '验收' in all_text(r) or 'Write ' in all_text(r)]
    t = all_text(main[-1]) if main else ''
    ok('群员记忆注入: the story prompt recalls the group when the member appears', '【诸天聊天群 · 群员记忆】' in t and 'glade' in t, len(t))
    ok('聊天群 on: rule 36 (与正文衔接) is back in the story prompt', '与正文衔接' in t, len(t))
    hub("app.settings.patch('groupWorld',{memory:false});await new Promise(r=>setTimeout(r,300));")
    n0 = len(mock_requests()); send_main('glade 又出现了。')
    main = [r for r in mock_requests()[n0:] if '验收' in all_text(r) or 'Write ' in all_text(r)]
    ok('群员记忆注入 switch off → no recall', main and '群员记忆' not in all_text(main[-1]))
    hub("app.settings.patch('groupWorld',{memory:true});")
    wb_after = js("""async()=>{const c=SillyTavern.getContext();const w=await c.loadWorldInfo('Eldoria');return Object.keys(w.entries).length}""")
    ok('worldbook Eldoria not modified (entry count unchanged)', isinstance(wb_after, int) and wb_after > 0, wb_after)

    real_errors = [e for e in errors if 'favicon' not in e]
    ok('no page errors', not real_errors, real_errors[:3])
    browser.close()
passed = sum(r['pass'] for r in results)
(out / 'native_v115.json').write_text(json.dumps({'passed': passed, 'total': len(results), 'results': results}, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'{passed}/{len(results)} passed'); sys.exit(0 if passed == len(results) else 1)
