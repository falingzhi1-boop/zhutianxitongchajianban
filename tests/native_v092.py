"""0.9.2 acceptance — the two bugs from the first real-phone session (isolated SillyTavern + mock model only):
  1. the 【莉莉丝】 line showed twice (raw paragraph + voice card), one card ended up under the character card's status bar
  2. raw data-block lines (系统点: … / 好感度: …) showed in the floor although the floor tag was there
Reproduced here exactly the way they happen on the phone:
  A. a keyword highlighter (dotted underline under terms) that edits every paragraph of a floor as soon as SillyTavern
     draws it — BEFORE the plugin's floor pass
  B. a variable extension (MVU-style) that appends <UpdateVariable> to the message after SillyTavern drew it, without a
     redraw (the floor on screen is older than chat[id].mes)
  C. a character-card front-end status bar (code block → iframe, Tavern Helper / 小白X style) whose code contains a
     莉莉丝：… line
  plus: the 0.8.4 beautifier cases still hold (in-place edit after our pass kept; iframe card kept, not reloaded).
Usage: python3 tests/native_v092.py --isolated-test-only --base-url http://127.0.0.1:8019
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
ap.add_argument('--shots', default='/var/tmp/qa/shots092')
args = ap.parse_args()
Z.configure(args.base_url, args.mock, args.shots)
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=False)

# A: keyword highlighter, synchronous on the render events (runs before the plugin's pass, which waits ≥ 30 ms)
HIGHLIGHT = r'''(()=>{if(window.__qaHL)return;window.__qaHL=true;const c=SillyTavern.getContext();
  const run=id=>{const t=document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);if(!t)return;
    const w=document.createTreeWalker(t,NodeFilter.SHOW_TEXT),hits=[];while(w.nextNode()){const n=w.currentNode;if(n.parentElement.closest('.qa-hl,iframe,pre,code,.zt-lilith-voice,.zt-floor-tag'))continue;if(/少主|灵根|元婴期/.test(n.nodeValue))hits.push(n);}
    for(const n of hits){const f=document.createDocumentFragment();for(const part of n.nodeValue.split(/(少主|灵根|元婴期)/)){if(!part)continue;if(/^(少主|灵根|元婴期)$/.test(part)){const s=document.createElement('span');s.className='qa-hl';s.style.cssText='text-decoration:underline dotted #c9a';s.textContent=part;f.append(s);}else f.append(part);}n.replaceWith(f);}};
  for(const k of ['CHARACTER_MESSAGE_RENDERED','MESSAGE_UPDATED','MESSAGE_SWIPED'])c.eventSource.on(c.eventTypes[k],id=>run(id));window.__qaHLrun=run;})()'''
# C: front-end card renderer — replaces a code block that contains QA-FRONT with a wrapper + iframe
FRONT = r'''(()=>{if(window.__qaFront)return;window.__qaFront=true;const c=SillyTavern.getContext();
  const run=id=>{const t=document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);if(!t)return;for(const pre of t.querySelectorAll('pre')){if(!/QA-FRONT/.test(pre.textContent))continue;
    const w=document.createElement('div');w.className='qa-front-render';const f=document.createElement('iframe');f.srcdoc='<body style="margin:0;background:#123;color:#fff">当前所在 · 储物袋</body>';f.style.cssText='width:100%;height:60px;border:0';w.append(f);pre.replaceWith(w);}};
  for(const k of ['CHARACTER_MESSAGE_RENDERED','MESSAGE_UPDATED'])c.eventSource.on(c.eventTypes[k],id=>run(id));window.__qaFrontRun=run;})()'''

PUSH = '''async ([mes,after])=>{const c=SillyTavern.getContext();const m={name:c.name2,is_user:false,is_system:false,send_date:new Date().toISOString(),mes,extra:{},swipe_id:0,swipes:[mes]};
  c.chat.push(m);c.addOneMessage(m);if(after){m.mes+=after;m.swipes[0]=m.mes;}
  await c.eventSource.emit(c.eventTypes.CHARACTER_MESSAGE_RENDERED,c.chat.length-1,'normal');await c.saveChat();return c.chat.length-1;}'''
PROBE = '''id=>{const t=document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);const vis=n=>!!n.getClientRects().length;
  const outside=re=>{let n=0;const w=document.createTreeWalker(t,NodeFilter.SHOW_TEXT);while(w.nextNode()){const x=w.currentNode;if(x.parentElement.closest('.zt-lilith-voice,[data-lilith-voice],.zt-floor-tag-box,.zhutian-statusbar,iframe,pre,code'))continue;if(re.test(x.nodeValue)&&vis(x.parentElement))n++;}return n;};
  const kids=[...t.children].filter(vis);const idx=sel=>kids.findIndex(n=>n.matches(sel)||n.querySelector(sel));
  return {cards:t.querySelectorAll('.zt-lilith-voice').length,cardTexts:[...t.querySelectorAll('.zt-lilith-voice [data-lilith-text]')].map(x=>x.textContent.slice(0,14)),
    rawVoice:outside(/【莉莉丝】|莉莉丝：/),rawPanel:outside(/系统点[:：]\\s*\\d|好感度[:：]|当前任务[:：]/),rawUpdate:outside(/UpdateVariable|_\\.set/),
    tag:t.querySelectorAll('.zt-floor-tag').length,hl:t.querySelectorAll('.qa-hl').length,front:t.querySelectorAll('.qa-front-render').length,
    frontPre:[...t.querySelectorAll('pre')].filter(p=>/QA-FRONT/.test(p.textContent)).length,ours:!!t.querySelector(':scope > .zt-render-mark'),
    order:{voice:idx('.zt-lilith-voice'),front:idx('.qa-front-render'),tag:idx('.zt-floor-tag'),after:kids.findIndex(n=>/云灵靠坐在床头/.test(n.textContent)&&!n.closest('.zt-lilith-voice'))}}}'''

ORDER = '''id=>{const t=document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);return [...t.children].filter(n=>n.getClientRects().length).map(n=>n.matches('.zt-lilith-voice')?'voice:'+n.querySelector('[data-lilith-text]').textContent.slice(0,2):n.matches('div.TH-render,.qa-front-render')||n.querySelector('div.TH-render,.qa-front-render')?'TH':n.querySelector('.zt-floor-tag')?'tag':'p:'+n.textContent.trim().slice(0,3))}'''

def push(page, mes, after=''):
    i = page.evaluate(PUSH, [mes, after]); page.wait_for_timeout(1800); return i

VOICE = '【莉莉丝】："主人，痴傻十八年的少主一夜痊愈，接下来还有什么，比当众重验灵根更打脸的？"'
STORY = lambda tag: f'{tag} 小蝶捧着茶壶愣了愣，少主醒了。\n\n{VOICE}\n\n云灵靠坐在床头，望着窗外的灯笼。\n\n'
PANEL = '<ZhuTianPanel>\n系统点: 6600\n子系统: 0\n好感度: 0\n当前任务: 一鸣惊人\n</ZhuTianPanel>'

def suite(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, user_agent=ANDROID_UA)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300])); page.on('dialog', lambda d: d.accept())
    Z.boot(page); Z.setup_chat(page)
    page.evaluate("()=>{const a=__zhutianApp;a.settings.set('statusbar','auto');a.settings.set('voiceBox',true);a.settings.set('floorTag',true);}")
    page.evaluate(HIGHLIGHT); page.evaluate(FRONT)

    # A — highlighter edits the voice paragraph before the plugin's pass
    a_id = push(page, STORY('A') + PANEL)
    a = page.evaluate(PROBE, a_id); print('   A', json.dumps(a, ensure_ascii=False))
    ok('A: highlighted 【莉莉丝】 line is shown ONCE, as the voice card (no raw paragraph left)', a['cards'] == 1 and a['rawVoice'] == 0, json.dumps(a, ensure_ascii=False))
    ok('A: no raw data-block lines; one floor tag', a['rawPanel'] == 0 and a['tag'] == 1, json.dumps(a, ensure_ascii=False))
    ok('A: the card stands where the line was (before the next paragraph, before the tag)', -1 < a['order']['voice'] < a['order']['after'] < a['order']['tag'], json.dumps(a['order']))
    ok('A: the highlighter still works on the rest of the floor', a['hl'] >= 1, a['hl'])
    shot(page, 'v092-A-highlighter')

    # B — the floor on screen is older than the message (MVU-style append without a redraw)
    b_id = push(page, STORY('B') + PANEL, "\n<UpdateVariable>\n_.set('诸天系统.系统点', 6600, 6600);\n</UpdateVariable>")
    b = page.evaluate(PROBE, b_id); print('   B', json.dumps(b, ensure_ascii=False))
    ok('B: message changed after drawing — 【莉莉丝】 once (card only)', b['cards'] == 1 and b['rawVoice'] == 0, json.dumps(b, ensure_ascii=False))
    ok('B: …and no raw 系统点 / 好感度 lines next to the floor tag', b['rawPanel'] == 0 and b['tag'] == 1, json.dumps(b, ensure_ascii=False))

    # C — character-card front-end status bar (code block → iframe) with a 莉莉丝：line in its code, and a real voice line after it
    code = '```html\n<div class="QA-FRONT">当前所在 · 储物袋 莉莉丝：在代码里</div>\n```'
    c_id = push(page, f'C 夜深了，少主回到房中。\n\n{code}\n\n莉莉丝：“遵命，我的主人。明日零点签到刷新。”\n\n' + PANEL)
    c = page.evaluate(PROBE, c_id); print('   C', json.dumps(c, ensure_ascii=False))
    ok('C: the front-end card is kept (one, raw code block gone)', c['front'] == 1 and c['frontPre'] == 0, json.dumps(c, ensure_ascii=False))
    ok('C: a 莉莉丝：line INSIDE the card\'s code is left to the card (only the real line becomes a voice card)', c['cards'] == 1 and c['cardTexts'] and c['cardTexts'][0].startswith('遵命'), json.dumps(c['cardTexts'], ensure_ascii=False))
    ok('C: order = front-end card, voice card, floor tag', -1 < c['order']['front'] < c['order']['voice'] < c['order']['tag'], json.dumps(c['order']))
    shot(page, 'v092-C-frontend')

    # E — the phone's "card under the status bar": voice line BEFORE a front-end card (code block → iframe), another after it
    e_id = push(page, f'E 少主回到房中。\n\n{VOICE}\n\n' + code.replace('莉莉丝：在代码里', '') + '\n\n莉莉丝：“遵命，我的主人。”\n\n' + PANEL)
    e = page.evaluate(ORDER, e_id)
    ok('E: order kept — text, voice「主人」, front-end card, voice「遵命」, floor tag (0.9.1 put the card above the first voice)', e == ['p:E 少', 'voice:主人', 'TH', 'voice:遵命', 'tag'], json.dumps(e, ensure_ascii=False))
    page.evaluate("async()=>{__zhutianApp.statusbar.rebuild();await new Promise(r=>setTimeout(r,1500));}")
    ok('E: …and still after a plugin re-render (iframe card not duplicated)', page.evaluate(ORDER, e_id) == e, json.dumps(page.evaluate(ORDER, e_id), ensure_ascii=False))

    # D — with the REAL Tavern Helper (when installed): its own front-end status bar iframe + voice line + data block + highlighter
    if page.evaluate('!!globalThis.TavernHelper'):
        sb = '```html\n<!DOCTYPE html><html><body style="margin:0;background:#123;color:#fff"><div style="padding:10px">当前所在 · 天机推演 · 储物袋</div><script>document.body.dataset.ok=1</script></body></html>\n```'
        d_id = push(page, f'D 少主回到房中。\n\n{VOICE}\n\n{sb}\n\n莉莉丝：“遵命，我的主人。”\n\n' + PANEL)
        page.wait_for_timeout(2500)
        d = page.evaluate(PROBE.replace("front:t.querySelectorAll('.qa-front-render').length", "front:t.querySelectorAll('div.TH-render iframe').length"), d_id); print('   D', json.dumps(d, ensure_ascii=False))
        ok('D (real Tavern Helper 4.x): its status bar iframe renders; 【莉莉丝】 lines once each (2 cards); no raw data lines', d['front'] == 1 and d['cards'] == 2 and d['rawVoice'] == 0 and d['rawPanel'] == 0 and d['tag'] == 1, json.dumps(d, ensure_ascii=False))
        o = page.evaluate(ORDER, d_id)
        ok('D: the order of the message is kept — text, voice「主人」, Tavern Helper status bar, voice「遵命」, floor tag', o == ['p:D 少', 'voice:主人', 'TH', 'voice:遵命', 'tag'], json.dumps(o, ensure_ascii=False))
        page.evaluate("async()=>{__zhutianApp.statusbar.rebuild();await new Promise(r=>setTimeout(r,1500));}")
        o2 = page.evaluate(ORDER, d_id)
        ok('D: …and still after a plugin re-render', o2 == o, json.dumps(o2, ensure_ascii=False))
        shot(page, 'v092-D-tavern-helper')
    else: print('SKIP D real Tavern Helper — not installed in this host', flush=True)

    # re-render everything (settings change / chat reload path): still nothing doubled
    page.evaluate("async()=>{__zhutianApp.statusbar.rebuild();await new Promise(r=>setTimeout(r,1500));}")
    again = [page.evaluate(PROBE, i) for i in (a_id, b_id, c_id)]
    ok('plugin re-render: still one card per floor, no raw voice / data lines, iframe card kept', all(x['cards'] == 1 and x['rawVoice'] == 0 and x['rawPanel'] == 0 for x in again) and again[2]['front'] == 1, json.dumps([[x['cards'], x['rawVoice'], x['rawPanel'], x['front']] for x in again]))
    # SillyTavern redraws every floor; the two other extensions react to the redraw like they do in real installs
    page.evaluate("async ids=>{await SillyTavern.getContext().reloadCurrentChat();for(const i of ids){__qaHLrun(i);__qaFrontRun(i);}await new Promise(r=>setTimeout(r,2500));}", [a_id, b_id, c_id])
    page.wait_for_timeout(1000)
    rel = [page.evaluate(PROBE, i) for i in (a_id, b_id, c_id)]
    ok('chat reload (SillyTavern redraws, highlighter + front-end renderer run again): same result', all(x['cards'] == 1 and x['rawVoice'] == 0 and x['rawPanel'] == 0 and x['tag'] == 1 for x in rel) and rel[2]['front'] == 1 and rel[2]['frontPre'] == 0, json.dumps([[x['cards'], x['rawVoice'], x['rawPanel'], x['hl'], x['front']] for x in rel]))
    ok('no page errors', not errs, '; '.join(errs)[:300])
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    try: suite(browser)
    except Exception as e: ok('suite ran without exceptions', False, str(e)[:500])
    browser.close()
passed = sum(1 for _, c, _ in results if c)
print(f'\n{passed}/{len(results)} passed')
sys.exit(0 if passed == len(results) else 1)
