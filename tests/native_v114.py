"""1.1.4 browser regression: disposable SillyTavern + deterministic mock model only (NOT a real model, NOT a phone).
python3 tests/qa/mock_model.py &   # :5001
python3 tests/native_v114.py --isolated-test-only --base-url http://127.0.0.1:8019
Covers: 聊天群「↻ 重roll」/「🗑 管理」删除 / 截断提示 / 群务 → 群聊生成 · 设置 →「核对并解冻账本」·
「检查最新楼层：插件动过吗？」· 思维链保护（真实生成：思维链里的草稿数据块和莉莉丝台词原样保留）.
"""
import argparse, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent / 'qa'))
import zt_common as Z
ap = argparse.ArgumentParser(); ap.add_argument('--isolated-test-only', action='store_true', required=True)
ap.add_argument('--base-url', default='http://127.0.0.1:8019'); ap.add_argument('--mock', default='http://127.0.0.1:5001/v1')
ap.add_argument('--output', default='/tmp/zt-v114-evidence'); args = ap.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=True); Z.configure(args.base_url, args.mock, out)
results = []; dialogs = []
def ok(name, cond, detail=''):
    results.append({'name': name, 'pass': bool(cond), 'detail': str(detail)[:400]}); print(('PASS ' if cond else 'FAIL ') + name + ' ' + str(detail)[:400], flush=True)
def js(s, arg=None): return page.evaluate(s, arg) if arg is not None else page.evaluate(s)
def hub(body): return js(f"(async()=>{{const app=__zhutianApp,h=app.hub,sr=h.shadow,el=sr.getElementById('page-group');{body}}})()")
def click(sel, wait=900):
    r = hub(f"const b=el.querySelector({json.dumps(sel)});if(!b)return 'missing';if(b.disabled)return 'disabled';b.click();return 'ok'"); page.wait_for_timeout(wait); return r
def grp(): return js("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.聊天群||{}")
def texts(): return [m['text'] for m in grp().get('消息', [])]
def disk_group():
    return js("""async()=>{const c=SillyTavern.getContext();const r=await fetch('/api/chats/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar_url:c.characters[c.characterId].avatar,file_name:c.characters[c.characterId].chat,ch_name:c.name2})});const a=await r.json();return a[0].chat_metadata.variables.诸天系统.聊天群}""")
def toast(): return hub("const t=sr.getElementById('zt-hub-toast');return t&&!t.hidden?t.textContent:''")
def send_group(text, wait=3500):
    hub(f"const i=el.querySelector('#zt-g-input');i.value={json.dumps(text)};"); return click('[data-g=send]', wait)
def send_main(text):
    n = js("SillyTavern.getContext().chat.length")
    page.locator('#send_textarea').fill(text); page.locator('#send_but').click()
    page.wait_for_function(f"SillyTavern.getContext().chat.length>={n + 2}", timeout=60000)
    page.wait_for_function("getComputedStyle(document.querySelector('#mes_stop')).display==='none'", timeout=60000)
    page.wait_for_timeout(2500)
def on_dialog(d):
    dialogs.append(d.message); d.accept()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox']); ctx = browser.new_context(viewport={'width': 1280, 'height': 860})
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', on_dialog)
    Z.boot(page); Z.setup_chat(page); page.wait_for_timeout(1500)
    ok('main API connected to mock', Z.connect_main_api(page) not in (None, 'no_connection'))
    js("""async(url)=>{const a=__zhutianApp;const api=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/api-center.js');
      await api.saveConfigs(a.bridge,'诸天记忆助手_v1',{url,key:'qa-key-not-real',model:'mock-zt'});a.settings.patch('fx',{mode:'off',outside:false});
      await a.bridge.updateVariablesWith(v=>{const z=v.诸天系统;z.系统点=500000;z.聊天群={成员:[{id:'m1',名称:'白浅',世界:'青丘',档:4,性格:'清冷',特产:'桃花酿',好感:20},{id:'m2',名称:'陆千帆',世界:'天机阁',档:2,性格:'缜密',特产:'算筹',好感:20}]};return v;},{type:'chat',verify:true});}""", args.mock)
    ver = js("(async()=>(await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/contracts.js')).VERSION)()")
    ok('version ≥ 1.1.4 loaded', tuple(map(int, str(ver).split('.'))) >= (1, 1, 4), ver)
    hub("h.open('ov');await new Promise(r=>setTimeout(r,400));h.go('group');await new Promise(r=>setTimeout(r,500))")

    # ---------- 群聊生成 settings ----------
    click('[data-gtab="admin"]', 500)
    card = hub("return [...el.querySelectorAll('[data-g-set]')].map(s=>[s.dataset.gSet,s.value,s.options.length])")
    ok('群务 → 群聊生成 has the five settings with 1.1.3 defaults', [c[0] for c in card] == ['发言下限', '发言上限', '单条字数', '上下文', '输出上限'] and [c[1] for c in card] == ['1', '6', '300', '16', '0'], card)
    hub("const s=el.querySelector('[data-g-set=发言下限]');s.value='8';s.dispatchEvent(new Event('change',{bubbles:true}))"); page.wait_for_timeout(1200)
    st = grp().get('设置', {})
    ok('下限 8 > 上限 6 pulls 上限 along (saved to the ledger)', st.get('发言下限') == 8 and st.get('发言上限') == 8, st)
    hub("const s=el.querySelector('[data-g-set=发言下限]');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}))"); page.wait_for_timeout(1000)
    hub("const s=el.querySelector('[data-g-set=发言上限]');s.value='6';s.dispatchEvent(new Event('change',{bubbles:true}))"); page.wait_for_timeout(1000)
    hub("const s=el.querySelector('[data-g-set=输出上限]');s.value='3000';s.dispatchEvent(new Event('change',{bubbles:true}))"); page.wait_for_timeout(1000)
    page.screenshot(path=str(out / 'v114-group-settings.png'))
    click('[data-gtab="chat"]', 500)

    # ---------- send + 重roll ----------
    log0 = len(Path('/var/tmp/qa/mock.jsonl').read_text('utf8').splitlines()) if Path('/var/tmp/qa/mock.jsonl').exists() else 0
    send_group('大家好【1.1.4】')
    t1 = texts(); ok('a round arrives (numbered mock answer)', len(t1) == 3 and t1[0] == '大家好【1.1.4】' and '回复' in t1[1], t1)
    reqs = [json.loads(l) for l in Path('/var/tmp/qa/mock.jsonl').read_text('utf8').splitlines()[log0:]]
    gr = [r for r in reqs if '你是诸天万界聊天群。' in json.dumps(r['body'], ensure_ascii=False)]
    ok('the group request uses the chosen output limit (3000) and the 1–6 / 300-char prompt', bool(gr) and gr[-1]['body'].get('max_tokens') == 3000 and '选 1–6 位' in gr[-1]['body']['messages'][0]['content'] and '不超过 300 字' in gr[-1]['body']['messages'][0]['content'], gr[-1]['body'].get('max_tokens') if gr else None)
    ok('one round record', len(grp().get('轮次', [])) == 1 and grp()['轮次'][0]['user'] == '大家好【1.1.4】')
    dialogs.clear(); r = click('[data-g=reroll]', 3500)
    t2 = texts()
    ok('↻ 重roll asks first, then replaces the members\' lines; your message stays', r == 'ok' and dialogs and '重新生成最近一轮' in dialogs[0] and t2[0] == '大家好【1.1.4】' and len(t2) == 3 and t2[1] != t1[1] and '回复' in t2[1], [dialogs[:1], t1, t2])
    dg = disk_group(); ok('re-rolled round saved to disk', [m['text'] for m in dg['消息']] == t2 and len(dg['轮次']) == 1)
    page.screenshot(path=str(out / 'v114-group-reroll.png'))

    # ---------- 重roll blocked after a claimed gift ----------
    js("""async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const g=v.诸天系统.聊天群,r=g.轮次.at(-1);const id='gf_qa';g.消息.push({id:'g_qa',t:Date.now(),from:'m1',text:'送你',kind:'gift',gift:id,label:'桃花酿（凡品）'});r.msgs.push('g_qa');r.gifts.push(id);g.待领取.push({id,from:'m1',名称:'白浅',世界:'青丘',item:{名称:'桃花酿',品级:'凡品',分类:'消耗品',效果:'安神',价格:100},t:Date.now()});g.rev=(g.rev||0)+1;return v;},{type:'chat',verify:true});__zhutianApp.group.paint(true);}""")
    page.wait_for_timeout(600); click('[data-claim="gf_qa"]', 1500)
    bag = [i for i in js("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.背包||[]") if i.get('名称') == '桃花酿']
    ok('gift claimed into the bag', len(bag) == 1, bag)
    before = texts(); dialogs.clear(); click('[data-g=reroll]', 1500)
    ok('after claiming a gift the round can NOT be re-rolled (reason shown, nothing changed)', texts() == before and '赠礼你已经领取' in toast() and not dialogs, toast())

    # ---------- 🗑 管理 ----------
    click('[data-g=manage]', 500)
    n_del = hub("return el.querySelectorAll('[data-gdel]').length")
    ok('🗑 管理 shows a delete button on every message', n_del == len(texts()), [n_del, len(texts())])
    page.screenshot(path=str(out / 'v114-group-manage.png'))
    before = texts(); click('[data-gdel="g_qa"]', 1200)
    ok('a claimed gift\'s message can not be deleted', texts() == before and '已经领取入库' in toast(), toast())
    first_member = grp()['消息'][1]['id']; click(f'[data-gdel="{first_member}"]', 1200)
    ok('an ordinary message is deleted', len(texts()) == len(before) - 1 and t2[1] not in texts(), texts())
    click('[data-g=manage]', 400)
    ok('✓ 完成 hides the delete buttons again', hub("return el.querySelectorAll('[data-gdel]').length") == 0)

    # ---------- 截断 ----------
    send_group('继续【1.1.4截断】', 4000)
    t3 = texts()
    ok('a cut reply: the half line is dropped and a notice offers 重roll', '说到一半就被' not in ''.join(t3) and any('完整的一句' in t for t in t3) and '截断' in t3[-1], t3[-3:])
    ok('the round is marked cut', grp()['轮次'][-1]['cut'] is True)

    # ---------- 核对并解冻 ----------
    js("""()=>{const a=__zhutianApp;a.adapter.transactions.uncertain.add(a.adapter.currentIdentity());}""")
    frozen = js("""async()=>{try{await __zhutianApp.bridge.updateVariablesWith(v=>v,{type:'chat',verify:true});return 'written'}catch(e){return e.message}}""")
    ok('a frozen chat refuses writes and points to the new button', '核对并解冻账本' in frozen, frozen)
    hub("h.go('set');await new Promise(r=>setTimeout(r,700))")
    btn = js("""()=>{const sr=__zhutianApp.hub.shadow;const b=sr.querySelector('[data-act=unfreeze]');if(!b)return 'missing';b.closest('details')&&(b.closest('details').open=true);b.click();return 'ok'}""")
    page.wait_for_timeout(2000)
    ok('设置 → 诊断与维护 →「核对并解冻账本」: identical server copy → unfrozen without reload', btn == 'ok' and js("__zhutianApp.adapter.transactions.uncertain.size") == 0, btn)
    ok('writes work again', js("""async()=>{try{await __zhutianApp.bridge.updateVariablesWith(v=>v,{type:'chat',verify:true});return 'ok'}catch(e){return e.message}}""") == 'ok')

    # ---------- 思维链保护 (real generation through SillyTavern) ----------
    js("__zhutianApp.hub.close?.()"); page.wait_for_timeout(500)
    # same starting balance as the fixture floors (1200), like tests/native_v111.py
    js("async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{v.诸天系统.系统点=1200;return v;},{type:'chat',verify:true});}"); page.wait_for_timeout(800)
    send_main('今天先修炼到这里【1.1.4思维链】')
    m = js("()=>{const m=SillyTavern.getContext().chat.at(-1);return {mes:m.mes,rs:m.extra?.reasoning||'',bk:!!m.extra?.zhutianCovenantTerminal?.panelRepair}}")
    kept = ('<think>\n先打个草稿：＜ZhuTianPanel＞\n系统点: 草稿\n莉莉丝：这句只是草稿\n</think>\n夜色渐深' in m['mes']) or ('草稿' in m['rs'] and '<think>' not in m['mes'])
    ok('the reasoning keeps its tags and text; only the draft block tag in it is made inert (original backed up)', kept and (m['bk'] or '<think>' not in m['mes']), m['mes'][:220])
    ok('the real data block is booked', js("__zhutianApp.adapter.ledger().系统点") == 1400, js("__zhutianApp.adapter.ledger().系统点"))
    vc = js("()=>{const el=document.querySelector('#chat .mes:last-child .mes_text');return {cards:el.querySelectorAll('.zt-lilith-voice,[data-lilith-voice]').length,text:el.innerText}}")
    ok('voice box: only the story line becomes a card (not the draft inside the reasoning)', vc['cards'] == 1, vc)
    page.screenshot(path=str(out / 'v114-cot-floor.png'))
    lp = js("()=>{const p=SillyTavern.getContext().extensionPrompts['zhutian-covenant-terminal/panelguard'];return p?{d:p.depth,v:p.value}:null}")
    ok('format reminder at depth 1, no "思考过程" wording', lp and lp['d'] == 1 and '思考过程' not in lp['v'], lp)

    # ---------- 楼层检查 ----------
    dialogs.clear()
    js("()=>__zhutianApp.hub.open('set')"); page.wait_for_timeout(1200)
    has = js("()=>!!__zhutianApp.hub.shadow.querySelector('[data-act=pg-inspect]')")
    ok('「检查最新楼层」button is on the settings page (诊断与维护)', has, js("()=>[...__zhutianApp.hub.shadow.querySelectorAll('[data-act]')].map(b=>b.dataset.act).join(',')"))
    if has: js("()=>{const b=__zhutianApp.hub.shadow.querySelector('[data-act=pg-inspect]');const d=b.closest('details');if(d)d.open=true;b.click();}")
    else: js("()=>__zhutianApp.panelGuard.inspect()")
    page.wait_for_timeout(1200)
    rep = dialogs[-1] if dialogs else ''
    ok('「检查最新楼层」reports rewrite / render / reasoning / every live prompt', '楼层检查' in rep and '思维链里的数据块草稿已停用' in rep and '正文里 1 段' in rep and '由插件渲染' in rep and '[诸天] zhutian-covenant-terminal/panelguard — 聊天中 深度 1' in rep, rep[:600])
    (out / 'v114-floor-report.txt').write_text(rep, 'utf8')

    # ---------- 说明书 ----------
    js("()=>__zhutianApp.hub.open('man')"); page.wait_for_timeout(1800)
    man = js("""()=>{const sr=__zhutianApp.hub.shadow,el=sr.getElementById('page-man');return {nav:!!sr.querySelector('.nav-button[data-page=man]'),toc:el.querySelectorAll('.zt-man-toc li').length,secs:el.querySelectorAll('.zt-man-sec').length,text:el.textContent.length}}""")
    ok('终端 → 说明书 loads docs/MANUAL.md with a table of contents', man['nav'] and man['toc'] >= 15 and man['text'] > 10000, man)
    js("()=>{const el=__zhutianApp.hub.shadow.getElementById('page-man');const q=el.querySelector('.zt-man-q');q.value='核对并解冻';q.dispatchEvent(new Event('input'));}"); page.wait_for_timeout(400)
    srch = js("()=>{const el=__zhutianApp.hub.shadow.getElementById('page-man');return {shown:[...el.querySelectorAll('.zt-man-sec')].filter(s=>!s.hidden).length,hit:el.querySelector('.zt-man-hit').textContent}}")
    ok('说明书 search narrows the chapters', 0 < srch['shown'] < man['secs'] and '章相关' in srch['hit'], srch)
    js("()=>{const el=__zhutianApp.hub.shadow.getElementById('page-man');const q=el.querySelector('.zt-man-q');q.value='';q.dispatchEvent(new Event('input'));el.querySelector('.zt-man-toc a[data-anchor]:nth-child(1)')}"); page.wait_for_timeout(300)
    page.screenshot(path=str(out / 'v114-manual.png'))
    ok('no page errors', not errors, errors[:3])
    browser.close()
(out / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1), 'utf8')
print(f"{sum(r['pass'] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r['pass'] for r in results) else 1)
