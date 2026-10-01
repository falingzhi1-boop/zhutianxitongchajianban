"""0.7.0 acceptance: world themes, 图谱, 演出, Lilith as interface character (isolated SillyTavern + mock model only).
Every performance is checked against the ledger read back from chat variables; UI state alone never counts as a pass.
Usage: python3 tests/native_world070.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots070')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
SEED = '\n'.join(l for l in (Path(__file__).resolve().parent / 'qa' / 'seed070.js').read_text(encoding='utf8').splitlines() if not l.startswith('//'))
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def js(page, body): return page.evaluate('(async()=>{const app=__zhutianApp,h=app.hub,sr=h.shadow;' + body + '})()')
def z(page): return page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
def commit(page, body):
    return js(page, "const L=await import(app.base+'src/ledger-ops.js');await L.commit(app.bridge,(v,z)=>{" + body + "},z=>[JSON.stringify(z).length]);return 1")
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'))
def nav_boxes(page):
    return js(page, "return [...sr.querySelectorAll('.nav-button[data-page]')].map(b=>{const r=b.getBoundingClientRect();return [b.dataset.page,Math.round(r.x),Math.round(r.y),Math.round(r.width)]})")

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, device_scale_factor=1)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    Z.boot(page); Z.setup_chat(page)
    page.evaluate(f'async()=>{{await ({SEED})();}}'); page.wait_for_timeout(1500)
    js(page, "app.fx.history.length=0;return 1")

    # ---- navigation + world theme ----
    js(page, "h.open('ov');return 1"); page.wait_for_timeout(1200)
    groups = js(page, "return [...sr.querySelectorAll('.zt-nav-group[data-group=\"图谱\"] .nav-button')].map(b=>b.dataset.page)")
    ok('图谱 group has 事件线 / 羁绊图 / 星图 / 能力树', groups == ['events', 'bonds', 'stars', 'tree'], str(groups))
    ok('太初仙域 → 仙侠 theme on the terminal', js(page, "return sr.host.getAttribute('data-zt-world')") == 'xianxia')
    ok('engine iframe follows the theme', js(page, "return h.engineFrame?.contentDocument?.documentElement.dataset.ztWorld") == 'xianxia')
    ok('top bar shows the theme badge', js(page, "return sr.getElementById('zt-top-theme').textContent") == '玉简')
    ok('camera: system page = mid', js(page, "return sr.host.getAttribute('data-zt-cam')") == 'mid')
    box_x = nav_boxes(page); shot(page, '01-xianxia-ov')

    # ---- 事件线: real clicks + keyboard ----
    js(page, "h.go('events');return 1"); page.wait_for_timeout(600)
    page.locator('#page-events .zt-node[data-node="task:T2"]').click(); page.wait_for_timeout(500)
    det = js(page, "return sr.querySelector('#page-events .zt-atlas-detail').textContent")
    ok('clicking a task node shows its raw record and ledger path', '诸天系统.任务库.T2' in det and '拜入青云门' in det, det[:120])
    ok('cause/effect links listed', '承接' in det and '起因' in det)
    bubble = js(page, "return app.assistant.stage()?.bubble?.textContent||''")
    ok('Lilith reacts to the selected task with ledger data', '拜入青云门' in bubble, bubble)
    page.keyboard.press('ArrowRight'); page.keyboard.press('Enter'); page.wait_for_timeout(400)
    ok('keyboard: arrow + Enter selects the next node', js(page, "return app.atlas.sel.events") not in (None, 'task:T2'))
    js(page, "app.atlas.select('events','task:T2');return 1"); page.wait_for_timeout(300)
    page.locator('#page-events [data-open-task="T2"]').click(); page.wait_for_timeout(1800)
    v = js(page, "return [h.page,h.engineTab,!!h.engineFrame.contentDocument.querySelector('[data-task-focus=\"T2\"]')]")
    ok('在任务页定位 → engine task tab with the original row', v == ['task', 3, True], str(v))
    ok('engine task tab links back to 事件线', js(page, "return sr.querySelector('#zt-engine-tools .zt-atlas-link')?.textContent||''").startswith('查看事件线'))
    shot(page, '02-events')

    # ---- 演出: after read-back only, skippable, clear result ----
    js(page, "h.go('tree');return 1"); page.wait_for_timeout(500)
    commit(page, "z.任务库.T2.状态='已完成';z.任务结算凭据.T2={点数:8000,楼层:4,任务名:'拜入青云门'};")
    page.wait_for_timeout(700)
    ok('task settlement plays inside the terminal', js(page, "return !!sr.querySelector('.zt-fx[data-kind=task]')"))
    page.keyboard.press('Escape'); page.wait_for_timeout(500)
    v = js(page, "return [!!sr.querySelector('.zt-fx:not(.zt-fx-leave)'),h.isOpen]")
    ok('Esc skips the performance, terminal stays open', v == [False, True], str(v))
    card = js(page, "return sr.querySelector('.zt-fx-card')?.textContent||''")
    ok('result card: what + 账本已确认', '拜入青云门' in card and '8,000' in card and '账本已确认' in card, card[:80])
    ok('ledger really has the receipt', (z(page).get('任务结算凭据') or {}).get('T2', {}).get('点数') == 8000)
    print('card', js(page, "const c=sr.querySelector('.zt-fx-card');const r=c?.getBoundingClientRect();return c?[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height),h.isOpen]:null"))
    js(page, "sr.querySelector('.zt-fx-card [data-fx=open]').click();return 1"); page.wait_for_timeout(700)
    ok('查看记录 → 事件线 with the task selected', js(page, "return [h.page,app.atlas.sel.events]") == ['events', 'task:T2'])
    commit(page, "z.累计抽数=10;z.神品次数=1;"); commit(page, "z.累计抽数=0;z.神品次数=0;"); page.wait_for_timeout(1000)
    hist = js(page, "return app.fx.history.map(x=>x.kind+':'+x.state)")
    ok('rolled-back draw never plays (history: 未入账)', hist[0] == 'draw:dropped' and not js(page, "return !!sr.querySelector('.zt-fx[data-kind=draw]')"), str(hist[:3]))
    page.emulate_media(reduced_motion='reduce')
    commit(page, "z.背包.push({名称:'养魂木',品级:'仙品',数量:1});"); page.wait_for_timeout(900)
    ok('reduced motion: no overlay, result card only', not js(page, "return !!sr.querySelector('.zt-fx')") and '养魂木' in js(page, "return sr.querySelector('.zt-fx-card')?.textContent||''"))
    page.emulate_media(reduced_motion='no-preference')
    js(page, "app.settings.patch('fx',{mode:'off'});return 1"); js(page, "sr.querySelectorAll('.zt-fx-card').forEach(c=>c.remove());return 1")
    commit(page, "z.背包.push({名称:'定风珠',品级:'灵品',数量:1});"); page.wait_for_timeout(900)
    ok('fx off: nothing shown, still recorded as booked', not js(page, "return !!sr.querySelector('.zt-fx,.zt-fx-card')") and js(page, "return app.fx.history[0].kind+':'+app.fx.history[0].state") == 'reward:booked')
    js(page, "app.settings.patch('fx',{mode:'full'});return 1")

    # ---- 星图: record a travel with real typing ----
    js(page, "h.go('stars');return 1"); page.wait_for_timeout(500)
    page.locator('#page-stars [data-f=world]').fill('夜之城'); page.locator('#page-stars [data-travel-form]').click(); page.wait_for_timeout(900)
    zz = z(page)
    ok('travel written + read back (当前世界, footprints)', zz.get('当前世界') == '夜之城' and any(x.get('名称') == '夜之城' for x in zz.get('万界足迹', [])))
    ok('old 世界类型 does not carry over', zz.get('世界类型', '') == '')
    ok('travel performance plays', js(page, "return !!sr.querySelector('.zt-fx[data-kind=travel]')")); shot(page, '04-fx-travel')
    page.wait_for_timeout(2600)
    ok('theme switches to 赛博', js(page, "return [sr.host.getAttribute('data-zt-world'),h.engineFrame?.contentDocument?.documentElement.dataset.ztWorld]") == ['cyber', 'cyber'])
    js(page, "h.go('ov');return 1"); page.wait_for_timeout(500)
    box_c = nav_boxes(page)
    ok('controls keep their positions across themes', box_x == box_c, f'{len(box_x)} nav buttons')
    shot(page, '05-cyber-ov')
    # AI-style world change that keeps the old type → type is cleared, theme from the name
    commit(page, "z.世界类型='赛博';"); page.wait_for_timeout(300)
    commit(page, "z.当前世界='雾隐镇';"); page.wait_for_timeout(1500)
    ok('AI world change: stale type cleared, 雾隐镇 → 诡异', z(page).get('世界类型', '') == '' and js(page, "return app.world.theme") == 'eerie')
    ok('AI world change recorded in footprints', any(x.get('名称') == '雾隐镇' for x in z(page).get('万界足迹', [])))
    page.wait_for_timeout(2200); shot(page, '06-eerie')
    js(page, "app.settings.patch('world',{theme:'xianxia'});return 1"); page.wait_for_timeout(300)
    ok('settings can pin a theme', js(page, "return sr.host.getAttribute('data-zt-world')") == 'xianxia')
    js(page, "app.settings.patch('world',{theme:'auto'});return 1")

    # ---- Lilith: engine selection + camera ----
    js(page, "h.go('bag');return 1"); page.wait_for_timeout(1800)
    page.wait_for_timeout(1900)
    r = js(page, "const d=h.engineFrame.contentDocument,b=d.querySelector('.btn-item-detail[data-item]');if(!b)return 'none';b.click();return JSON.parse(b.dataset.item).名称")
    page.wait_for_timeout(500)
    bub = js(page, "return app.assistant.stage()?.bubble?.textContent||''")
    ok('Lilith reacts to selecting a bag item (name in the line)', r != 'none' and r in bub, f'{r} / {bub}')
    js(page, "const d=h.engineFrame.contentDocument;const t=d.querySelector('.mvu-modal-toggle:checked');if(t)t.checked=false;return 1")
    js(page, "h.go('work');return 1"); page.wait_for_timeout(500)
    ok('camera: 工作台 = full', js(page, "return sr.host.getAttribute('data-zt-cam')") == 'full')

    # ---- settings: terminal-only UI ----
    js(page, "h.go('set');return 1"); page.wait_for_timeout(500)
    opts = js(page, "return [...sr.querySelectorAll('#page-set select[data-k=statusbar] option')].map(o=>o.value)")
    ok('status bar compat mode no longer offered', opts == ['terminal', 'off'], str(opts))
    ok('compat-only rows removed', not js(page, "return !!sr.querySelector('#page-set [data-k=compactHistory],#page-set [data-k=statusbarMaxDepth]')"))
    ok('new settings present', js(page, "return ['world.theme','fx.mode','fx.outside','lilith.react','lilith.camera'].every(k=>sr.querySelector(`#page-set [data-k=\"${k}\"]`))"))

    # ---- 剧情提示 outside the terminal ----
    js(page, "h.close();return 1"); page.wait_for_timeout(600)
    commit(page, "z.背包.push({名称:'紫金葫芦',品级:'仙品',数量:1});"); page.wait_for_timeout(1200)
    out = page.evaluate("(()=>{const h=document.getElementById('zhutian-fx-host');const c=h?.shadowRoot.querySelector('.zt-fx-card');return c?[c.textContent,!!c.querySelector('.zt-fx-bust')]:null})()")
    ok('closed terminal: story-hint card with Lilith bust', bool(out) and '紫金葫芦' in out[0] and out[1], str(out)[:100]); shot(page, '07-outside-card')
    js(page, "h.open('ov');return 1"); page.wait_for_timeout(600)
    ok('opening the terminal clears the outside card', page.evaluate("!document.getElementById('zhutian-fx-host')?.shadowRoot.querySelector('.zt-fx-card')"))
    js(page, "h.close();return 1"); page.wait_for_timeout(400)
    sh_ok = js(page, "const s=app.assistant.shadow;(s.querySelector('#header-avatar'))?.click();await new Promise(r=>setTimeout(r,900));app.lilith.mountCloseUp();return !!s.querySelector('#lc-panel .zt-lc-cam, .zt-lc-cam')")
    ok('私聊: face close-up strip', sh_ok); shot(page, '08-private-close-up')
    ok('no page errors', not errs, '; '.join(errs)[:300])
    b.close()

    # ---- phone ----
    b = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    ctx = b.new_context(viewport={'width': 390, 'height': 800}, device_scale_factor=1, has_touch=True)
    page = ctx.new_page(); Z.boot(page); Z.open_chat(page)
    for pg in ['events', 'bonds', 'stars', 'tree']:
        js(page, f"h.open('{pg}');return 1"); page.wait_for_timeout(700)
        wide = js(page, "const s=sr.querySelector('.page-scroll');return s.scrollWidth-s.clientWidth")
        ok(f'phone {pg}: no page-level horizontal overflow', wide <= 2, str(wide))
        shot(page, f'09-phone-{pg}')
    b.close()

passed = sum(1 for r in results if r[1])
print(f'{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
