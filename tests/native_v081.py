"""0.8.1 acceptance (isolated SillyTavern + mock models only):
- 莉莉丝 连接页「拉取模型」against a provider that sends NO CORS headers (browser blocked → relayed by the ST server);
- 聊天群: random recruits really differ, target tier follows the budget, entry fee curve, unaffordable candidate refused;
- 红包 rhythm enforced in the ledger (a greedy model is ignored until due; the host asking overrides);
- what came through the group is injected into the story prompt with its source;
- worldbook: update an old copy (backup + merge) and export JSON.
Usage: python3 tests/native_v081.py --isolated-test-only --base-url http://127.0.0.1:8016 --nocors http://127.0.0.1:5002/v1
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
ap.add_argument('--nocors', default='http://127.0.0.1:5002/v1', help='mock started with --no-cors')
ap.add_argument('--shots', default='/var/tmp/qa/shots081')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def mock_requests():
    try: return [json.loads(l) for l in open(args.mock_log, encoding='utf8') if l.strip()]
    except FileNotFoundError: return []
def body_text(req): return '\n'.join(str(m.get('content')) for m in req['body'].get('messages', []))
def fired(phrase, before): return [r for r in mock_requests()[before:] if phrase in body_text(r)]
def z(page): return page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
def grp(page): return z(page).get('聊天群') or {}
def hub(page, js): return page.evaluate(f"(async()=>{{const app=__zhutianApp,h=app.hub,sr=h.shadow,G=app.group,el=sr.getElementById('page-group');{js}}})()")
def click(page, sel, wait=900):
    r = hub(page, f"const b=el.querySelector({json.dumps(sel)});if(!b)return 'missing';if(b.disabled)return 'disabled';b.click();return 'ok'"); page.wait_for_timeout(wait); return r
def fill(page, sel, val):
    hub(page, f"const i=el.querySelector({json.dumps(sel)});i.value={json.dumps(val)};i.dispatchEvent(new Event('input',{{bubbles:true}}));i.dispatchEvent(new Event('change',{{bubbles:true}}))")
def toast(page): return hub(page, "return sr.getElementById('zt-hub-toast')?.hidden===false?sr.getElementById('zt-hub-toast').textContent:''")
def commit(page, body):
    return hub(page, "const L=await import(app.base+'src/ledger-ops.js');await L.commit(app.bridge,(v,z)=>{" + body + "},z=>[JSON.stringify(z).length]);return 1")
def gprompt(page): return page.evaluate("SillyTavern.getContext().extensionPrompts['zhutian-covenant-terminal/group']||{}")
def send(page, text, wait=3000):
    fill(page, '#zt-g-input', text); click(page, '[data-g=send]', wait)

def setup(page):
    page.evaluate("""async()=>{const s=__zhutianApp.settings;s.set('statusbar','terminal');s.set('hubOutsideClose','auto');
      const m=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/api-center.js');
      await m.saveConfigs(__zhutianApp.bridge,'诸天记忆助手_v1',{url:'""" + args.mock + """',key:'qa-key-not-real',model:'mock-zt',maxTokens:1500});}""")
    Z.setup_chat(page)
    page.evaluate("""async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const z=v.诸天系统;z.系统点=600;z.累计消费=0;delete z.聊天群;return v;},{type:'chat'});}""")
    hub(page, "h.open('ov');await new Promise(r=>setTimeout(r,500));sr.getElementById('reset-window')?.click();await new Promise(r=>setTimeout(r,300))")

def api_phase(page):
    hub(page, "h.go('api');await new Promise(r=>setTimeout(r,500))")
    direct = page.evaluate(f"fetch({json.dumps(args.nocors + '/models')}).then(()=> 'reachable').catch(()=> 'blocked')")
    ok('precondition: the no-CORS provider is blocked for direct browser fetch', direct == 'blocked', direct)
    hub(page, f"""const set=(id,v)=>{{const i=sr.getElementById(id);i.value=v;i.dispatchEvent(new Event('input',{{bubbles:true}}));i.dispatchEvent(new Event('change',{{bubbles:true}}))}};
      set('url',{json.dumps(args.nocors)});set('key','qa-key-not-real');sr.getElementById('wb-models').click()""")
    page.wait_for_function("(()=>{const sr=__zhutianApp.hub.shadow;const t=sr.getElementById('api-feedback')?.textContent||'';return !/正在/.test(t)&&t.length>0})()", timeout=30000)
    fb = hub(page, "return sr.getElementById('api-feedback').textContent")
    opts = hub(page, "return [...sr.querySelectorAll('#api-model-select option')].map(o=>o.value).filter(Boolean)")
    ok('莉莉丝 连接页 拉取模型 works when the provider blocks CORS (relayed by the ST server)', 'mock-zt' in opts and 'CORS' not in fb, f'{fb[:80]} | {opts}')
    page.screenshot(path=str(SHOTS / 'v081-api.png'))

def recruit_phase(page):
    hub(page, "h.go('group');await new Promise(r=>setTimeout(r,500))")
    click(page, '[data-gtab="members"]', 400)
    before = len(mock_requests()); p0 = z(page)['系统点']
    click(page, '[data-g=recruit]', 3500)
    reqs = fired('你是诸天万界聊天群的招募系统。', before); c = grp(page).get('候选') or {}
    t0 = body_text(reqs[0]) if reqs else ''
    ok('招募令 100 points; random recruit asks for the tier the host can pay (500 pts → 档 1)', p0 - z(page)['系统点'] == 100 and '必须是 1' in t0 and '入群费 300' in t0, t0[-260:])
    ok('model ignored the tier → one corrective retry, candidate flagged 超预算', len(reqs) == 2 and '超出了要求' in body_text(reqs[1]) and c.get('超预算') is True, f"{len(reqs)} {c}")
    r = click(page, '[data-g=invite]', 900); g = grp(page)
    ok('unaffordable candidate is refused (no negative balance, nobody joins)', not g.get('成员') and z(page)['系统点'] == 500 and '入群费' in toast(page), f"{z(page)['系统点']} | {toast(page)}")
    warn = hub(page, "return el.querySelector('.zt-g-warn')?.textContent||''")
    ok('candidate card says 系统点不足 and that the next recruit changes the person', '系统点不足' in warn and '换一个人' in warn, warn)
    click(page, '[data-g=drop-cand]', 600)
    before = len(mock_requests()); click(page, '[data-g=recruit]', 3500)
    reqs = fired('你是诸天万界聊天群的招募系统。', before); c = grp(page).get('候选') or {}
    ok('next recruit excludes the previous candidate → a different person', reqs and '【不要选】叶清寒' in body_text(reqs[0]) and c.get('名称') == '苏小蛮', f"{c.get('名称')} | {body_text(reqs[0])[:120] if reqs else ''}")
    p0 = z(page)['系统点']; click(page, '[data-g=invite]', 1000)
    ok('入群费 by the new curve (凡人顶尖 = 300)', p0 - z(page)['系统点'] == 300 and [m['名称'] for m in grp(page)['成员']] == ['苏小蛮'], f"{p0}->{z(page)['系统点']}")
    # recruiting again while a candidate is shown also puts that candidate on the do-not-repeat list
    commit(page, "z.系统点=5000;")
    click(page, '[data-g=recruit]', 3500); first = (grp(page).get('候选') or {}).get('名称')
    before = len(mock_requests()); click(page, '[data-g=recruit]', 3500); second = (grp(page).get('候选') or {}).get('名称')
    ok('recruit → recruit again: never the same person twice in a row', first and second and first != second and first in grp(page).get('候选历史', []), f'{first} → {second}')
    click(page, '[data-g=invite]', 1000)
    page.screenshot(path=str(SHOTS / 'v081-members.png'))

def rhythm_phase(page):
    hub(page, "await G.saveMeta({公告:'【测试】贪心'})")
    commit(page, "z.聊天群.节奏={距上次:99,间隔:3};z.聊天群.日计={day:new Date().toLocaleDateString('sv-SE'),收:0,发:0};")
    click(page, '[data-gtab="chat"]', 400)
    counts = []
    for i in range(3):
        before = len(mock_requests()); send(page, f'大家好呀 {i}')
        req = fired('你是诸天万界聊天群。', before); counts.append((len(grp(page)['红包']), '本轮【禁止】' in (body_text(req[0]) if req else '')))
    ok('greedy model: 1st round packet booked, next two rounds forbidden in the prompt AND dropped by the ledger', counts[0][0] == 1 and counts[1] == (1, True) and counts[2] == (1, True), str(counts))
    commit(page, "z.聊天群.节奏={距上次:0,间隔:4};")
    send(page, '谁给我发红包')
    ok('host asks for a red packet → allowed despite the rhythm', len(grp(page)['红包']) == 2, str(len(grp(page)['红包'])))
    ok('rhythm resets to 3–4 rounds after a handout', grp(page)['节奏']['距上次'] == 0 and grp(page)['节奏']['间隔'] in (3, 4), str(grp(page)['节奏']))

def provenance_phase(page):
    pk = next(p for p in grp(page)['红包'].values() if not any(x['who'] == 'me' for x in p['grabs']))
    click(page, f'[data-grab="{pk["id"]}"]', 1200)
    rec = grp(page).get('入库记录') or []
    pr = gprompt(page)
    ok('grab is recorded in 入库记录 with source and kind', rec and rec[-1]['how'] == '红包' and '@' in rec[-1]['src'], str(rec[-1:]))
    ok('story prompt carries the real source (no other origin allowed), depth 2', '真实入库记录' in pr.get('value', '') and rec[-1]['src'] in pr.get('value', '') and '不得改写成' in pr.get('value', '') and pr.get('depth') == 2, f"{pr.get('depth')} {pr.get('value', '')[:160]}")

def worldbook_phase(page):
    r = page.evaluate("""async()=>{const app=__zhutianApp,c=SillyTavern.getContext(),f=app.features;
      const {buildWorldbook,WORLD_NAME}=await import(app.base+'src/features.js');
      const old=buildWorldbook(app.original.ZhuTianBuiltinRules);old.entries[35]={uid:35,comment:'我的自定义条目',content:'保留我',key:['x'],constant:false,disable:false};
      old.entries[4].disable=true;
      await c.saveWorldInfo(WORLD_NAME,old,true);
      const st0=await f.worldbookStatus();
      const res=await f.updateWorldbook();
      const now=await c.loadWorldInfo(WORLD_NAME),list=Object.values(now.entries);
      const bk=await c.loadWorldInfo(res.backup);
      return {st0:st0.current,res,count:list.length,hasGroup:list.some(e=>e.comment==='36｜联动｜诸天聊天群（插件）'),mine:list.some(e=>e.comment==='我的自定义条目'),
        e05:list.find(e=>e.comment==='05｜核心｜状态栏规则补充'),bk:Object.keys(bk?.entries||{}).length,st1:(await f.worldbookStatus()).current};}""")
    ok('old worldbook detected as not current', r['st0'] is False)
    ok('更新到最新版: backup book saved first (36 entries), built-ins replaced, 聊天群 entry added, my entry kept',
       r['bk'] == 36 and r['count'] == 37 and r['hasGroup'] and r['mine'] and r['res']['kept'] == 1, json.dumps({k: r[k] for k in ('bk', 'count', 'hasGroup', 'mine')}, ensure_ascii=False))
    ok('entry 05 now points to the settings admin console; my on/off choice kept', '管理员控制台」打开' in r['e05']['content'] and r['e05']['disable'] is True)
    ok('status says current after the update', r['st1'] is True)
    with page.expect_download(timeout=10000) as dl:
        page.evaluate("__zhutianApp.features.exportWorldbook()")
    d = dl.value; path = SHOTS / d.suggested_filename; d.save_as(str(path))
    book = json.loads(path.read_text(encoding='utf8'))
    ok('导出 JSON: SillyTavern world-info file with the 36 entries', len(book['entries']) == 36 and d.suggested_filename.endswith('.json'), d.suggested_filename)

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1400, 'height': 900}, accept_downloads=True); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    Z.boot(page); setup(page)
    for phase in (api_phase, recruit_phase, rhythm_phase, provenance_phase, worldbook_phase):
        try: phase(page)
        except Exception as e: ok(f'{phase.__name__} ran without exception', False, str(e)[:300]); page.screenshot(path=str(SHOTS / f'v081-crash-{phase.__name__}.png'))
    ok('no page errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
