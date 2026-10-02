"""0.9.3 acceptance (isolated SillyTavern + mock model only):
  W. 规则 → 额外世界背景: 「读取书目」 lists the host's worldbooks (it used to say 当前助手缺少世界书读取接口), 「读取这本书」
     stores a read-only snapshot (disabled entries skipped), the book itself is not written; the fallback routes used by
     hosts without getContext().getWorldInfoNames (older SillyTavern / TauriTavern builds) work too
  S. 星图: a wrongly detected current world (灵笼 guessed as 仙侠) can be corrected — type, name; a wrong footprint can be
     deleted; the 记录穿越 form with the current name corrects instead of failing; the node matches the top badge
  G. 新手引导: opens once by itself on a plain terminal open, three steps with real ticks (worldbook install + bind,
     SillyTavern main API, ledger + 莉莉丝 memory), 完成 is remembered, 设置 → 新手引导 reopens it, an explicitly
     requested page is never replaced, the 连接 page shows the way back; phone layout has nothing sticking out
Usage: python3 tests/native_v093.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots093')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
WB = '诸天万界最强系统'

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=False)
J = lambda x: json.dumps(x, ensure_ascii=False)[:400]

SH = "__zhutianApp.assistant.shadow"
QA_BOOK = '''async()=>{const c=SillyTavern.getContext();
  await c.saveWorldInfo('QA背景书',{entries:{0:{uid:0,comment:'QA甲',key:['甲'],content:'甲条目内容',disable:false,displayIndex:0},1:{uid:1,comment:'QA乙',key:['乙'],content:'乙条目内容',disable:false,displayIndex:1},2:{uid:2,comment:'QA关',key:[],content:'不应读取',disable:true,displayIndex:2}}},true);
  await c.updateWorldInfoList();return JSON.stringify(await c.loadWorldInfo('QA背景书'));}'''

def suite_worldbook(browser):
    ctx = browser.new_context(viewport={'width': 1280, 'height': 860}); page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    Z.boot(page); Z.setup_chat(page)
    before = page.evaluate(QA_BOOK)
    page.evaluate("()=>__zhutianApp.hub.open('rules')"); page.wait_for_timeout(800)
    page.evaluate(f"()=>{SH}.getElementById('wb-books').click()"); page.wait_for_timeout(600)
    r = page.evaluate(f"()=>({{opts:[...{SH}.querySelectorAll('#wb-book option')].map(o=>o.value),status:{SH}.getElementById('status')?.textContent||''}})")
    ok('W: 读取书目 lists the host worldbooks (QA背景书 among them); no 缺少世界书读取接口', 'QA背景书' in r['opts'] and '缺少世界书读取接口' not in r['status'], J(r))
    page.evaluate(f"()=>{{const s={SH}.getElementById('wb-book');s.value='QA背景书';s.dispatchEvent(new Event('change',{{bubbles:true}}));{SH}.getElementById('wb-load-book').click();}}"); page.wait_for_timeout(1200)
    st = page.evaluate(f"()=>{{const ns=__zhutianApp.original.ZhuTianMemoryCore.NS;const s=SillyTavern.getContext().chatMetadata.variables?.[ns]||{{}};return {{book:s.referenceBook?{{name:s.referenceBook.name,titles:s.referenceBook.entries.map(e=>e.title)}}:null,status:{SH}.getElementById('status')?.textContent||''}};}}")
    ok('W: 读取这本书 stores the snapshot — 2 enabled entries, the disabled one skipped', st['book'] and st['book']['name'] == 'QA背景书' and st['book']['titles'] == ['QA甲', 'QA乙'], J(st))
    page.evaluate(f"()=>{{const i={SH}.getElementById('wb-rule-search');i.value='乙条目';i.dispatchEvent(new Event('input',{{bubbles:true}}));}}"); page.wait_for_timeout(300)
    found = page.evaluate(f"()=>{SH}.getElementById('wb-rule-results')?.textContent||''")
    ok('W: rule search finds the snapshot entry', '乙条目内容' in found, found[:120])
    after = page.evaluate("async()=>JSON.stringify(await SillyTavern.getContext().loadWorldInfo('QA背景书'))")
    ok('W: the worldbook itself is unchanged (read-only)', before == after)
    shot(page, 'v093-W-rules')
    # hosts without getWorldInfoNames / getContext().loadWorldInfo (older SillyTavern, TauriTavern builds): module + API routes
    fb = page.evaluate('''async()=>{const b=__zhutianApp.bridge,orig=b.ctx;b.ctx=()=>{const c=orig.call(b);return new Proxy(c,{get:(t,k)=>k==='getWorldInfoNames'||k==='loadWorldInfo'?undefined:t[k]});};
      try{b.wiModule=null;b.wbNames=null;await b.prefetchWorldbooks();const names=b.getWorldbookNames();const rows=await b.getWorldbook('QA背景书');
        b.wiModule={};const rows2=await b.getWorldbook('QA背景书');let miss='';try{await b.getWorldbook('不存在的书QA');}catch(e){miss=e.message;}
        return {names:names.includes('QA背景书'),rows:rows.map(r=>r.name),rows2:rows2.map(r=>r.name),miss};}finally{b.ctx=orig;b.wiModule=null;}}''')
    ok('W: fallback routes — world-info module list + loadWorldInfo, then /api/worldinfo/get; missing book → clear error', fb['names'] and fb['rows'] == ['QA甲', 'QA乙', 'QA关'] and fb['rows2'] == fb['rows'] and '读取不到世界书' in fb['miss'], J(fb))
    ok('W: no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

STARS_SEED = '''async()=>{const c=SillyTavern.getContext();const z=c.chatMetadata.variables.诸天系统;
  z.当前世界='灵笼';z.世界类型='';z.万界足迹=[{名称:'错世界',类型:'',主题:'eerie',首次楼层:1,最近楼层:1,次数:1,首次:1,最近:1},{名称:'灵笼',类型:'',主题:'xianxia',首次楼层:3,最近楼层:3,次数:1,首次:2,最近:2}];
  await c.saveMetadata();__zhutianApp.world.lastName='灵笼';__zhutianApp.world.sync(true);__zhutianApp.bridge.emit('chat');await new Promise(r=>setTimeout(r,800));}'''
NODE = '''name=>{const sh=__zhutianApp.hub.shadow,n=sh.querySelector(`.zt-node[data-node="world:${name}"]`);return n?{sub:n.querySelector('text.s')?.textContent||'',theme:n.dataset.theme,current:n.dataset.current==='1'}:null}'''
Z_ = "SillyTavern.getContext().chatMetadata.variables.诸天系统"

def suite_stars(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, user_agent=ANDROID_UA); page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    Z.boot(page); Z.setup_chat(page)
    page.evaluate(STARS_SEED); page.evaluate("()=>__zhutianApp.hub.open('stars')"); page.wait_for_timeout(900)
    n0 = page.evaluate(NODE, '灵笼')
    ok('S: name guess is marked — 灵笼 shows「仙侠?」', n0 and n0['sub'] == '仙侠?' and n0['current'], J(n0))
    page.evaluate("()=>__zhutianApp.atlas.select('stars','world:灵笼')"); page.wait_for_timeout(300)
    fx = page.evaluate("()=>{const f=__zhutianApp.hub.shadow.querySelector('.zt-atlas-fix');if(!f)return null;const i=f.querySelector('[data-f=fix-name]'),r=i.getBoundingClientRect();return {open:f.open,name:i.value,font:parseFloat(getComputedStyle(i).fontSize),w:Math.round(r.width),right:Math.round(r.right),vw:innerWidth,forget:!!f.querySelector('[data-forget]')}}")
    ok('S: current world with a guessed type → 更正 box open, prefilled, no 删除 button (current world)', fx and fx['open'] and fx['name'] == '灵笼' and not fx['forget'], J(fx))
    ok('S: phone — 更正 field inside the screen and ≥16 px (no zoom on focus)', fx and fx['right'] <= fx['vw'] and fx['font'] >= 16, J(fx))
    shot(page, 'v093-S-fix-open')
    hist0 = page.evaluate("()=>(__zhutianApp.fx?.history||[]).length")
    page.evaluate("()=>{const f=__zhutianApp.hub.shadow.querySelector('.zt-atlas-fix');f.querySelector('[data-f=fix-type]').value='末世';f.querySelector('[data-fix]').click();}"); page.wait_for_timeout(900)
    z = page.evaluate(f"()=>{{const z={Z_};return {{cur:z.当前世界,type:z.世界类型,fp:z.万界足迹.map(x=>[x.名称,x.类型,x.次数])}}}}")
    n1 = page.evaluate(NODE, '灵笼'); badge = page.evaluate("()=>__zhutianApp.hub.shadow.getElementById('zt-top-theme')?.dataset.theme")
    ok('S: 保存更正 (type 末世) → 世界类型 written, footprint fixed, no extra visit', z['cur'] == '灵笼' and z['type'] == '末世' and ['灵笼', '末世', 1] in z['fp'], J(z))
    ok('S: node now says 末世 and matches the terminal theme (诸天 default)', n1 and n1['sub'] == '末世' and n1['theme'] == 'default' and badge == 'default', J([n1, badge]))
    hist1 = page.evaluate("n=>(__zhutianApp.fx?.history||[]).slice(0,Math.max(0,(__zhutianApp.fx?.history||[]).length-n)).map(x=>x.title+' '+x.detail)", hist0)
    ok('S: a correction is not a 穿越 — no performance recorded', not hist1, J(hist1))
    page.evaluate("()=>{const f=__zhutianApp.hub.shadow.querySelector('.zt-atlas-fix');f.open=true;f.querySelector('[data-f=fix-name]').value='灵笼·地表';f.querySelector('[data-fix]').click();}"); page.wait_for_timeout(900)
    page.wait_for_timeout(600)
    hist2 = page.evaluate("n=>(__zhutianApp.fx?.history||[]).slice(0,Math.max(0,(__zhutianApp.fx?.history||[]).length-n)).map(x=>x.title+' '+x.detail)", hist0)
    ok('S: renaming the current world is not a 穿越 either — no performance', not hist2, J(hist2))
    z = page.evaluate(f"()=>{{const z={Z_};return {{cur:z.当前世界,type:z.世界类型,fp:z.万界足迹.map(x=>x.名称)}}}}")
    ok('S: rename the current world → 当前世界 + footprint renamed, the type kept as chosen', z['cur'] == '灵笼·地表' and z['type'] == '末世' and z['fp'] == ['错世界', '灵笼·地表'], J(z))
    page.evaluate("()=>__zhutianApp.atlas.select('stars','world:错世界')"); page.wait_for_timeout(300)
    page.evaluate("()=>{const f=__zhutianApp.hub.shadow.querySelector('.zt-atlas-fix');f.open=true;f.querySelector('[data-forget]').click();}"); page.wait_for_timeout(900)
    z = page.evaluate(f"()=>{Z_}.万界足迹.map(x=>x.名称)")
    ok('S: 从足迹删除 removes a world that was never visited', z == ['灵笼·地表'], J(z))
    page.evaluate("()=>{const sh=__zhutianApp.hub.shadow;sh.querySelector('[data-f=world]').value='灵笼·地表';sh.querySelector('[data-f=wtype]').value='赛博';sh.querySelector('[data-travel-form]').click();}"); page.wait_for_timeout(900)
    z = page.evaluate(f"()=>{{const z={Z_};return {{cur:z.当前世界,type:z.世界类型,n:z.万界足迹.length,toast:__zhutianApp.hub.shadow.getElementById('zt-hub-toast')?.textContent||''}}}}")
    ok('S: 记录穿越 with the current world name corrects the type (used to fail with 已经在这个世界了)', z['type'] == '赛博' and z['n'] == 1 and '已经在这个世界' not in z['toast'], J(z))
    shot(page, 'v093-S-after')
    ok('S: no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

RESET_GUIDE = '''async()=>{const a=__zhutianApp,c=SillyTavern.getContext(),ns=a.original.ZhuTianMemoryCore.NS;
  a.settings.set('worldbookAuto',false);a.settings.set('guide',null);a.guide.autoTried=false;if(a.guide.nav)a.guide.nav.hidden=false;
  const wi=await import('/scripts/world-info.js');if(wi.world_names?.includes('%s'))await wi.deleteWorldInfo('%s');await c.updateWorldInfoList();
  if(c.chatMetadata.world_info)delete c.chatMetadata.world_info;
  await a.bridge.updateVariablesWith(v=>{delete v['诸天系统_API'];return v;},{type:'global'});localStorage.removeItem('sys_api_config');
  await a.bridge.updateVariablesWith(v=>{delete v[ns+'_API'];return v;},{type:'script'});
  if(c.chatMetadata.variables?.[ns])c.chatMetadata.variables[ns].enabled=false;await c.saveMetadata();a.assistant&&a.adapter.notify?.();
  if(a.hub.isOpen)a.hub.rawClose();}''' % (WB, WB)
GSTATE = '''()=>{const sh=__zhutianApp.hub.shadow,p=sh.getElementById('page-guide');return {page:__zhutianApp.hub.page,visible:!!p&&!p.hidden,
  steps:[...(p?.querySelectorAll('.zt-guide-step')||[])].map(s=>s.dataset.step+':'+s.dataset.done),note:p?.querySelector('.zt-guide-note')?.textContent||'',nav:!sh.querySelector('.nav-button[data-page=guide]')?.hidden}}'''

def guide_click(page, act, ms=1500):
    page.evaluate(f"()=>__zhutianApp.hub.shadow.querySelector('#page-guide [data-guide=\"{act}\"]').click()"); page.wait_for_timeout(ms)

def suite_guide(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, user_agent=ANDROID_UA); page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    Z.boot(page); Z.setup_chat(page)
    page.evaluate(RESET_GUIDE); page.wait_for_timeout(600)
    page.evaluate("()=>__zhutianApp.hub.open('stars')"); page.wait_for_timeout(1200)
    ok('G: an explicitly requested page (stars) is not replaced by the guide', page.evaluate("()=>__zhutianApp.hub.page") == 'stars')
    page.evaluate("()=>__zhutianApp.hub.rawClose()"); page.wait_for_timeout(500)
    page.evaluate("()=>__zhutianApp.hub.open()"); page.wait_for_timeout(1500)
    g = page.evaluate(GSTATE)
    ok('G: first plain open → the guide opens by itself; nothing ticked yet (no book, no API, memory off)', g['page'] == 'guide' and g['visible'] and g['steps'] == ['wb:0', 'api:0', 'chat:0'] and g['nav'], J(g))
    m = page.evaluate("async()=>{const {measurePage}=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/device-check.js');return measurePage(__zhutianApp.hub);}")
    ok('G: phone — nothing sticks out, no sideways scroll, no small tap targets on the guide page', not m['bad'], J(m))
    shot(page, 'v093-G-start')
    guide_click(page, 'wb-install', 2500)
    g = page.evaluate(GSTATE); wb = page.evaluate(f"async()=>{{const c=SillyTavern.getContext();const b=await c.loadWorldInfo('{WB}');return {{n:b?Object.keys(b.entries).length:0,bound:c.chatMetadata.world_info}}}}")
    ok('G: step 1 — worldbook installed and bound to this chat, ticked', g['steps'][0] == 'wb:1' and wb['n'] > 10 and wb['bound'] == WB, J([g, wb]))
    guide_click(page, 'api-main')
    g = page.evaluate(GSTATE); api = page.evaluate("()=>{const ns=__zhutianApp.original.ZhuTianMemoryCore.NS;return __zhutianApp.bridge.getVariables({type:'script'})[ns+'_API']?.url||''}")
    ok('G: step 2 — 用酒馆当前的主模型 saves the main-API choice, ticked', g['steps'][1] == 'api:1' and 'st-main.zhutian.invalid' in api, J([g, api]))
    guide_click(page, 'api-open', 1200)
    strip = page.evaluate("()=>{const p=__zhutianApp.hub.shadow.getElementById('page-api');return {page:__zhutianApp.hub.page,strip:!!p?.querySelector('.zt-guide-back'),form:!!p?.querySelector('input,select')}}")
    ok('G: 修改 → 连接 page with the API form and a 「回到新手引导」 strip', strip['page'] == 'api' and strip['strip'] and strip['form'], J(strip))
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-api .zt-guide-back button').click()"); page.wait_for_timeout(1000)
    ok('G: the strip leads back to the guide', page.evaluate("()=>__zhutianApp.hub.page") == 'guide')
    guide_click(page, 'chat-enable', 3500)
    g = page.evaluate(GSTATE); mem = page.evaluate("()=>{const ns=__zhutianApp.original.ZhuTianMemoryCore.NS;return SillyTavern.getContext().chatMetadata.variables?.[ns]?.enabled}")
    ok('G: step 3 — ledger kept, 莉莉丝 memory enabled through the original save, ticked; 3/3', g['steps'] == ['wb:1', 'api:1', 'chat:1'] and mem is True, J([g, mem]))
    shot(page, 'v093-G-done')
    guide_click(page, 'done', 800)
    s = page.evaluate("()=>({guide:__zhutianApp.settings.get('guide'),page:__zhutianApp.hub.page,nav:!__zhutianApp.hub.shadow.querySelector('.nav-button[data-page=guide]')?.hidden})")
    ok('G: 完成 is remembered, the 引导 nav button goes away, back to 总览', s['guide'] and s['guide']['state'] == 'done' and s['page'] == 'ov' and not s['nav'], J(s))
    page.evaluate("()=>__zhutianApp.hub.rawClose()"); page.wait_for_timeout(500)
    page.evaluate("()=>{__zhutianApp.guide.autoTried=false;__zhutianApp.hub.open()}"); page.wait_for_timeout(1300)
    ok('G: after 完成 a plain open does not show the guide again', page.evaluate("()=>__zhutianApp.hub.page") != 'guide')
    page.evaluate("()=>__zhutianApp.hub.go('set')"); page.wait_for_timeout(500)
    page.evaluate("()=>__zhutianApp.hub.shadow.querySelector('#page-set [data-act=guide]').click()"); page.wait_for_timeout(1200)
    g = page.evaluate(GSTATE)
    ok('G: 设置 → 上手 → 新手引导 reopens it (all ticks re-read: 3/3)', g['page'] == 'guide' and g['steps'] == ['wb:1', 'api:1', 'chat:1'], J(g))
    ok('G: no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    for s in (suite_worldbook, suite_stars, suite_guide):
        try: s(browser)
        except Exception as e: ok(f'{s.__name__} ran without exceptions', False, str(e)[:500])
    browser.close()
passed = sum(1 for _, c, _ in results if c)
print(f'\n{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
