"""0.5.0 acceptance: ONE terminal window that holds the whole 诸天 system (isolated SillyTavern + mock model only).
Checks: single window & drawer, terminal-mode floors (no in-message status bar), the original 3.1 engine inside the
terminal (bound to the latest data block, all 8 pages via terminal navigation), every engine operation with ledger
read-back, 外挂 switches + 自拟外挂 (prompt + charged activation), 4 ways to close, settings page, phone layout.
Usage: python3 tests/native_terminal050.py --isolated-test-only --base-url http://127.0.0.1:8019 [--phase all|single,ops,...]
"""
import argparse, json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / 'qa'))
import zt_common as Z
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--isolated-test-only', action='store_true', required=True)
ap.add_argument('--base-url', default='http://127.0.0.1:8019')
ap.add_argument('--mock', default='http://127.0.0.1:5001/v1')
ap.add_argument('--mock-log', default='/var/tmp/qa/mock.jsonl')
ap.add_argument('--phase', default='all')
ap.add_argument('--shots', default='/var/tmp/qa/shots050')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots)
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def mock_requests():
    try: return [json.loads(l) for l in open(args.mock_log, encoding='utf8') if l.strip()]
    except FileNotFoundError: return []

def body_text(req):
    return '\n'.join(str(m.get('content') if isinstance(m.get('content'), str) else json.dumps(m.get('content'), ensure_ascii=False)) for m in req['body'].get('messages', []))

def fired(phrase, before): return [r for r in mock_requests()[before:] if phrase in body_text(r)]
def z(page): return page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
def hub(page, js): return page.evaluate(f"(async()=>{{const app=__zhutianApp,h=app.hub,sr=h.shadow;{js}}})()")

def engine(page):
    page.wait_for_function("!!__zhutianApp.hub.engineFrame && __zhutianApp.hub.engineFrame.contentDocument?.querySelector('#zt-hub-engine-css')", timeout=20000)
    return page.evaluate_handle("__zhutianApp.hub.engineFrame").as_element().content_frame()

def go(page, p, wait=700):
    hub(page, f"h.go({json.dumps(p)})"); page.wait_for_timeout(wait)

def reset(page):
    page.evaluate("""async()=>{const s=__zhutianApp.settings;s.set('statusbar','terminal');s.set('floorTag',true);s.set('hubPage','ov');s.set('hubOutsideClose','auto');s.set('hubBackClose',true);
      localStorage.removeItem('zhutian.customPlugins.v1');
      const m=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/api-center.js');
      await m.saveConfigs(__zhutianApp.bridge,'诸天记忆助手_v1',{url:'""" + args.mock + """',key:'qa-key-not-real',model:'mock-zt',maxTokens:1500});}""")
    # a phone run remembers a narrow window; start every desktop run from the default window size
    hub(page, "h.open('ov');await new Promise(r=>setTimeout(r,500));sr.getElementById('reset-window')?.click();await new Promise(r=>setTimeout(r,300));h.close()"); page.wait_for_timeout(400)

def phase_single(page):
    q = page.evaluate("""()=>{const a=__zhutianApp,sr=a.assistant.shadow;return {dialogs:sr.querySelectorAll('dialog').length,
      oldTerm:!!document.getElementById('zt-covenant-launcher')||!!sr.getElementById('zt-open-terminal')||!!document.querySelector('#zhutian-covenant-terminal dialog'),
      title:sr.getElementById('title')?.textContent, nav:[...sr.querySelectorAll('.nav-button[data-page]')].map(b=>b.dataset.page),
      drawer:[...document.querySelectorAll('#zhutian-covenant-terminal-settings [data-act]')].map(b=>b.dataset.act), drawerInputs:document.querySelectorAll('#zhutian-covenant-terminal-settings input,#zhutian-covenant-terminal-settings select').length}}""")
    ok('one window: Lilith window is the terminal, no second terminal', q['dialogs'] == 1 and not q['oldTerm'] and q['title'] == '诸天终端', str(q)[:200])
    need = ['ov', 'task', 'bond', 'cult', 'shop', 'bag', 'plug', 'art', 'work', 'memory', 'rules', 'api', 'env', 'set']
    ok('navigation holds system + Lilith + settings pages in fixed order', [p for p in q['nav'] if p in need] == need, str(q['nav']))
    # 1.0: + 「显示悬浮莉莉丝」 (brings a closed floating Lilith back; no settings inputs in the drawer)
    ok('Extensions drawer keeps only entry + show floating Lilith + emergency restore', q['drawer'] == ['open', 'float', 'restore'] and q['drawerInputs'] == 0, str(q['drawer']))
    hub(page, "document.querySelector('#zhutian-covenant-terminal-settings [data-act=open]').click()"); page.wait_for_timeout(800)
    ok('drawer button opens the terminal', hub(page, 'return h.isOpen'))
    hub(page, 'h.close()'); page.wait_for_timeout(400)

def phase_floors(page):
    q = page.evaluate("""()=>{const m=[...document.querySelectorAll('#chat .mes[mesid]')];return {frames:document.querySelectorAll('#chat iframe').length,
      tags:document.querySelectorAll('#chat .zt-floor-tag').length, raw:m.some(e=>/ZhuTianPanel|ZTPANELSLOT|系统播报: 楼层测试/.test(e.querySelector('.mes_text')?.textContent||'')),
      tag5:document.querySelector('#chat .mes[mesid="5"] .zt-floor-tag')?.textContent||'', voices:document.querySelectorAll('#chat .zt-lilith-voice').length, mode:__zhutianApp.statusbar.state.mode}}""")
    ok('terminal mode: no status bar in the story', q['mode'] == 'terminal' and q['frames'] == 0, str(q))
    ok('each data block leaves one small chip; no raw block text', q['tags'] == 3 and not q['raw'] and '1200' in q['tag5'], q['tag5'])
    ok('voice box still rendered', q['voices'] == 3)
    page.locator('#chat .mes[mesid="3"] .zt-floor-tag').click(); page.wait_for_timeout(1200)
    ok('chip opens the terminal on 总览', hub(page, "return h.isOpen && h.page==='ov'"))
    page.screenshot(path=str(SHOTS / 't050-floor-chip-open.png'))
    hub(page, 'h.close()'); page.wait_for_timeout(400)
    page.evaluate("__zhutianApp.settings.set('floorTag',false)"); page.wait_for_timeout(900)
    n = page.evaluate("[...document.querySelectorAll('#chat .zt-floor-tag')].filter(e=>e.offsetParent).length")
    ok('chip can be switched off', n == 0, str(n))
    page.evaluate("__zhutianApp.settings.set('floorTag',true)"); page.wait_for_timeout(600)
    page.evaluate("__zhutianApp.settings.set('statusbar','native')"); page.wait_for_timeout(1500)
    ok('compat mode brings the in-message bar back', page.evaluate("document.querySelectorAll('#chat .zt-native-statusbar iframe').length") == 1)
    page.evaluate("__zhutianApp.settings.set('statusbar','terminal')"); page.wait_for_timeout(1500)
    ok('back to terminal mode', page.evaluate("document.querySelectorAll('#chat iframe').length") == 0)

def phase_engine(page):
    hub(page, "h.open('ov')"); page.wait_for_timeout(1500)
    fr = engine(page)
    sig = hub(page, 'return h.engineSig')
    ok('engine bound to the latest data-block floor (5) with capture', sig.split('|')[1] == '5' and sig.endswith('|1'), sig)
    page.wait_for_timeout(1500)
    led = z(page)
    ok('engine recorded the latest block (面板账本 key 5, same as the old in-message bar)', '5' in (led.get('面板账本') or {}), str(list((led.get('面板账本') or {}).keys())))
    tabs = {}
    for p_, n in [('ov', 1), ('bond', 2), ('task', 3), ('cult', 4), ('shop', 5), ('bag', 6), ('plug', 7), ('art', 8)]:
        go(page, p_, 500)
        tabs[p_] = fr.evaluate(f"(()=>{{const r=document.querySelector('input.t{n}');const p=document.querySelector('.mvu-panel.p{n}');return !!r?.checked && !!p && getComputedStyle(p).display!=='none' && p.getBoundingClientRect().height>100}})()")
    ok('all 8 original pages reachable from terminal navigation', all(tabs.values()), str(tabs))
    hidden = fr.evaluate("(()=>{const n=document.querySelector('.mvu-nav'),h=document.querySelector('.mvu-head-area');return (!n||getComputedStyle(n).display==='none')&&(!h||getComputedStyle(h).display==='none')})()")
    ok('bar header/tabs replaced by terminal navigation', hidden)
    top = hub(page, "return {w:sr.getElementById('zt-top-world').textContent,p:sr.getElementById('zt-top-pts').textContent}")
    ok('top bar shows world and points from the ledger', top['w'] == '太初仙域' and top['p'].replace(',', '') == str(led['系统点']), str(top))
    size = hub(page, "const r=h.engineFrame.getBoundingClientRect();return [r.width|0,r.height|0]")
    ok('engine fills the content area', size[0] > 500 and size[1] > 450, str(size))

def phase_ops(page):
    hub(page, "h.open('shop')"); page.wait_for_timeout(800)
    page.evaluate("""async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const z=v.诸天系统||(v.诸天系统={});
        z.系统点=300000;z.界面记账时间=Date.now();
        z.背包=[{名称:'铁剑',品级:'凡品',来源:'测试',价格:300,分类:'其他',效果:'',数量:1},{名称:'灵草',品级:'凡品',来源:'测试',价格:80,分类:'其他',效果:'',数量:2},{名称:'布衣',品级:'凡品',来源:'测试',价格:120,分类:'其他',效果:'',数量:1}];return v;},{type:'chat'});}""")
    hub(page, 'h.reloadEngine()'); page.wait_for_timeout(1800)
    fr = engine(page)
    fr.evaluate("window.__alerts=[];window.alert=m=>window.__alerts.push(String(m));window.confirm=()=>true;Math.random=()=>0.5;")
    click = lambda sel: fr.evaluate(f"(()=>{{const e=document.querySelector({json.dumps(sel)});if(!e)return false;e.click();return true}})()")
    alerts = lambda: fr.evaluate("window.__alerts.splice(0)")
    go(page, 'shop')
    # gacha 单抽
    before = len(mock_requests()); p0 = z(page)['系统点']; bag0 = len(z(page)['背包'])
    click('.btn-gacha[data-times="1"]'); page.wait_for_timeout(5000)
    g = fired('你是诸天系统的奖励生成器', before); z1 = z(page)
    ok('商城 · 单抽: 10,000 charged, reward generator called once', len(g) == 1 and z1['系统点'] == p0 - 10000, f"{len(g)} {p0}->{z1['系统点']} {alerts()}")
    page.screenshot(path=str(SHOTS / 't050-gacha.png'))
    click('.btn-close-gacha'); page.wait_for_timeout(500)
    click('.mvu-panel.p5 .btn-keep-all'); page.wait_for_timeout(1300)
    ok('商城 · 待处理奖励 → 一键保留进背包', len(z(page)['背包']) == bag0 + 1, str([i['名称'] for i in z(page)['背包']]))
    # 十连
    before = len(mock_requests()); p0 = z(page)['系统点']
    click('.btn-gacha[data-times="10"]'); page.wait_for_timeout(6000)
    ok('商城 · 十连: 100,000 charged', z(page)['系统点'] == p0 - 100000 and len(fired('你是诸天系统的奖励生成器', before)) == 1, f"{p0}->{z(page)['系统点']} {alerts()}")
    click('.btn-close-gacha'); page.wait_for_timeout(400)
    n_pending = len(z(page).get('待处理物品') or [])
    ok('十连 results wait in 待处理奖励', n_pending >= 1, str(n_pending))
    click('.mvu-panel.p5 .btn-keep-all'); page.wait_for_timeout(1300)
    # 一键进货 + 购买
    before = len(mock_requests()); p0 = z(page)['系统点']
    click('.btn-refresh-store'); page.wait_for_timeout(4500)
    items = fr.evaluate("document.querySelectorAll('.mvu-store-item').length")
    ok('商城 · 一键进货: 500 charged, AI stock rendered', len(fired('只输出规定的格式列表', before)) == 1 and z(page)['系统点'] == p0 - 500 and items >= 1, f"{items} {p0}->{z(page)['系统点']} {alerts()}")
    p0 = z(page)['系统点']; bag0 = len(z(page)['背包'])
    bought = fr.evaluate("(()=>{const b=document.querySelector('.mvu-store-item .btn-buy-item');if(!b)return 'nobtn';b.click();return b.textContent})()")
    page.wait_for_timeout(1500)
    cart = fr.evaluate("(()=>{const b=document.querySelector('.btn-checkout');return b?getComputedStyle(b).display:'none'})()")
    z2 = z(page)
    ok('商城 · 购买: points charged and item delivered (or queued in 待结算)', z2['系统点'] < p0 and (len(z2['背包']) > bag0 or cart != 'none'), f"{bought} {p0}->{z2['系统点']} bag {bag0}->{len(z2['背包'])} {alerts()}")
    # 许愿
    before = len(mock_requests())
    fr.evaluate("(()=>{const i=document.querySelector('.wish-input');i.value='今晚吃上一桌好菜';i.dispatchEvent(new Event('input',{bubbles:true}))})()")
    click('.btn-quote'); page.wait_for_timeout(4500)
    quote = fr.evaluate("document.querySelector('.quote-text')?.innerText||''")
    ok('商城 · 万能许愿 询价 via API', len(fired('用户许愿：', before)) == 1 and ('20,000' in quote or '20000' in quote), quote[:60])
    p0 = z(page)['系统点']; click('.btn-wish-pay'); page.wait_for_timeout(1500)
    ok('商城 · 许愿 支付 charged 20,000', z(page)['系统点'] == p0 - 20000, f"{p0}->{z(page)['系统点']} {alerts()}")
    # 回收
    p0 = z(page)['系统点']; n0 = len(z(page)['背包'])
    rec = fr.evaluate("(()=>{const b=document.querySelector('.mvu-panel.p5 [class*=recycle] button, .btn-recycle');if(!b)return 'none';b.click();return b.textContent})()")
    page.wait_for_timeout(1500)
    ok('商城 · 物品回收 pays points', z(page)['系统点'] > p0 or len(z(page)['背包']) < n0, f"{rec} {p0}->{z(page)['系统点']} {alerts()}")
    # 背包整理
    go(page, 'bag'); before = len(mock_requests())
    click('.btn-bag-organize'); page.wait_for_timeout(4000)
    bag = z(page)['背包']
    ok('背包 · AI 整理 re-classified every item', len(fired('你是背包整理助手', before)) == 1 and all(i.get('分类') == '消耗品' for i in bag), str([(i['名称'], i.get('分类')) for i in bag])[:160])
    page.screenshot(path=str(SHOTS / 't050-bag.png'))
    # 外挂: 口袋 store/take, 召唤, 熔炉
    go(page, 'plug')
    fr.evaluate("(()=>{const s=document.querySelector('#pocket-select');const o=s&&[...s.options].find(x=>x.value);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}})()")
    click('.btn-pocket-store'); page.wait_for_timeout(1000)
    fr.evaluate("(()=>{const i=document.querySelector('#pocket-n');i.value='3';i.dispatchEvent(new Event('input',{bubbles:true}))})()")
    before_bag = json.dumps(z(page)['背包'], ensure_ascii=False)
    click('.btn-pocket-take'); page.wait_for_timeout(1200)
    ok('外挂 · 无限口袋 store + take ×3 writes the bag', json.dumps(z(page)['背包'], ensure_ascii=False) != before_bag, alerts())
    before = len(mock_requests())
    fr.evaluate("(()=>{const a=document.querySelector('#summon-name'),b=document.querySelector('#summon-world');a.value='叶清寒';b.value='问剑宗';a.dispatchEvent(new Event('input',{bubbles:true}));b.dispatchEvent(new Event('input',{bubbles:true}))})()")
    click('.btn-summon'); page.wait_for_timeout(4000)
    card = fr.evaluate("document.querySelector('.mvu-panel.p7').innerText")
    ok('外挂 · 诸天打手 召唤 via API', len(fired('你是诸天万界的招募官', before)) == 1 and '叶清寒' in card, alerts())
    before = len(mock_requests())
    fr.evaluate("""()=>{for(const [id,v] of [['#zt-fu-a','0'],['#zt-fu-b','1']]){const e=document.querySelector(id);if(e){e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));}}}""")
    page.wait_for_timeout(300); click('.zt-fu-go'); page.wait_for_timeout(4000)
    ok('外挂 · 万物熔炉 via API', len(fired('严格只输出一行', before)) == 1 and '九转凝元丹' in [i['名称'] for i in z(page)['背包']], alerts())
    page.screenshot(path=str(SHOTS / 't050-plugins.png'))
    # 神通
    go(page, 'art'); before = len(mock_requests())
    fr.evaluate("(()=>{const i=document.querySelector('#zt-cp-name');i.value='叶清寒';i.dispatchEvent(new Event('input',{bubbles:true}))})()")
    click('.zt-cp-eval'); page.wait_for_timeout(3500)
    ok('神通 · AI 评估实力档', len(fired('严格执行格式要求，只输出一行', before)) == 1 and fr.evaluate("document.querySelector('#zt-cp-tier')?.value") == '5', alerts())
    # 外挂 · 洞察之眼: charged, request written to the chat input, and the terminal says so
    go(page, 'plug')
    page.evaluate("document.getElementById('send_textarea').value=''"); hub(page, "sr.getElementById('zt-hub-toast')?.remove()")
    p0 = z(page)['系统点']
    fr.evaluate("(()=>{const i=document.querySelector('#zt-eye-target');i.value='叶清寒';i.dispatchEvent(new Event('input',{bubbles:true}))})()")
    click('.zt-eye-go'); page.wait_for_timeout(1500)
    cart = fr.evaluate("document.querySelector('.cart-items-list')?.innerText||''")
    click('.btn-checkout'); page.wait_for_timeout(1200)
    ta = page.evaluate("document.getElementById('send_textarea').value"); toast = hub(page, "return sr.getElementById('zt-hub-toast')?.textContent||''")
    ok('外挂 · 洞察之眼 → 购物车 → 结算写入输入框 + terminal tells the user', z(page)['系统点'] < p0 and '叶清寒' in cart and '叶清寒' in ta and '输入框' in toast, f"{p0}->{z(page)['系统点']} {ta[:40]} | {toast} {alerts()}")
    hub(page, "sr.querySelector('#zt-hub-toast .zt-toast-act')?.click()"); page.wait_for_timeout(700)
    ok('toast action 关闭终端去发送: terminal closed, input focused, text kept', not hub(page, 'return h.isOpen') and page.evaluate("document.activeElement?.id==='send_textarea' && document.getElementById('send_textarea').value.includes('叶清寒')"))
    hub(page, "h.open('plug')"); page.wait_for_timeout(600)
    page.evaluate("document.getElementById('send_textarea').value=''")
    ok('no double charge: in-story floors have no engine', page.evaluate("document.querySelectorAll('#chat iframe').length") == 0)

def phase_plugins(page):
    hub(page, "h.open('plugmgr')"); page.wait_for_timeout(700)
    hub(page, "const i=sr.querySelector('#page-plugmgr [data-builtin=\"诸天打手\"]');i.click()"); page.wait_for_timeout(900)
    go(page, 'plug', 900); fr = engine(page)
    hid = fr.evaluate("(()=>{const c=document.querySelector('[data-ui-anchor=\"zt-ui-section-7-1\"]'),b=document.querySelector('[data-ui-jump=\"zt-ui-section-7-1\"]');return getComputedStyle(c).display==='none'&&getComputedStyle(b).display==='none'})()")
    ok('外挂开关: 关闭「诸天打手」→ hidden in the terminal', hid)
    pr = page.evaluate("SillyTavern.getContext().extensionPrompts['zhutian-covenant-terminal/plugins']?.value||''")
    ok('外挂开关: model told not to use it', '诸天打手' in pr and '不得' in pr, pr[:120])
    # custom plugin
    go(page, 'plugmgr')
    hub(page, """const e=sr.getElementById('page-plugmgr');const set=(f,v)=>{const i=e.querySelector(`[data-f="${f}"]`);i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}))};
      set('name','时停怀表');set('grade','仙品');set('type','daily');set('daily','2');set('cost.kind','points');set('cost.amount','5000');set('rule','发动后时间静止三秒，宿主可自由行动。');
      e.querySelector('[data-save]').click();""")
    page.wait_for_timeout(1200)
    lib = page.evaluate("JSON.parse(localStorage.getItem('zhutian.customPlugins.v1')||'[]')")
    ok('自拟外挂 saved to the local library', len(lib) == 1 and lib[0]['name'] == '时停怀表' and lib[0]['cost']['amount'] == 5000, str(lib)[:160])
    pr = page.evaluate("SillyTavern.getContext().extensionPrompts['zhutian-covenant-terminal/plugins']?.value||''")
    ok('自拟外挂 injected as 宿主已装载外挂', '时停怀表' in pr and '宿主已装载' in pr, pr[:160])
    go(page, 'plug', 900)
    p0 = z(page)['系统点']; page.evaluate("document.getElementById('send_textarea').value=''")
    hub(page, "sr.querySelector('[data-plug-use]').click()"); page.wait_for_timeout(1800)
    ta = page.evaluate("document.getElementById('send_textarea').value")
    ok('自拟外挂 发动: 5,000 charged (read back) and action written', z(page)['系统点'] == p0 - 5000 and '时停怀表' in ta, f"{p0}->{z(page)['系统点']} {ta[:40]}")
    hub(page, "sr.querySelector('[data-plug-use]').click()"); page.wait_for_timeout(1500)
    hub(page, "sr.querySelector('[data-plug-use]').click()"); page.wait_for_timeout(1500)
    ok('每日次数 limit enforced (2/day)', z(page)['系统点'] == p0 - 10000, f"{p0}->{z(page)['系统点']}")
    page.screenshot(path=str(SHOTS / 't050-custom-plugin.png'))
    page.evaluate("document.getElementById('send_textarea').value=''")
    go(page, 'plugmgr')
    hub(page, "const i=sr.querySelector('#page-plugmgr [data-builtin=\"诸天打手\"]');i.click()"); page.wait_for_timeout(700)

def phase_close(page):
    page.evaluate("document.getElementById('chat').scrollTop=0"); y0 = page.evaluate("document.getElementById('chat').scrollTop")
    def opened(): return hub(page, 'return h.isOpen')
    hub(page, "h.open('bag')"); page.wait_for_timeout(600)
    hub(page, "sr.getElementById('close').click()"); page.wait_for_timeout(500)
    ok('close button closes the one window', not opened())
    hub(page, "h.open()"); page.wait_for_timeout(700)
    ok('reopens on the last page (背包)', hub(page, "return h.page==='bag' && !!h.engineFrame.contentDocument.querySelector('input.t6:checked')"))
    page.keyboard.press('Escape'); page.wait_for_timeout(500)
    ok('Esc closes (focus anywhere)', not opened())
    page.evaluate("__zhutianApp.settings.set('hubOutsideClose','always')")
    hub(page, "h.open('ov')"); page.wait_for_timeout(600)
    page.mouse.click(5, 450); page.wait_for_timeout(500)
    ok('click outside closes (when enabled)', not opened())
    page.evaluate("__zhutianApp.settings.set('hubOutsideClose','never')")
    hub(page, "h.open('ov')"); page.wait_for_timeout(600)
    page.mouse.click(5, 450); page.wait_for_timeout(400)
    ok('click outside ignored when set to never', opened())
    page.go_back(); page.wait_for_timeout(800)
    ok('back gesture closes the terminal, stays in SillyTavern', not opened() and page.evaluate("!!window.SillyTavern && !!document.getElementById('chat')"))
    ok('chat did not scroll', abs(page.evaluate("document.getElementById('chat').scrollTop") - y0) < 4)
    page.evaluate("__zhutianApp.settings.set('hubOutsideClose','auto')")
    hub(page, "h.open('ov')"); page.wait_for_timeout(500)
    page.keyboard.press('Alt+x'); page.wait_for_timeout(500)
    ok('Alt+X toggles the terminal closed', not opened())

def phase_settings(page):
    hub(page, "h.open('set')"); page.wait_for_timeout(600)
    q = hub(page, "const e=sr.getElementById('page-set');return {cards:e.querySelectorAll('.zt-card').length,keys:[...e.querySelectorAll('[data-k]')].map(i=>i.dataset.k),acts:[...e.querySelectorAll('[data-act]')].map(b=>b.dataset.act)}")
    need = ['statusbar', 'floorTag', 'voiceBox', 'promptStripPanels', 'macroLike', 'worldbookAuto', 'touchGestures', 'haptics', 'portrait.mode', 'hud', 'hotkeys']
    ok('settings page holds every former drawer switch', all(k in q['keys'] for k in need), str(q['keys']))
    ok('settings page holds every former drawer tool', all(a in q['acts'] for a in ['worldbook', 'init', 'migrate', 'api', 'diagnose', 'takeover', 'restore', 'live2d']), str(q['acts']))
    hub(page, "const i=sr.querySelector('#page-set [data-k=voiceBox]');i.click()"); page.wait_for_timeout(1000)
    ok('switch writes the setting and applies (voice box off)', page.evaluate("__zhutianApp.settings.get('voiceBox')") is False and page.evaluate("document.querySelectorAll('#chat .zt-lilith-voice').length") == 0)
    hub(page, "const i=sr.querySelector('#page-set [data-k=voiceBox]');i.click()"); page.wait_for_timeout(900)
    hub(page, "sr.querySelector('#page-set [data-act=diagnose]').click()"); page.wait_for_timeout(1200)
    ok('tool opens from the terminal (兼容诊断 popup)', page.locator('dialog.popup[open]').count() >= 1)
    page.screenshot(path=str(SHOTS / 't050-settings-diag.png'))
    page.keyboard.press('Escape'); page.wait_for_timeout(500)
    ok('Esc on an ST popup closes the popup, not the terminal', hub(page, 'return h.isOpen'))
    hub(page, 'h.close()')

def phase_mobile(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    Z.boot(page); Z.setup_chat(page); page.wait_for_timeout(1500)
    hub(page, "h.open('shop')"); page.wait_for_timeout(2500)
    q = hub(page, "const r=e=>{const b=(typeof e==='string'?sr.querySelector(e):e)?.getBoundingClientRect();return b?[b.x|0,b.y|0,b.width|0,b.height|0]:null};return {nav:r('nav.zt-hub-nav'),top:r('.zt-hub-top'),frame:h.engineFrame?r(h.engineFrame):null,portrait:getComputedStyle(sr.querySelector('.portrait')).display}")
    ok('phone: nav strip + top bar + engine gets the height', q['nav'] and q['nav'][3] < 90 and q['frame'] and q['frame'][3] > 450 and q['portrait'] == 'none', str(q))
    page.screenshot(path=str(SHOTS / 't050-mobile-shop.png'))
    hub(page, "h.go('work')"); page.wait_for_timeout(800)
    ok('phone: Lilith stage shows on her own pages', hub(page, "return getComputedStyle(sr.querySelector('.portrait')).display!=='none'"))
    page.screenshot(path=str(SHOTS / 't050-mobile-work.png'))
    hub(page, "h.go('ov')"); page.wait_for_timeout(500)
    page.go_back(); page.wait_for_timeout(700)
    ok('phone: back gesture closes the terminal', not hub(page, 'return h.isOpen'))
    ok('phone: no page errors', not errs, str(errs)[:200])
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900}, device_scale_factor=1)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    Z.boot(page); reset(page); Z.setup_chat(page)
    want = args.phase.split(',')
    phases = [('single', phase_single), ('floors', phase_floors), ('engine', phase_engine), ('ops', phase_ops), ('plugins', phase_plugins), ('close', phase_close), ('settings', phase_settings)]
    for name, fn in phases:
        if 'all' in want or name in want:
            try: fn(page)
            except Exception as e: ok(f'{name} phase ran without exception', False, str(e)[:300]); page.screenshot(path=str(SHOTS / f't050-{name}-crash.png'))
    ok('no page errors (desktop)', not errs, str(errs)[:300])
    if 'all' in want or 'mobile' in want:
        try: phase_mobile(browser)
        except Exception as e: ok('mobile phase ran without exception', False, str(e)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
