"""0.6.0 acceptance: 诸天万界聊天群 inside the terminal (isolated SillyTavern + mock model only).
Every item/point that reaches the host is checked in the ledger (read back from chat variables), never only in the UI.
Usage: python3 tests/native_group060.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots060')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def mock_requests():
    try: return [json.loads(l) for l in open(args.mock_log, encoding='utf8') if l.strip()]
    except FileNotFoundError: return []

def body_text(req):
    return '\n'.join(str(m.get('content')) for m in req['body'].get('messages', []))

def fired(phrase, before): return [r for r in mock_requests()[before:] if phrase in body_text(r)]
def z(page): return page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
def grp(page): return z(page).get('聊天群') or {}
def hub(page, js): return page.evaluate(f"(async()=>{{const app=__zhutianApp,h=app.hub,sr=h.shadow,G=app.group,el=sr.getElementById('page-group');{js}}})()")
def click(page, sel, wait=900):
    r = hub(page, f"const b=el.querySelector({json.dumps(sel)});if(!b)return 'missing';if(b.disabled)return 'disabled';b.click();return 'ok'"); page.wait_for_timeout(wait); return r
def fill(page, sel, val):
    hub(page, f"const i=el.querySelector({json.dumps(sel)});i.value={json.dumps(val)};i.dispatchEvent(new Event('input',{{bubbles:true}}));i.dispatchEvent(new Event('change',{{bubbles:true}}))")
def toast(page): return hub(page, "return sr.getElementById('zt-hub-toast')?.hidden===false?sr.getElementById('zt-hub-toast').textContent:''")
def bag(page, name): return [i for i in (z(page).get('背包') or []) if i.get('名称') == name]
def tab(page, k): click(page, f'[data-gtab="{k}"]', 400)

def setup(page):
    page.evaluate("""async()=>{const s=__zhutianApp.settings;s.set('statusbar','terminal');s.set('hubOutsideClose','auto');
      const m=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/api-center.js');
      await m.saveConfigs(__zhutianApp.bridge,'诸天记忆助手_v1',{url:'""" + args.mock + """',key:'qa-key-not-real',model:'mock-zt',maxTokens:1500});}""")
    Z.setup_chat(page)
    page.evaluate("""async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const z=v.诸天系统;z.系统点=3000000;z.累计消费=0;delete z.聊天群;
      z.背包=[{名称:'铁剑',品级:'凡品',来源:'测试',价格:300,分类:'武器',效果:'',数量:2},{名称:'灵草',品级:'凡品',来源:'测试',价格:80,分类:'素材',效果:'',数量:5}];return v;},{type:'chat'});}""")
    hub(page, "h.open('ov');await new Promise(r=>setTimeout(r,500));sr.getElementById('reset-window')?.click();await new Promise(r=>setTimeout(r,300))")

def run(page):
    q = hub(page, "const b=sr.querySelector('.zt-nav-group[data-group=\"万界\"] [data-page=group]');return !!b")
    ok('聊天群 has its own nav entry (万界 group)', q)
    hub(page, "h.go('group')"); page.wait_for_timeout(600)
    ok('empty group page explains how to start', '招募' in hub(page, "return el.innerText"))
    # --- recruit ---
    tab(page, 'members'); before = len(mock_requests()); p0 = z(page)['系统点']
    click(page, '[data-g=recruit]', 2500)
    c = grp(page).get('候选') or {}
    ok('招募令: 100 charged (0.8.1), AI card parsed (name/world/tier/personality/specialty)', z(page)['系统点'] == p0 - 100 and c.get('名称') == '叶清寒' and c.get('档') == 2 and len(fired('你是诸天万界聊天群的招募系统。', before)) == 1, str(c))
    p0 = z(page)['系统点']; click(page, '[data-g=invite]', 1200)
    g = grp(page)
    ok('邀请入群: join fee by tier (武道宗师 = 1,500 since 0.8.1) booked, member added', z(page)['系统点'] == p0 - 1500 and [m['名称'] for m in g['成员']] == ['叶清寒'], f"{p0}->{z(page)['系统点']}")
    fill(page, '[data-f=rmode]', 'world'); fill(page, '[data-f=rhint]', '青丘'); click(page, '[data-g=recruit]', 2500)
    p0 = z(page)['系统点']; click(page, '[data-g=invite]', 1200)
    ok('指定世界 招募 → 白浅 (城市级, 30,000 since 0.8.1)', z(page)['系统点'] == p0 - 30000 and grp(page)['成员'][-1]['名称'] == '白浅')
    fill(page, '[data-f=rmode]', 'rand'); fill(page, '[data-f=rhint]', ''); click(page, '[data-g=recruit]', 2500); click(page, '[data-g=invite]', 1200)
    ok('third member joins (苏小蛮)', [m['名称'] for m in grp(page)['成员']] == ['叶清寒', '白浅', '苏小蛮'])
    page.screenshot(path=str(SHOTS / 'g060-members.png'))
    # --- chat round ---
    tab(page, 'chat'); before = len(mock_requests()); n0 = len(grp(page)['消息'])
    fill(page, '#zt-g-input', '大家好！谁发红包，再来个物品红包，顺便送礼')
    click(page, '[data-g=send]', 3500)
    reqs = fired('你是诸天万界聊天群。', before); g = grp(page)
    ok('one host message = exactly one model request', len(reqs) == 1, str(len(reqs)))
    ok('request carries members, rules and the grade ceiling', reqs and '- 叶清寒（问剑宗·武道宗师' in body_text(reqs[0]) and '不得高于灵品' in body_text(reqs[0]))
    texts = [m['text'] for m in g['消息'][n0:]]
    ok('1–6 members answered; lines from non-members dropped', any('群主好' in t for t in texts) and not any('必须被忽略' in t for t in texts), str(texts)[:200])
    packs = list(g['红包'].values())
    pts_pk = next((p for p in packs if p['kind'] == 'points'), None); item_pk = next((p for p in packs if p['kind'] == 'item'), None)
    # 0.8.2: the total is capped by the member's own 入群费 too — 叶清寒 (武道宗师, 入群费 1,500) asks 3,000 → 1,500, marked downgraded
    ok('points red packet created from the member, capped at the member’s 入群费 (asked 3000 → 1500, 3 shares)', pts_pk and pts_pk['total'] == 1500 and pts_pk.get('downgraded') and len(pts_pk['shares']) == 3 and sum(pts_pk['shares']) == 1500, str(pts_pk)[:160])
    ok('item red packet auto-downgraded 仙品 → 灵品 (shop Lv2)', item_pk and item_pk['item']['品级'] == '灵品' and item_pk['downgraded'], str(item_pk)[:160])
    gifts = g['待领取']
    ok('gift becomes a 待领取 card, 神品 → 灵品', len(gifts) == 1 and gifts[0]['item']['品级'] == '灵品' and gifts[0]['item']['名称'] == '太虚剑谱残卷', str(gifts)[:160])
    page.screenshot(path=str(SHOTS / 'g060-chat.png'))
    # --- grab ---
    p0 = z(page)['系统点']
    click(page, f'[data-grab="{pts_pk["id"]}"]', 1200)
    pk = grp(page)['红包'][pts_pk['id']]; mine = next((x['v'] for x in pk['grabs'] if x['who'] == 'me'), 0)
    ok('抢红包: share booked into 系统点 (ledger read back) before 已入库', mine > 0 and z(page)['系统点'] == p0 + mine and '已入库' in toast(page), f"+{mine} {p0}->{z(page)['系统点']} | {toast(page)}")
    ok('others grabbed the remaining shares (拼手气)', len(pk['grabs']) == 3 and all(x['who'] != pts_pk['from'] for x in pk['grabs']))
    r = hub(page, f"const b=el.querySelector('[data-grab=\"{pts_pk['id']}\"]');return b?'still':'gone'")
    ok('packet card no longer offers 抢 after grabbing', r == 'gone')
    click(page, f'[data-grab="{item_pk["id"]}"]', 1200)
    got = bag(page, '青丘桃花酿')
    ok('物品红包: item in the bag with source 聊天群·白浅@青丘·红包 (0.8.2)', got and got[0]['品级'] == '灵品' and got[0]['来源'] == '聊天群·白浅@青丘·红包', str(got))
    click(page, f'[data-claim="{gifts[0]["id"]}"]', 1200)
    got = bag(page, '太虚剑谱残卷')
    ok('赠礼 领取: booked into the bag, 待领取 cleared', got and got[0]['来源'] == '聊天群·白浅@青丘·赠礼' and not grp(page)['待领取'], str(got))
    # --- host red packets ---
    click(page, '[data-g=sheet-packet]', 300); fill(page, '[data-f=amount]', '1000'); fill(page, '[data-f=count]', '3')
    p0 = z(page)['系统点']; fav0 = {m['名称']: m['好感'] for m in grp(page)['成员']}
    click(page, '[data-g=packet-go]', 1200)
    g = grp(page); fav1 = {m['名称']: m['好感'] for m in g['成员']}
    ok('发红包 (系统点): 1,000 charged, members grabbed, 好感 up', z(page)['系统点'] == p0 - 1000 and all(fav1[k] > fav0[k] for k in fav0), f"{p0}->{z(page)['系统点']} {fav0}->{fav1}")
    click(page, '[data-g=sheet-packet]', 300)
    hub(page, "el.querySelector('input[name=zt-g-pk][value=item]').checked=true")
    idx = next(i for i, it in enumerate(z(page)['背包']) if it['名称'] == '灵草'); fill(page, '[data-f=bag]', str(idx)); fill(page, '[data-f=qty]', '2')
    click(page, '[data-g=packet-go]', 1200)
    ok('发红包 (物品): 2 灵草 left the bag', bag(page, '灵草')[0]['数量'] == 3)
    # --- daily / help / live / private ---
    p0 = z(page)['系统点']; click(page, '[data-g=sign]', 1000)
    ok('签到: reward booked (100×streak + 10×members)', z(page)['系统点'] == p0 + 130 and grp(page)['签到']['streak'] == 1, f"{p0}->{z(page)['系统点']}")
    ok('签到 button disabled for the rest of the day', click(page, '[data-g=sign]', 200) == 'disabled')
    click(page, '[data-g=sheet-help]', 300); fill(page, '[data-f=help]', '想找一本能修复经脉的功法'); click(page, '[data-g=help-go]', 2500)
    tasks = [t for t in (z(page).get('任务库') or {}).values() if '聊天群求助' in str(t.get('来源'))]
    ok('求助 → a 待接取 task in 任务库 (visible on the 任务 page)', tasks and tasks[0]['状态'] == '待接取' and tasks[0]['名称'] == '寻找失落剑谱', str(tasks)[:160])
    click(page, '[data-g=live]', 2500)
    ok('群直播: live message in the chat', any(m.get('kind') == 'live' for m in grp(page)['消息']))
    tab(page, 'members'); yid = next(m['id'] for m in grp(page)['成员'] if m['名称'] == '叶清寒')
    click(page, f'[data-pm="{yid}"]', 300); fill(page, '[data-f=pm]', '明天切磋？'); click(page, f'[data-g=pm-send][data-id="{yid}"]', 2500)
    pm = grp(page)['私聊'].get(yid, [])
    ok('私聊: host line + member reply stored', len(pm) == 2 and '切磋' in pm[1]['text'], str(pm)[:120])
    # --- admin ---
    sid = next(m['id'] for m in grp(page)['成员'] if m['名称'] == '苏小蛮')
    click(page, f'[data-admin=mute][data-id="{sid}"]', 800)
    tab(page, 'chat'); before = len(mock_requests()); fill(page, '#zt-g-input', '都在吗'); click(page, '[data-g=send]', 3000)
    req = fired('你是诸天万界聊天群。', before)
    ok('禁言: model told the member is muted', req and '苏小蛮（东海渔村·凡人顶尖·活泼话多·特产东海咸鱼干·好感' in body_text(req[0]) and '禁言中' in body_text(req[0]))
    tab(page, 'members'); page.on('dialog', lambda d: d.accept())
    click(page, f'[data-admin=kick][data-id="{sid}"]', 900)
    ok('踢人: member removed', '苏小蛮' not in [m['名称'] for m in grp(page)['成员']])
    click(page, f'[data-admin=op][data-id="{yid}"]', 800)
    ok('管理员: role saved', next(m for m in grp(page)['成员'] if m['id'] == yid)['身份'] == '管理员')
    # --- descend ---
    p0 = z(page)['系统点']; click(page, f'[data-descend="{yid}"]', 1000)
    pr = page.evaluate("SillyTavern.getContext().extensionPrompts['zhutian-covenant-terminal/group']?.value||''")
    ok('降临: cost booked (tier price / 10) and injected into the story prompt', z(page)['系统点'] == p0 - 1000 and '群员降临' in pr and '叶清寒' in pr, pr[:120])
    last_ai = page.evaluate("SillyTavern.getContext().chat.map((m,i)=>[m,i]).filter(([m])=>!m.is_user).pop()[1]")
    for _ in range(3): page.evaluate(f"__zhutianApp.group.onStoryReply({last_ai})"); page.wait_for_timeout(700)
    ok('降临 ends after 3 story replies', grp(page).get('降临') is None and '群员降临' not in page.evaluate("SillyTavern.getContext().extensionPrompts['zhutian-covenant-terminal/group']?.value||''"))
    # --- market ---
    tab(page, 'market'); click(page, '[data-g=market]', 900)
    lst = grp(page)['集市']['list']
    ok('群员挂单: one listing per member, grades within the floor', len(lst) == 2 and all(x['item']['品级'] in ('凡品', '灵品') for x in lst), str([(x['item']['名称'], x['item']['品级'], x['price']) for x in lst]))
    p0 = z(page)['系统点']; click(page, f'[data-buy="{lst[0]["id"]}"]', 1000)
    got = bag(page, lst[0]['item']['名称'])
    ok('买下: price booked, item in bag with source', z(page)['系统点'] == p0 - lst[0]['price'] and got and '@' in got[0]['来源'])
    idx = next(i for i, it in enumerate(z(page)['背包']) if it['名称'] == '铁剑')
    fill(page, '[data-f=sell]', str(idx)); fill(page, '[data-f=price]', '1000'); click(page, '[data-g=sell]', 900)
    sale = grp(page)['挂单'][-1]; click(page, f'[data-hawk="{sale["id"]}"]', 900)
    ok('挂单 above 130% of the original valuation is refused', grp(page)['挂单'] and grp(page)['挂单'][-1]['id'] == sale['id'])
    click(page, f'[data-unlist="{sale["id"]}"]', 900)
    ok('撤单 returns the item', bag(page, '铁剑')[0]['数量'] == 2)
    idx = next(i for i, it in enumerate(z(page)['背包']) if it['名称'] == '铁剑')
    fill(page, '[data-f=sell]', str(idx)); fill(page, '[data-f=price]', '300'); click(page, '[data-g=sell]', 900)
    sale = grp(page)['挂单'][-1]; p0 = z(page)['系统点']; click(page, f'[data-hawk="{sale["id"]}"]', 900)
    ok('挂单 at valuation sells: +300 booked', z(page)['系统点'] == p0 + 300 and not grp(page)['挂单'])
    page.screenshot(path=str(SHOTS / 'g060-market.png'))
    # --- capacity / settings / injection ---
    tab(page, 'members'); p0 = z(page)['系统点']; click(page, '[data-g=expand]', 900)
    ok('扩建: 5 → 10 for 5,000 (0.8.2: 1,000 per seat)', grp(page)['容量'] == 10 and z(page)['系统点'] == p0 - 5000)
    pr = page.evaluate("SillyTavern.getContext().extensionPrompts['zhutian-covenant-terminal/group']?.value||''")
    ok('group summary injected (members + recent chat)', '诸天万界聊天群' in pr and '叶清寒（问剑宗·武道宗师）' in pr and '最近群聊' in pr, pr[:160])
    tab(page, 'admin'); click(page, '[data-g=inject]', 900)
    ok('summary injection can be switched off', page.evaluate("SillyTavern.getContext().extensionPrompts['zhutian-covenant-terminal/group']?.value||''") == '')
    fill(page, '[data-f=notice]', '本群禁止刷屏'); click(page, '[data-g=meta]', 900)
    ok('公告 saved', grp(page)['公告'] == '本群禁止刷屏')
    click(page, '[data-g=auto]', 900)
    before = len(mock_requests())
    page.evaluate(f"(async()=>{{await __zhutianApp.group.onStoryReply({last_ai});await __zhutianApp.group.onStoryReply({last_ai});}})()"); page.wait_for_timeout(1500)
    quiet = len(fired('【宿主没有发言】', before))
    page.evaluate(f"__zhutianApp.group.onStoryReply({last_ai})"); page.wait_for_timeout(3000)
    ok('自动闲聊 every 3 story replies (0.8.2 default): none after 2, one after the 3rd', quiet == 0 and len(fired('【宿主没有发言】', before)) == 1, f'{quiet}')
    tab(page, 'chat'); page.screenshot(path=str(SHOTS / 'g060-chat-end.png'))
    lv = hub(page, "return [sr.getElementById('zt-top-shop').textContent, el.querySelector('.zt-g-head small').textContent, app.bridge.getVariables({type:'chat'}).诸天系统.商城等级]")
    ok('shop level agrees: terminal top bar = group header = ledger 商城等级', lv[0] == f'Lv.{lv[2]}' and f'商城 Lv{lv[2]}' in lv[1], str(lv))
    # --- persistence ---
    page.reload(); Z.boot(page); Z.open_chat(page)
    n = page.evaluate("(__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统?.聊天群?.成员||[]).length")
    ok('group survives a reload (chat variables)', n == 2, str(n))

def mobile(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    Z.boot(page); Z.open_chat(page)
    hub(page, "h.open('group')"); page.wait_for_timeout(1200)
    q = hub(page, "const r=s=>{const b=el.querySelector(s)?.getBoundingClientRect();return b?[b.x|0,b.y|0,b.width|0,b.height|0]:null};return {log:r('.zt-g-log'),send:r('.zt-g-send'),vh:innerHeight}")
    ok('phone: chat log + input fit the screen', q['log'] and q['log'][3] > 250 and q['send'] and q['send'][1] + q['send'][3] <= q['vh'], str(q))
    page.screenshot(path=str(SHOTS / 'g060-mobile.png'))
    ok('phone: no page errors', not errs, str(errs)[:200])
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1400, 'height': 900}); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    Z.boot(page); setup(page)
    try: run(page)
    except Exception as e: ok('group phase ran without exception', False, str(e)[:300]); page.screenshot(path=str(SHOTS / 'g060-crash.png'))
    ok('no page errors (desktop)', not errs, str(errs)[:300])
    try: mobile(browser)
    except Exception as e: ok('mobile phase ran without exception', False, str(e)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
