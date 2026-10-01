"""0.8.0 acceptance (isolated SillyTavern + mock model only): engine numbers follow outside ledger writes (签到), Lilith's
line moves to the portrait bubble + story lines on blank clicks, admin console from settings, 自拟外挂 in the navigation
with a real charge, original Lilith pages follow the world theme, 熟练度 (功法实效 prompt, 实战积累, 角色卡功法 import).
Every ledger claim is checked against chat variables read back from the host.
Usage: python3 tests/native_v080.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots080')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def js(page, body): return page.evaluate('(async()=>{const app=__zhutianApp,h=app.hub,sr=h.shadow;' + body + '})()')
def z(page): return page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
def commit(page, body):
    return js(page, "const L=await import(app.base+'src/ledger-ops.js');await L.commit(app.bridge,(v,z)=>{" + body + "},z=>[JSON.stringify(z).length]);return 1")
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'))
def eng(page, body): return js(page, "const d=h.engineFrame?.contentDocument;if(!d)return null;" + body)
def wait_engine(page, ms=15000):
    page.wait_for_function("(()=>{const h=__zhutianApp.hub;try{return !!h.engineFrame?.contentDocument?.querySelector('.mvu-sys')?.__ztDataReady}catch{return false}})()", timeout=ms)
    page.wait_for_timeout(700)
def push_floor(page, mes):
    page.evaluate('''async mes=>{const c=SillyTavern.getContext();
      c.chat.push({name:c.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes,extra:{},swipe_id:0,swipes:[mes]});
      await c.saveChat(); await c.reloadCurrentChat();}''', mes)
    page.wait_for_timeout(2500)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, device_scale_factor=1)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    page.on('dialog', lambda d: d.accept())
    Z.boot(page); Z.setup_chat(page)

    # ---- (c) engine numbers follow an outside write (签到 in 聊天群) ----
    js(page, "h.open('ov');return 1"); wait_engine(page)
    js(page, "sr.getElementById('reset-window')?.click();return 1"); page.wait_for_timeout(600)   # a phone run may have saved a small window
    before = eng(page, "return d.querySelector('#sb-pts')?.textContent")
    ok('engine 基础概览 shows the ledger value after load', before == '1,200', str(before))
    js(page, "await app.group.signIn();return 1"); page.wait_for_timeout(1500)
    pts = z(page)['系统点']
    top = js(page, "return sr.getElementById('zt-top-pts').textContent")
    shown = eng(page, "return d.querySelector('#sb-pts')?.textContent")
    ok('签到 wrote the ledger (read back)', pts > 1200, str(pts))
    ok('top bar and 基础概览 agree after 签到 (was: top new value, page old panel value)', top == shown == f'{pts:,}', f'top={top} page={shown}')
    shot(page, '01-ov-after-signin')

    # chat whose floors have NO data block yet (the user's case: 签到 before the first AI panel)
    page.evaluate('''async()=>{const c=SillyTavern.getContext(); c.chat.splice(1);
      c.chat.push({name:c.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes:'开场，没有数据块。',extra:{},swipe_id:0,swipes:['开场，没有数据块。']});
      c.chatMetadata.variables={诸天系统:{系统点:100,当前世界:'太初仙域',背包:[],任务库:{}}}; await c.saveMetadata(); await c.saveChat(); await c.reloadCurrentChat();}''')
    page.wait_for_timeout(2500); js(page, "h.reloadEngine();return 1"); wait_engine(page)
    shown = eng(page, "return d.querySelector('#sb-pts')?.textContent")
    ok('no AI panel yet: 基础概览 shows the ledger 系统点 (100), not the empty panel 0', shown == '100', str(shown))
    Z.setup_chat(page); js(page, "h.open('ov');h.reloadEngine();return 1"); wait_engine(page)

    # ---- (b) Lilith row hidden, line spoken from the portrait ----
    disp = eng(page, "const m=d.querySelector('.mvu-msg');return m?getComputedStyle(m).display:'missing'")
    ok('the status-bar 莉莉丝 row is hidden inside the terminal', disp == 'none', str(disp))
    js(page, "app.lilith.heard='';h.refreshEngineView();return 1"); page.wait_for_timeout(1500)
    bubble = js(page, "return app.assistant.stage()?.bubble?.textContent||''")
    ok('the panel 系统播报 is spoken in the portrait bubble', '楼层测试' in bubble, bubble)
    page.wait_for_timeout(1200)
    # a visible point of the portrait that is background (inside the stage frame, not a body zone)
    pt = js(page, """const st=app.assistant.stage(),f=st?.frame;if(!f)return null;const r=f.getBoundingClientRect(),sh=app.assistant.shadow;
      for(let gy=0.05;gy<0.95;gy+=0.05)for(let gx=0.03;gx<0.97;gx+=0.04){const x=r.x+r.width*gx,y=r.y+r.height*gy,e=sh.elementFromPoint(x,y);
        if(e&&f.contains(e)&&!e.closest('.zt-zone')&&!e.closest('.zt-say'))return [x,y];}return null""")
    said = []
    if pt:
        for i in range(3):
            page.mouse.click(pt[0], pt[1])
            page.wait_for_timeout(1000)
            said.append(js(page, "return app.assistant.stage()?.bubble?.textContent||''"))
    ok('blank clicks on the portrait give story lines (different each time)', len(set(said)) >= 2 and any(('系统点' in s) or ('太初仙域' in s) or ('引气入体' in s) or ('楼层测试' in s) for s in said), ' | '.join(said))
    shot(page, '02-bubble-story')

    # ---- (a) original Lilith pages follow the world theme ----
    js(page, "h.go('work');return 1"); page.wait_for_timeout(800)
    card_bg = js(page, "const c=sr.querySelector('#page-work .card');return c?getComputedStyle(c).backgroundImage:''")
    status_bg = js(page, "const s=sr.querySelector('.statusbar');return s?getComputedStyle(s).backgroundColor:''")
    ok('xianxia: workbench cards use the theme surface (no purple; 0.8.4 墨玉金 #1f2222)', 'rgb(31, 34, 34)' in card_bg, card_bg[:120])
    ok('xianxia: bottom status line uses the theme bar colour (0.8.4 墨玉金 #151718)', status_bg == 'rgb(21, 23, 24)', status_bg)
    shot(page, '03-work-xianxia')
    js(page, "app.settings.patch('world',{theme:'default'});app.world.sync(true);return 1"); page.wait_for_timeout(600)
    card_bg2 = js(page, "const c=sr.querySelector('#page-work .card');return c?getComputedStyle(c).backgroundImage:''")
    ok('default theme keeps the original purple card', 'rgb(37, 28, 48)' in card_bg2, card_bg2[:120])
    js(page, "app.settings.patch('world',{theme:'auto'});app.world.sync(true);return 1"); page.wait_for_timeout(400)

    # ---- (d) admin console from settings ----
    js(page, "h.go('set');return 1"); page.wait_for_timeout(500)
    page.locator('#page-set [data-act="admin"]').click()
    page.wait_for_function("(()=>{const d=__zhutianApp.hub.engineFrame?.contentDocument;const o=d?.querySelector('#admin-overlay');return o&&!o.hidden})()", timeout=15000)
    ok('设置 → 管理员控制台 opens the original admin panel', True)
    ok('the engine is not reloaded while the admin panel is open (busy guard)', js(page, "return h.engineBusy") is True)
    eng(page, "const i=d.querySelector('#adm-pts');i.value='7777';i.dispatchEvent(new Event('input',{bubbles:true}));d.querySelector('.btn-admin-save').click();return 1")
    page.wait_for_timeout(2000)
    ok('admin save writes 系统点 to the ledger', z(page)['系统点'] == 7777, str(z(page)['系统点']))
    shown = eng(page, "return d.querySelector('#sb-pts')?.textContent"); top = js(page, "return sr.getElementById('zt-top-pts').textContent")
    ok('top bar and engine show the admin value', top == shown == '7,777', f'top={top} page={shown}')
    shot(page, '04-admin')
    eng(page, "d.querySelector('.btn-admin-close')?.click();return 1"); page.wait_for_timeout(600)

    # ---- (e) 自拟外挂: navigation + real charge ----
    has_nav = js(page, "return !!sr.querySelector('.zt-nav-group[data-group=\"能力\"] .nav-button[data-page=\"plugmgr\"]')")
    ok('自拟外挂 is in the 能力 navigation', has_nav)
    js(page, "h.go('plug');return 1"); page.wait_for_timeout(800)
    page.locator('#zt-engine-tools [data-plug-new]').click(); page.wait_for_timeout(600)
    ok('＋ 自拟外挂 opens the editor with the name field focused', js(page, "return h.page==='plugmgr' && sr.activeElement?.dataset?.f==='name'"))
    ed = page.locator('#zt-plug-editor')
    ed.locator('[data-f="name"]').fill('时停怀表'); ed.locator('[data-f="type"]').select_option('active')
    ed.locator('[data-f="cost.kind"]').select_option('points'); ed.locator('[data-f="cost.amount"]').fill('777')
    ed.locator('[data-f="rule"]').fill('发动后时间静止 3 秒。'); ed.locator('[data-save]').click(); page.wait_for_timeout(1200)
    js(page, "h.go('plug');return 1"); page.wait_for_timeout(800)
    t0 = z(page).get('界面记账时间', 0)
    page.locator('#zt-engine-tools [data-plug-use]').first.click(); page.wait_for_timeout(1800)
    led = z(page)
    ok('发动 charges 777 系统点 through the ledger', led['系统点'] == 7000, str(led['系统点']))
    ok('the charge stamps 界面记账时间 (no refund by the next AI panel)', led.get('界面记账时间', 0) > t0, f"{t0} → {led.get('界面记账时间')}")
    ok('the action text is in the chat input', '发动外挂：时停怀表' in page.evaluate("document.getElementById('send_textarea').value"))
    page.evaluate("document.getElementById('send_textarea').value=''")

    # ---- (g) 熟练度: 功法实效 prompt + 实战积累 ----
    commit(page, "z.功法库=[{名称:'太极拳',品阶:'凡品',上限:100,熟练度:98},{名称:'青云诀',品阶:'灵品',上限:500,熟练度:200}];z.功法={名称:'青云诀',熟练度:200,上限:500};z.功法记录=[];z.功法待播报=[]")
    page.wait_for_timeout(800)
    prompt = page.evaluate("(()=>{const p=SillyTavern.getContext().extensionPrompts||{};return String(p['zhutian-covenant-terminal/mastery']?.value||'')})()")
    ok('功法实效 prompt is injected with stage effects', '功法实效' in prompt and '青云诀〔灵品〕200/500【入门】' in prompt, prompt[:160])
    push_floor(page, '第四幕。他随手打出一套太极拳，逼退来敌。\n\n' + Z.PANEL(7000, '30/100', '引气入体'))
    js(page, "h.open('cult');return 1")
    try: page.wait_for_function("(__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.功法库||[]).find(s=>s.名称==='太极拳')?.熟练度>98", timeout=15000)
    except Exception: pass
    led = z(page); tj = next((s for s in led.get('功法库', []) if s['名称'] == '太极拳'), {})
    ok('实战积累: used in the story, missing in 功法修炼 → +2 (capped at 凡品 100)', tj.get('熟练度') == 100, str(tj))
    ok('stage-up queued for the model (功法待播报 太极拳→入门)', any(x.get('名称') == '太极拳' and x.get('阶段') == '入门' for x in led.get('功法待播报', [])), json.dumps(led.get('功法待播报'), ensure_ascii=False)[:200])
    ok('receipt recorded in 功法记录', any('实战积累' in str(x.get('变化')) and x.get('凭据') for x in led.get('功法记录', [])))
    qy = next((s for s in led.get('功法库', []) if s['名称'] == '青云诀'), {})
    ok('a skill not used in the story is untouched', qy.get('熟练度') == 200, str(qy))
    js(page, "h.reloadEngine();return 1"); wait_engine(page); page.wait_for_timeout(1500)
    n_log = sum(1 for x in z(page).get('功法记录', []) if '实战积累' in str(x.get('变化')))
    ok('re-rendering the same floor does not add again', n_log == 1, str(n_log))
    strip = js(page, "return sr.getElementById('zt-engine-tools')?.textContent||''")
    ok('修行 strip shows the main skill stage and the last 实战积累', '青云诀' in strip and '实战 太极拳 +2' in strip, strip[:160])

    # ---- (h) 角色卡功法 import ----
    page.evaluate('''async()=>{const c=SillyTavern.getContext(); c.chatMetadata.variables.角色状态={主角:{功法:{独孤九剑:[{熟练度:[600,''],品阶:['仙品','']},'剑法'],青云诀:[150,'']}}}; await c.saveMetadata();}''')
    js(page, "h.go('skills');return 1"); page.wait_for_timeout(800)
    src = js(page, "return sr.querySelector('#page-skills')?.textContent||''")
    ok('skills page lists the card skills with their source path', '独孤九剑' in src and '聊天变量.角色状态.主角.功法.独孤九剑' in src, src[:200])
    page.locator('#page-skills [data-sk-import]').first.click(); page.wait_for_timeout(1800)
    led = z(page); lib = {s['名称']: s for s in led.get('功法库', [])}
    ok('import adds 独孤九剑 仙品 600/2000', lib.get('独孤九剑', {}).get('熟练度') == 600 and lib['独孤九剑'].get('品阶') == '仙品', str(lib.get('独孤九剑')))
    ok('import never lowers (青云诀 stays 200, card says 150)', lib.get('青云诀', {}).get('熟练度') == 200, str(lib.get('青云诀')))
    ok('import recorded (角色卡功法同步 + 功法记录)', (led.get('角色卡功法同步') or {}).get('变化') == 1 and any('角色卡' in str(x.get('变化')) for x in led.get('功法记录', [])), json.dumps(led.get('角色卡功法同步'), ensure_ascii=False))
    ok('card variables were not modified', page.evaluate("JSON.stringify(SillyTavern.getContext().chatMetadata.variables.角色状态)").count('600') == 1)
    shot(page, '05-skills')

    # ---- phone: no portrait → broadcast shown by the floating Lilith (0.8.2; before: terminal toast) ----
    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(800)
    js(page, "app.lilith.heard='';app.lilith.readBroadcast({querySelector:()=>({textContent:'手机播报测试'})});return 1"); page.wait_for_timeout(500)
    toast = js(page, "const t=sr.getElementById('zt-hub-toast');return t&&!t.hidden?t.textContent:''")
    stage_vis = js(page, "return app.lilith.stageVisible()")
    floater = page.evaluate("(()=>{const sh=document.getElementById('zhutian-lilith-float')?.shadowRoot;const b=sh?.querySelector('.bubble');return b&&b.classList.contains('show')?b.textContent:''})()")   # 0.8.2: floating Lilith
    ok('phone: broadcast is visible (floating Lilith bubble, portrait bubble or toast)', ('手机播报测试' in toast) or ('手机播报测试' in floater) or (stage_vis and '手机播报测试' in js(page, "return app.assistant.stage()?.bubble?.textContent||''")), f'toast={toast} float={floater} stage={stage_vis}')
    shot(page, '06-phone')

    page.set_viewport_size({'width': 1400, 'height': 900}); page.wait_for_timeout(500)
    js(page, "sr.getElementById('reset-window')?.click();return 1"); page.wait_for_timeout(400)
    ok('no page errors', not errs, ' | '.join(errs[:3]))
    b.close()

passed = sum(1 for r in results if r[1]); print(f'{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
