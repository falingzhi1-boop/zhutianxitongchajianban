"""1.0.0 acceptance (isolated SillyTavern + mock model only).
  * floating Lilith is the cut-out figure (no card), the parts load, a tap changes her face;
  * settings page: 常用 open, 进阶 / 诊断 folded, search opens the matching group;
  * 导出 / 导入存档: the file has the ledger but no API key; import shows a preview, backs up first, reads back, keeps the key;
  * 账本回滚 by clicking in the popup, with the pre-rollback state backed up;
  * a ledger from a newer plugin (structure version) is read-only; an old one is upgraded after a backup;
  * error lines say whether the ledger changed; /zt init does not open the worldbook popup any more;
  * landscape phone rail: six pinned pages + 更多; 动态效果 精简.
Usage: python3 tests/native_v100.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots100')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
EXT = '/scripts/extensions/third-party/zhutianxitongchajianban/src/'
KEY = 'sk-qa1000notrealkey000000'

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def z(page): return page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
def backups(page): return page.evaluate("__zhutianApp.bridge.backups().map(b=>({at:b.at,reason:b.reason||'',bal:b.balance}))")
def popup_text(page): return page.evaluate("()=>[...document.querySelectorAll('.zt-popup')].at(-1)?.innerText||''")
def close_popups(page):
    page.evaluate("()=>{for(const d of document.querySelectorAll('dialog.popup[open]')) d.querySelector('.popup-button-ok')?.click();}"); page.wait_for_timeout(500)
def stored_key(page):
    return page.evaluate("async()=>{const m=await import('" + EXT + "api-center.js');const c=m.readConfigs(__zhutianApp.bridge,'诸天记忆助手_v1');return JSON.stringify(c);}")

def phone(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, user_agent=ANDROID_UA, accept_downloads=True)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    Z.boot(page)
    page.evaluate("async()=>{const m=await import('" + EXT + "api-center.js');await m.saveConfigs(__zhutianApp.bridge,'诸天记忆助手_v1',{url:'" + args.mock + "',key:'" + KEY + "',model:'mock-zt',maxTokens:1500});}")
    Z.setup_chat(page)

    # ---------- floating Lilith ----------
    page.evaluate("()=>{__zhutianApp.settings.set('floatLilith','on')}"); page.wait_for_timeout(1500)
    f = page.evaluate("""()=>{const fl=__zhutianApp.float;const sh=fl?.el?.getRootNode();if(!sh)return null;
      const imgs=[...sh.querySelectorAll('img')];const fig=sh.querySelector('.fig');const r=fig?.getBoundingClientRect();
      const cs=getComputedStyle(fl.el);
      return {imgs:imgs.length,loaded:imgs.filter(i=>i.complete&&i.naturalWidth>0).length,
        srcs:[...new Set(imgs.map(i=>i.src.split('/').pop()))],fig:r?{w:Math.round(r.width),h:Math.round(r.height)}:null,
        bg:cs.backgroundColor,border:cs.borderTopWidth,mood:fl.mood}}""")
    ok('float: the cut-out parts (body, wings, faces) load from assets/lilith/float', f and f['imgs'] >= 12 and f['loaded'] == f['imgs'] and 'body.webp' in f['srcs'] and 'wingl.webp' in f['srcs'], json.dumps(f)[:300])
    ok('float: no card behind her (transparent, no border)', f and f['bg'] in ('rgba(0, 0, 0, 0)', 'transparent') and f['border'] in ('0px', ''), f and f['bg'] + ' ' + f['border'])
    page.screenshot(path=str(SHOTS / 'v100-float.png'))
    figbox = "()=>{const r=__zhutianApp.float.el.getRootNode().querySelector('.fig').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*0.18}}"
    page.evaluate("()=>{__zhutianApp.hub.close?.();__zhutianApp.float.quiet?.()}"); page.wait_for_timeout(900)   # a greeting makes a tucked float peek; quiet → back to the edge
    if page.evaluate("__zhutianApp.float.el.dataset.tucked") == 'true':   # tucked at the edge: tap the peek to bring her out (saved)
        box = page.evaluate("()=>{const r=__zhutianApp.float.fig.getBoundingClientRect();const x=Math.min(innerWidth-4,Math.max(4,r.x+r.width/2));return {x,y:r.y+r.height*0.3}}")
        page.touchscreen.tap(box['x'], box['y']); page.wait_for_timeout(900)
        page.evaluate("()=>{__zhutianApp.float.quiet?.()}"); page.wait_for_timeout(900)
    for attempt in range(3):   # a real double tap = poke (retry: under load the two taps can land > 320 ms apart = two single taps)
        box = page.evaluate(figbox); page.touchscreen.tap(box['x'], box['y']); page.wait_for_timeout(60); page.touchscreen.tap(box['x'], box['y']); page.wait_for_timeout(500)
        if page.evaluate("__zhutianApp.float.mood") != 'neutral': break
        page.evaluate("()=>{__zhutianApp.hub.close?.()}"); page.wait_for_timeout(1500)
    m = page.evaluate("()=>{const fl=__zhutianApp.float;if(__zhutianApp.hub.isOpen)return {mood:'hub opened instead',on:[]};const on=[...fl.el.getRootNode().querySelectorAll('img.on')].map(i=>i.src.split('/').pop());return {mood:fl.mood,on,speaking:!!fl.speaking}}")
    ok('float: a real double tap on her head (poke) changes the face patch and she speaks', m['mood'] != 'neutral' and any(s.startswith('face-') for s in m['on']), json.dumps(m))
    page.screenshot(path=str(SHOTS / 'v100-float-tap.png'))
    # tucked at the edge + a line → she peeks out first (the bubble is never half off-screen)
    r = page.evaluate("""async()=>{const f=__zhutianApp.float;f.quiet?.();await new Promise(r=>setTimeout(r,300));f.peeking=false;f.place({x:0,y:420,edge:'left',tucked:true},false);
      const before=f.el.dataset.tucked;f.say('探出来说话的测试台词',{ms:2500});await new Promise(r=>setTimeout(r,500));
      const m=new DOMMatrix(getComputedStyle(f.el).transform);const b=f.bubble.getBoundingClientRect();
      return {before,after:f.el.dataset.tucked,x:Math.round(m.m41),bubbleLeft:Math.round(b.left),bubbleRight:Math.round(b.right),vw:innerWidth}}""")
    ok('tucked + a line: she peeks out first and the bubble stays on screen', r['before'] == 'true' and r['after'] == 'false' and r['x'] >= 0 and r['bubbleLeft'] >= 0 and r['bubbleRight'] <= r['vw'], json.dumps(r))

    # ---------- settings tiers + search ----------
    page.evaluate("()=>{__zhutianApp.hub.open('set')}"); page.wait_for_timeout(900)
    g = page.evaluate("""()=>{const el=__zhutianApp.hub.shadow.getElementById('page-set');
      return [...el.querySelectorAll('.zt-set-group')].map(x=>({tier:x.dataset.tier,tag:x.tagName,open:x.tagName==='DETAILS'?x.open:true,rows:x.querySelectorAll('.zt-row').length}))}""")
    ok('settings: 常用 shown, 进阶设置 and 诊断与维护 folded', [x['tier'] for x in g] == ['common', 'adv', 'diag'] and g[0]['tag'] == 'DIV' and not g[1]['open'] and not g[2]['open'] and all(x['rows'] for x in g), json.dumps(g))
    page.screenshot(path=str(SHOTS / 'v100-settings.png'))
    search = page.locator('#page-set [data-f=sset]')
    search.click(); page.keyboard.type('超时'); page.wait_for_timeout(300)
    s = page.evaluate("""()=>{const el=__zhutianApp.hub.shadow.getElementById('page-set');const vis=[...el.querySelectorAll('.zt-row')].filter(r=>!r.hidden&&r.offsetParent);
      return {vis:vis.map(r=>r.dataset.search.slice(0,30)),advOpen:el.querySelector('details[data-tier=adv]').open,none:!el.querySelector('.zt-set-none').hidden}}""")
    ok('settings search 「超时」: only matching rows, the folded 进阶 group opens by itself', s['vis'] and all('超时' in v for v in s['vis']) and s['advOpen'] and not s['none'], json.dumps(s, ensure_ascii=False)[:300])
    page.screenshot(path=str(SHOTS / 'v100-settings-search.png'))
    search.fill(''); page.keyboard.type('zzzz不存在'); page.wait_for_timeout(200)
    none = page.evaluate("()=>!__zhutianApp.hub.shadow.querySelector('#page-set .zt-set-none').hidden")
    search.fill(''); search.dispatch_event('input'); page.wait_for_timeout(200)
    back = page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-set details[data-tier=adv]').open")
    ok('settings search: a miss says so; clearing folds the auto-opened group again', none and not back, f'none={none} advOpenAfterClear={back}')

    # ---------- export ----------
    page.evaluate("async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const z=v.诸天系统;z.系统点=1200;z.背包=[{名称:'回元丹',数量:2}];return v;},{type:'chat'})}")
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-set [data-act=\"data-io\"]').click()"); page.wait_for_timeout(800)
    ok('settings → 导出 / 导入存档 opens the popup', '导出 / 导入存档' in popup_text(page), popup_text(page)[:80])
    with page.expect_download(timeout=10000) as dl:
        page.evaluate("()=>[...document.querySelectorAll('.zt-popup [data-io=export]')].at(-1).click()")
    d = dl.value; path = SHOTS / 'export.json'; d.save_as(str(path)); text = path.read_text(encoding='utf8'); file = json.loads(text)
    ok('export: a 诸天存档-*.json download with the ledger and plugin settings', d.suggested_filename.startswith('诸天存档-') and file.get('format') == 'zhutian-terminal-backup' and file['chat']['variables']['诸天系统']['系统点'] == 1200 and 'floatLilith' in file['settings'], d.suggested_filename)
    ok('export: no API key anywhere in the file', KEY not in text and 'qa1000' not in text, f'{len(text)} bytes')
    close_popups(page)

    # ---------- import round trip ----------
    page.evaluate("async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const z=v.诸天系统;z.系统点=5;z.背包=[];return v;},{type:'chat'})}")
    page.wait_for_timeout(200); n0 = len(backups(page))
    page.evaluate("()=>__zhutianApp.dataIO.open()"); page.wait_for_timeout(700)
    page.evaluate("()=>[...document.querySelectorAll('.zt-popup [data-io=paste]')].at(-1).click()")
    page.evaluate("t=>{const ta=[...document.querySelectorAll('.zt-popup [data-io=text]')].at(-1);ta.value=t;ta.dispatchEvent(new Event('input',{bubbles:true}))}", text)
    page.wait_for_timeout(400)
    pv = popup_text(page)
    ok('import: a before / after preview (系统点 5 → 1,200, 背包 0 → 1)', '将要导入' in pv and '1,200' in pv and '系统点' in pv, pv[pv.find('将要导入'):][:160].replace('\n', ' '))
    page.screenshot(path=str(SHOTS / 'v100-import-preview.png'))
    page.evaluate("()=>[...document.querySelectorAll('.zt-popup [data-io=apply]')].at(-1).click()"); page.wait_for_timeout(1500)
    after = z(page); bk = backups(page)
    ok('import: the ledger is written and read back (系统点 1200, 回元丹 back)', after['系统点'] == 1200 and len(after['背包']) == 1 and '已导入' in popup_text(page), popup_text(page)[-80:].replace('\n', ' '))
    ok('import: the state before it was backed up (导入前, 系统点 5)', any(b['reason'] == '导入前' and b['bal'] == 5 for b in bk), json.dumps(bk, ensure_ascii=False)[:300])
    ok('import: the stored API key survived the key-less file', KEY in stored_key(page))
    close_popups(page)

    # ---------- rollback by clicking ----------
    page.evaluate("()=>__zhutianApp.features.openMigration()"); page.wait_for_timeout(800)
    at = next(b['at'] for b in backups(page) if b['reason'] == '导入前')
    page.evaluate("at=>document.querySelector(`.zt-popup [data-restore=\"${at}\"]`).click()", at); page.wait_for_timeout(1500)
    bk = backups(page)
    ok('rollback click: the ledger is back to the 导入前 state (系统点 5)', z(page)['系统点'] == 5, str(z(page)['系统点']))
    ok('rollback: the state before the rollback is backed up and kept (回滚前, 1200)', any(b['reason'] == '回滚前' and b['bal'] == 1200 for b in bk), json.dumps(bk, ensure_ascii=False)[:300])
    page.screenshot(path=str(SHOTS / 'v100-rollback.png'))
    close_popups(page)

    # ---------- ledger structure version ----------
    st = page.evaluate("()=>__zhutianApp.ctx?.chatMetadata?.zhutianCovenantTerminal?.ledgerSchema ?? SillyTavern.getContext().chatMetadata.zhutianCovenantTerminal?.ledgerSchema")
    ok('structure version 1 recorded in chat metadata (not in the ledger the AI sees)', st == 1 and 'ledgerSchema' not in z(page), str(st))
    r = page.evaluate("""async()=>{const c=SillyTavern.getContext();c.chatMetadata.zhutianCovenantTerminal.ledgerSchema=99;
      let err='';try{await __zhutianApp.bridge.updateVariablesWith(v=>{v.诸天系统.系统点=999;return v;},{type:'chat'});}catch(e){err=e.message}
      const chk=await __zhutianApp.dataIO.checkSchema();const p=__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.系统点;
      c.chatMetadata.zhutianCovenantTerminal.ledgerSchema=1;return {err,chk,p}}""")
    ok('a ledger written by a newer plugin is read-only (write refused, nothing changed)', '只读' in r['err'] and r['chk']['state'] == 'newer' and r['p'] == 5, json.dumps(r, ensure_ascii=False)[:240])
    r = page.evaluate("""async()=>{const c=SillyTavern.getContext();delete c.chatMetadata.zhutianCovenantTerminal.ledgerSchema;c.chatMetadata.variables.诸天系统.背包='坏数据';
      const chk=await __zhutianApp.dataIO.checkSchema();return {chk,bag:__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.背包,schema:c.chatMetadata.zhutianCovenantTerminal.ledgerSchema,
      reasons:__zhutianApp.bridge.backups().map(b=>b.reason||'')}}""")
    ok('an old ledger is backed up, repaired and marked structure 1', r['chk']['state'] == 'upgraded' and r['bag'] == [] and r['schema'] == 1 and any('结构升级' in x for x in r['reasons']), json.dumps(r, ensure_ascii=False)[:300])

    # ---------- error lines ----------
    page.evaluate("()=>{__zhutianApp.hub.open('group');}"); page.wait_for_timeout(700)
    page.evaluate("()=>{__zhutianApp.hub.shadow.querySelector('#page-group [data-gtab=\"members\"]').click()}"); page.wait_for_timeout(400)
    page.locator('#page-group [data-f=rmode]').select_option('char')
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-group [data-g=recruit]').click()"); page.wait_for_timeout(700)
    t = page.evaluate("()=>{const t=__zhutianApp.hub.shadow.getElementById('zt-hub-toast');return t&&!t.hidden?t.textContent:''}")
    ok('error line: what happened · 账本：没有改动 · 下一步', '请填写角色名' in t and '账本：没有改动' in t and '下一步：' in t, t)
    page.evaluate("()=>__zhutianApp.hub.close()"); page.wait_for_timeout(600)
    page.evaluate("async()=>{await SillyTavern.getContext().executeSlashCommandsWithOptions('/zt init')}"); page.wait_for_timeout(1200)
    ok('/zt init no longer opens the worldbook popup as well', '世界书' not in popup_text(page), popup_text(page)[:80])
    close_popups(page)

    # ---------- 动态效果 精简 ----------
    page.evaluate("()=>__zhutianApp.settings.set('motion','lite')"); page.wait_for_timeout(400)
    l = page.evaluate("""()=>{const fl=__zhutianApp.float.el;const rig=fl.getRootNode().querySelector('.rig');
      return {host:__zhutianApp.hub.shadow.host.hasAttribute('data-zt-lite'),fl:fl.dataset.lite,anim:getComputedStyle(rig).animationName,fx:__zhutianApp.fx.mode()}}""")
    ok('动态效果 精简: float stops bobbing, terminal marked lite, 演出 shows only the card', l['host'] and l['fl'] == 'true' and l['anim'] == 'none' and l['fx'] == 'brief', json.dumps(l))
    page.evaluate("()=>{__zhutianApp.settings.set('motion','auto');__zhutianApp.perf.fps=24;__zhutianApp.perf.apply()}"); page.wait_for_timeout(300)
    a = page.evaluate("()=>({lite:__zhutianApp.perf.lite,reason:__zhutianApp.perf.reason})")
    page.evaluate("()=>{__zhutianApp.perf.fps=60;__zhutianApp.perf.apply()}"); page.wait_for_timeout(300)
    b = page.evaluate("()=>({lite:__zhutianApp.perf.lite,fl:__zhutianApp.float.el.dataset.lite,reason:__zhutianApp.perf.reason})")
    ok('动态效果 自动: a slow touch device (24 fps) goes lite, 60 fps stays full', a['lite'] and not b['lite'] and b['fl'] == 'false', json.dumps([a, b], ensure_ascii=False))
    ok('phone: no page errors', not errs, '; '.join(errs)[:300])
    # leave the shared test host as other suites expect it (floating Lilith back to auto: it would cover desktop buttons)
    page.evaluate("async()=>{const s=__zhutianApp.settings;s.set('floatLilith','auto');s.set('motion','auto');try{const m=await import('/script.js');await m.saveSettings();}catch{await new Promise(r=>setTimeout(r,2500));}}"); page.wait_for_timeout(500)
    ctx.close()

def landscape(browser):
    ctx = browser.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, user_agent=ANDROID_UA)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    Z.boot(page); Z.open_chat(page) if page.evaluate("SillyTavern.getContext().characters.length") else Z.setup_chat(page)
    page.evaluate("()=>{__zhutianApp.hub.open('ov')}"); page.wait_for_timeout(1000)
    vis = lambda: page.evaluate("()=>[...__zhutianApp.hub.shadow.querySelectorAll('nav.zt-hub-nav .nav-button')].filter(b=>b.offsetParent&&getComputedStyle(b).display!=='none').map(b=>b.dataset.page||'more')")
    v = vis()
    ok('landscape rail: six pinned pages + 更多 (no scrolling through ~20 entries)', v == ['ov', 'task', 'shop', 'bag', 'group', 'set', 'more'] or sorted(v) == sorted(['ov', 'task', 'shop', 'bag', 'group', 'set', 'more']), json.dumps(v))
    page.screenshot(path=str(SHOTS / 'v100-land.png'))
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('.zt-nav-more').click()"); page.wait_for_timeout(300)
    v2 = vis()
    ok('更多 shows every page', len(v2) > 12 and 'cult' in v2 and 'plugmgr' in v2, f'{len(v2)} visible')
    page.screenshot(path=str(SHOTS / 'v100-land-more.png'))
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('nav.zt-hub-nav [data-page=cult]').click()"); page.wait_for_timeout(600)
    v3 = vis()
    ok('picking a page folds the rail again; the current page stays visible in it', 'cult' in v3 and len(v3) == 8, json.dumps(v3))
    ok('landscape: no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    for s in (phone, landscape):
        try: s(browser)
        except Exception as e: ok(f'{s.__name__} suite ran without exceptions', False, str(e)[:500])
    browser.close()
passed = sum(1 for _, c, _ in results if c)
print(f'\n{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
