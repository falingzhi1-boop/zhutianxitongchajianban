"""0.4.0 acceptance on an ISOLATED SillyTavern with a local mock model (never production data, never a real key).
Covers the v1.1 replacement: status bar live/compact floors, voice box toggle, macro-like, prompt strip,
API center (independent + main API), status-bar AI buttons, assistant, takeover/restore, touch gestures.
Usage: python3 tests/native_replace040.py --isolated-test-only --base-url http://127.0.0.1:8019 --mock http://127.0.0.1:5001/v1 --legacy-dir <旧版离线包-v1.1>
Setup: tests/qa/setup_isolated_st.py (throwaway host) + tests/qa/mock_model.py (mock model, logs to --mock-log).
"""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
import argparse, json, time, sys

ap = argparse.ArgumentParser()
ap.add_argument('--isolated-test-only', action='store_true', required=True)
ap.add_argument('--base-url', default='http://127.0.0.1:8019')
ap.add_argument('--mock', default='http://127.0.0.1:5001/v1')
ap.add_argument('--mock-log', default='/var/tmp/qa/mock.jsonl')
ap.add_argument('--phase', default='all')
ap.add_argument('--legacy-dir', default='/var/tmp/v11/zip', help='folder of the ORIGINAL v1.1 offline pack (旧版离线包-v1.1); not shipped in this repo')
ap.add_argument('--shots', default=str(Path(__file__).resolve().parents[1] / 'docs' / 'evidence'))
args = ap.parse_args()
SHOTS = Path(args.shots); SHOTS.mkdir(parents=True, exist_ok=True)
EXT = '/scripts/extensions/third-party/zhutianxitongchajianban'
CARD = '莉莉丝 · 诸天验收'
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def mock_requests():
    try: return [json.loads(l) for l in open(args.mock_log, encoding='utf8') if l.strip()]
    except FileNotFoundError: return []

def body_text(req):
    return '\n'.join(str(m.get('content') if isinstance(m.get('content'), str) else json.dumps(m.get('content'), ensure_ascii=False)) for m in req['body'].get('messages', []))

PANEL = lambda pts, favor, task: f'<ZhuTianPanel>\n系统点: {pts}\n好感度: {favor}\n当前任务: {task}\n任务进度: 30\n系统播报: 楼层测试\n</ZhuTianPanel>'

BOOTLOG = []
def boot(page):
    t0 = time.time()
    page.on('console', lambda m: BOOTLOG.append(f'{time.time()-t0:6.1f} {m.type}: {m.text[:240]}'))
    page.on('pageerror', lambda e: BOOTLOG.append(f'{time.time()-t0:6.1f} PAGEERR {str(e)[:300]}'))
    try: _boot(page)
    except Exception:
        state = page.evaluate("()=>({ready:(()=>{try{return SillyTavern.getContext().eventSource.autoFireLastArgs.has(SillyTavern.getContext().eventTypes.APP_READY)}catch{return 'n/a'}})(),popups:[...document.querySelectorAll('dialog[open]')].map(d=>d.innerText.slice(0,120)),app:!!globalThis.__zhutianApp})")
        print('BOOT FAILED', json.dumps(state, ensure_ascii=False))
        for l in BOOTLOG:
            if any(k in l for k in ('error', 'PAGEERR', '诸天', 'zhutian', 'Activat', 'hook', 'warn')): print('   ', l)
        page.screenshot(path=str(SHOTS / 'r040-boot-failed.png')); raise

def _boot(page):
    page.goto(args.base_url.rstrip('/') + '/')
    ready = "(()=>{try{return typeof SillyTavern!=='undefined' && SillyTavern.getContext().eventSource.autoFireLastArgs?.has?.(SillyTavern.getContext().eventTypes.APP_READY)}catch{return false}})()"
    # A fresh data dir shows the first-run welcome/persona dialog (button "Save"/OK) at an unpredictable moment; keep dismissing it.
    for _ in range(120):
        btn = page.locator('dialog.popup[open] .popup-button-ok:visible')
        if btn.count(): btn.first.click(); page.wait_for_timeout(600); continue
        if page.evaluate(ready) and not page.locator('dialog.popup[open]:visible').count(): break
        page.wait_for_timeout(500)
    page.wait_for_function(ready, timeout=90000)
    page.wait_for_function('!!globalThis.__zhutianApp', timeout=60000)

def connect_main_api(page):
    """Chat Completion → Custom (OpenAI-compatible) → mock, through the real ST connection UI."""
    page.evaluate('''async (url)=>{
      const $=window.jQuery; $('#main_api').val('openai').trigger('change');
      await new Promise(r=>setTimeout(r,300));
      $('#chat_completion_source').val('custom').trigger('change');
      await new Promise(r=>setTimeout(r,300));
      $('#custom_api_url_text').val(url).trigger('input');
      $('#custom_model_id').val('mock-zt').trigger('input');
      if($('#stream_toggle').length && !$('#stream_toggle').prop('checked')) $('#stream_toggle').prop('checked',true).trigger('change');
      // a normal long-context setup (64k): the default 8k test context cannot fit the 诸天 constant rules
      if($('#oai_max_context_unlocked').length && !$('#oai_max_context_unlocked').prop('checked')) $('#oai_max_context_unlocked').prop('checked',true).trigger('input').trigger('change');
      $('#openai_max_context').val(65536).trigger('input');
      $('#api_button_openai').trigger('click');
    }''', args.mock)
    page.wait_for_timeout(2500)
    return page.evaluate("SillyTavern.getContext().onlineStatus")

def setup_chat(page):
    page.evaluate('''async name=>{
      let c=SillyTavern.getContext(); if(!c.characters.some(x=>x.name===name)){
        const card={spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'隔离验收角色（非用户数据）。',personality:'',scenario:'诸天契约空间',first_mes:'【验收开场】契约已就绪。',mes_example:'',creator_notes:'TEST FIXTURE ONLY',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:['isolated-test'],creator:'qa',character_version:'1.0',extensions:{}}};
        const fd=new FormData(); fd.append('avatar',new Blob([JSON.stringify(card)],{type:'application/json'}),'fixture.json'); fd.append('file_type','json');
        const h=c.getRequestHeaders(); delete h['Content-Type']; await fetch('/api/characters/import',{method:'POST',headers:h,body:fd}); await c.getCharacters(); }
      c=SillyTavern.getContext(); await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));
    }''', CARD)
    page.wait_for_function(f"SillyTavern.getContext().name2==={json.dumps(CARD)} && SillyTavern.getContext().chat.length>0", timeout=30000)
    floors = [
        ('ai', '第一幕。莉莉丝：“宿主大人，契约生效。”\n\n' + PANEL(1000, '10/100', '初入江湖')),
        ('user', '我去看看商城。'),
        ('ai', '第二幕。\n\n莉莉丝（得意）：“商城随时为您开放～”\n\n' + PANEL(1100, '20/100', '首次购物')),
        ('user', '继续。'),
        ('ai', '第三幕，当前系统点 {{get_chat_variable::诸天系统.系统点}}。\n\n莉莉丝：“**记住**，一次一颗。”\n\n' + PANEL(1200, '30/100', '引气入体')),
    ]
    page.evaluate('''async floors=>{
      const c=SillyTavern.getContext(); c.chat.splice(1);
      for(const [who,mes] of floors) c.chat.push({name: who==='user'?c.name1:c.name2, is_user: who==='user', is_system:false, send_date: new Date().toISOString(), mes, extra:{}, swipe_id:0, swipes:[mes]});
      for(const k of Object.keys(c.chatMetadata)) delete c.chatMetadata[k];   // fresh fixture: no receipts/backups from earlier runs
      c.chatMetadata.variables={诸天系统:{系统点:1200,当前世界:'太初仙域',任务:{名称:'引气入体',完成度:30},背包:[],任务库:{}}};
      await c.saveMetadata(); await c.saveChat(); await c.reloadCurrentChat();
    }''', floors)
    page.wait_for_timeout(3000)

def phase_render(page):
    q = page.evaluate('''()=>{const out={};const mes=[...document.querySelectorAll('#chat .mes[mesid]')];
      out.floors=mes.map(el=>({id:+el.getAttribute('mesid'),frames:el.querySelectorAll('.zt-native-statusbar iframe').length,compact:el.querySelectorAll('.zt-sb-compact').length,voices:el.querySelectorAll('.zt-lilith-voice').length,mark:!!el.querySelector('.zt-render-mark'),raw:el.querySelector('.mes_text').textContent.includes('ZhuTianPanel')||el.querySelector('.mes_text').textContent.includes('ZTVOICESLOT')||el.querySelector('.mes_text').textContent.includes('ZTPANELSLOT'),text:el.querySelector('.mes_text').textContent.slice(0,60)}));
      out.mode=__zhutianApp.statusbar.state.mode; return out;}''')
    f = {x['id']: x for x in q['floors']}
    ok('status bar native mode', q['mode'] == 'native', q['mode'])
    ok('newest floor (depth 0) has live bar', f[5]['frames'] == 1, str(f[5]))
    ok('depth 2 floor shows compact card', f[3]['compact'] == 1 and f[3]['frames'] == 0, str(f[3]))
    ok('depth 4 floor shows compact card', f[1]['compact'] == 1, str(f[1]))
    ok('voice cards on AI floors', f[1]['voices'] == 1 and f[3]['voices'] == 1 and f[5]['voices'] == 1, str([f[i]['voices'] for i in (1, 3, 5)]))
    ok('no raw panel/slot text leaks', not any(x['raw'] for x in q['floors']))
    ok('macro replaced in display', '1200' in f[5]['text'] and '{{' not in f[5]['text'], f[5]['text'])
    card = page.evaluate('''()=>{const v=document.querySelector('#chat .mes[mesid="3"] .zt-lilith-voice');return {cue:v.dataset.lilithCue,head:v.querySelector('[data-lilith-head]')?.textContent,text:v.querySelector('[data-lilith-text]')?.textContent,avatar:getComputedStyle(v.querySelector('[data-lilith-avatar]')).backgroundImage.slice(0,30),mood:v.textContent.includes('得意')}}''')
    ok('voice card: name, text, tone avatar, no mood word', 'LILITH' in (card['head'] or '') and '商城随时' in (card['text'] or '') and not card['mood'], str(card))
    strong = page.evaluate("document.querySelector('#chat .mes[mesid=\"5\"] .zt-lilith-voice strong')?.textContent")
    ok('voice card inline markdown', strong == '记住', str(strong))
    compact = page.evaluate("document.querySelector('#chat .mes[mesid=\"3\"] .zt-sb-compact').textContent")
    ok('compact card fields (系统点/好感/任务)', '1100' in compact and '20/100' in compact and '首次购物' in compact, compact)
    page.locator('#chat .mes[mesid="5"] .zt-native-statusbar iframe').scroll_into_view_if_needed(); page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOTS / 'r040-live-floor.png'))
    page.locator('#chat .mes[mesid="3"]').scroll_into_view_if_needed(); page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / 'r040-compact-voice.png'))
    page.locator('#chat .mes[mesid="3"] .zt-sb-compact').click(); page.wait_for_timeout(1200)
    ok('compact card expands to full bar', page.locator('#chat .mes[mesid="3"] .zt-native-statusbar iframe').count() == 1)
    # voice toggle off/on
    page.evaluate("__zhutianApp.settings.set('voiceBox',false)"); page.wait_for_timeout(900)
    n_off = page.locator('#chat .zt-lilith-voice').count(); line = page.evaluate("document.querySelector('#chat .mes[mesid=\"3\"] .mes_text').textContent")
    ok('voice box off → plain text', n_off == 0 and '商城随时为您开放' in line, f'{n_off} {line[:40]}')
    page.evaluate("__zhutianApp.settings.set('voiceBox',true)"); page.wait_for_timeout(900)
    ok('voice box back on', page.locator('#chat .zt-lilith-voice').count() == 3)
    page.evaluate("__zhutianApp.settings.set('compactHistory',false)"); page.wait_for_timeout(900)
    ok('compact off → history button', page.locator('#chat .zt-sb-history').count() >= 1 and page.locator('#chat .zt-sb-compact').count() == 0)
    page.evaluate("__zhutianApp.settings.set('compactHistory',true)"); page.wait_for_timeout(900)
    iframe_ok = page.frame_locator('#chat .mes[mesid="5"] .zt-native-statusbar iframe').locator('.mvu-sys').count()
    ok('live bar iframe renders original status bar', iframe_ok >= 1)

def phase_generate(page):
    before = len(mock_requests())
    page.wait_for_timeout(1500)
    wb = page.evaluate("(async()=>{try{return {...await __zhutianApp.features.worldbookStatus(),auto:__zhutianApp.features.wbAuto}}catch(e){return String(e)}})()")
    ok('worldbook auto-installed and bound on the 诸天 chat', isinstance(wb, dict) and wb['count'] == 35 and wb['chatBound'], str(wb))
    bud = page.evaluate("__zhutianApp.features.worldbookBudget()")
    ok('worldbook budget check (64k context fits the constant rules)', bud and bud['ok'], str(bud))
    page.locator('#send_textarea').fill('我服下引气丹，开始修炼。'); page.locator('#send_but').click()
    page.wait_for_function("SillyTavern.getContext().chat.length>=8", timeout=60000)
    page.wait_for_function("!document.querySelector('#mes_stop:not([style*=\"none\"])') || getComputedStyle(document.querySelector('#mes_stop')).display==='none'", timeout=60000)
    page.wait_for_timeout(2500)
    reqs = [r for r in mock_requests()[before:] if r['body'].get('messages')]
    main = [r for r in reqs if '我服下引气丹' in body_text(r) and '事实记录员' not in body_text(r)]
    ok('main chat request reached the mock (via ST)', len(main) >= 1, f'{len(reqs)} requests')
    if main:
        t = body_text(main[-1])
        ok('prompt: no raw {{get_chat_variable}} left', '{{get_chat_variable' not in t)
        chat_msgs = [m for m in main[-1]['body']['messages'] if m['role'] in ('user', 'assistant')]
        with_panel = [m['content'][:12] for m in chat_msgs if '<ZhuTianPanel>' in str(m['content'])]
        ok('prompt: old floors stripped (only the depth-1 floor keeps its panel)', len(with_panel) == 1 and with_panel[0].startswith('第三幕'), str(with_panel))
        ok('prompt: 诸天 worldbook injected (constant rule text present)', '系统点' in t and ('莉莉丝' in t) and ('诸天万界' in t or '万界商城' in t), str(len(t)))
        import re as _re
        ok('prompt: worldbook macro replaced with the ledger value', bool(_re.search(r'系统点[^\n]{0,6}1200', t)) or '1200' in t)
        ok('stream enabled', main[-1]['body'].get('stream') is True)
    q = page.evaluate('''()=>{const last=document.querySelector('#chat .mes:last-child');return {id:+last.getAttribute('mesid'),frames:last.querySelectorAll('.zt-native-statusbar iframe').length,voices:last.querySelectorAll('.zt-lilith-voice').length,compactPrev:document.querySelectorAll('#chat .zt-sb-compact').length}}''')
    ok('streamed reply rendered: bar + 2 voice cards', q['frames'] == 1 and q['voices'] == 2, str(q))
    saved = page.evaluate("SillyTavern.getContext().chat.at(-1).mes")
    ok('saved message keeps the panel (strip is prompt-only)', '<ZhuTianPanel>' in saved)
    page.screenshot(path=str(SHOTS / 'r040-streamed.png'))

def phase_api(page):
    # Open API center from the drawer action
    page.evaluate("__zhutianApp.openApiCenter()"); dlg = page.locator('#zt-api-center')
    expect(dlg).to_be_visible()
    dlg.locator('input[name=mode][value=custom]').check()   # an earlier run may have saved main-API mode (url field disabled)
    dlg.locator('input[name=url]').fill(args.mock); dlg.locator('input[name=key]').fill('qa-key-not-real')
    dlg.locator('[data-act=models]').click(); page.wait_for_timeout(1500)
    ok('API center: model list', 'mock-zt' in dlg.locator('#zt-api-models').inner_html(), dlg.locator('[data-out]').inner_text())
    dlg.locator('input[name=model]').fill('mock-zt'); dlg.locator('input[name=max]').fill('2048')
    dlg.locator('[data-act=test]').click(); page.wait_for_timeout(2500)
    ok('API center: test (independent)', '连接正常' in dlg.locator('[data-out]').inner_text(), dlg.locator('[data-out]').inner_text())
    dlg.locator('[data-act=save]').click(); page.wait_for_timeout(800)
    saved = page.evaluate('''()=>{const b=__zhutianApp.bridge;return {g:b.getVariables({type:'global'})['诸天系统_API'],s:b.getVariables({type:'script'})['诸天记忆助手_v1_API'],l:JSON.parse(localStorage.getItem('sys_api_config')||'null')}}''')
    ok('API center writes original storages', saved['g']['url'] == args.mock and saved['s']['maxTokens'] == 2048 and saved['l']['key'] == 'qa-key-not-real', json.dumps(saved, ensure_ascii=False)[:200])
    page.screenshot(path=str(SHOTS / 'r040-api-center.png'))
    dlg.locator('button[value=close]').click()
    # Status bar AI: shop restock (original prompt, custom API, max_tokens honoured)
    before = len(mock_requests())
    fr = page.frame_locator('#chat .mes:last-child .zt-native-statusbar iframe')
    page.evaluate("document.querySelector('#chat .mes:last-child .zt-native-statusbar iframe').scrollIntoView()")
    fr.locator('.mvu-nav-item.t5, label:has(input.t5), input.t5').first.click(force=True); page.wait_for_timeout(600)
    btn = fr.locator('.btn-refresh-store').first
    btn.click(force=True); page.wait_for_timeout(4000)
    reqs = mock_requests()[before:]
    shop = [r for r in reqs if '只输出规定的格式列表' in body_text(r)]
    ok('status bar shop restock hit the independent API', len(shop) == 1, f'{len(reqs)} reqs')
    if shop: ok('status bar max_tokens/temperature honoured', shop[0]['body'].get('max_tokens') == 1500 and shop[0]['body'].get('temperature') == 0.7 and shop[0]['auth'] == 'Bearer qa-key-not-real', json.dumps({k: shop[0]['body'].get(k) for k in ('max_tokens', 'temperature', 'model')}))
    items = fr.locator('.mvu-store-item').count(); names = fr.locator('.store-items-container').inner_text()
    # shop level 1 only stocks 凡品 (original ztShopLevel filter): the mock returns 4 凡品 + higher grades
    ok('shop items rendered from model output (level-filtered like the original)', items == 4 and '引气丹' in names and '九转金丹' not in names, f'{items}')
    pts = page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统.系统点")
    ok('shop restock charged 500 系统点', pts in (700, 850), str(pts))
    page.screenshot(path=str(SHOTS / 'r040-shop.png'))
    # Main API mode
    page.evaluate("__zhutianApp.openApiCenter()"); dlg = page.locator('#zt-api-center')
    dlg.locator('input[name=mode][value=main]').check(); dlg.locator('[data-act=test]').click(); page.wait_for_timeout(3500)
    ok('API center: test (SillyTavern main API)', '连接正常' in dlg.locator('[data-out]').inner_text(), dlg.locator('[data-out]').inner_text())
    dlg.locator('[data-act=save]').click(); page.wait_for_timeout(600); dlg.locator('button[value=close]').click()
    before = len(mock_requests())
    fr.locator('.wish-input').first.fill('今晚吃上一桌好菜'); fr.locator('.btn-quote').first.click(force=True); page.wait_for_timeout(5000)
    wish = [r for r in mock_requests()[before:] if '用户许愿：' in body_text(r)]
    ok('status bar wish via SillyTavern main API', len(wish) == 1 and wish[0]['auth'] != 'Bearer st-main', f"{len(wish)} {wish[0]['auth'] if wish else ''}")
    quote = fr.locator('.quote-text').first.inner_text()
    ok('wish quote parsed', '20,000' in quote or '20000' in quote, quote[:80])

def phase_takeover(page):
    legacy = json.load(open(Path(args.legacy_dir) / '未改动-已安装者无需重复导入' / 'regex-诸天万界最强系统状态栏3_1_通用版.json', encoding='utf8'))
    voice = json.load(open(Path(args.legacy_dir) / '未改动-已安装者无需重复导入' / 'regex-莉莉丝专属语音框.json', encoding='utf8'))
    page.evaluate('''([a,b])=>{const c=SillyTavern.getContext();c.extensionSettings.regex=[...(c.extensionSettings.regex||[]).filter(r=>r.id!==a.id&&r.id!==b.id),a,b];
      c.extensionSettings.tavern_helper={script:{scripts:[{type:'script',id:'d9764037-5fda-4203-89ab-9b94f27255ab',name:'诸天系统 · 莉莉丝契约空间 v1.1',content:'',enabled:true}]}};c.saveSettingsDebounced();}''', [legacy, voice])
    page.evaluate("__zhutianApp.statusbar.rebuild()"); page.wait_for_timeout(1200)
    ok('with old regexes on and no TH: plugin still renders natively', page.evaluate("__zhutianApp.statusbar.state.mode") == 'native' and page.locator('#chat .zt-lilith-voice').count() >= 3)
    ok('no double voice rendering by the old regex', page.locator('#chat .mes[mesid="3"] .zt-lilith-voice').count() == 1)
    rows = page.evaluate("__zhutianApp.features.replacementRows().map(r=>r.join(' = '))")
    ok('diagnostics lists leftovers', any('仍启用的旧版内容 = ⚠' in r for r in rows), rows[-1][:120])
    page.evaluate("window.confirm=()=>true; window.__reloads=0; window.location.reload=()=>{window.__reloads++}")
    r = page.evaluate("(async()=>{const r=await __zhutianApp.takeover.run();return {n:r.items.length,reload:r.reload}})()")
    st = page.evaluate('''()=>{const c=SillyTavern.getContext();return {regs:c.extensionSettings.regex.filter(r=>['47b6bdaf-f89c-4cc0-bb12-617286788c94','bd2a75db-7ddd-4311-9f5b-db21afec623a'].includes(r.id)).map(r=>r.disabled),th:c.extensionSettings.tavern_helper.script.scripts[0].enabled,log:__zhutianApp.settings.get('takeoverLog').length}}''')
    ok('takeover disables 2 regexes + TH script', r['n'] == 3 and st['regs'] == [True, True] and st['th'] is False and st['log'] == 3, f'{r} {st}')
    # The page reloads 2 s after takeover (Tavern Helper keeps an in-memory copy), so the change must already be on disk -
    # read it back from the server, not from the page.
    disk = page.evaluate('''async()=>{const c=SillyTavern.getContext();const r=await fetch('/api/settings/get',{method:'POST',headers:c.getRequestHeaders(),body:'{}'});
      const s=JSON.parse((await r.json()).settings).extension_settings;
      return {regs:(s.regex||[]).filter(x=>['47b6bdaf-f89c-4cc0-bb12-617286788c94','bd2a75db-7ddd-4311-9f5b-db21afec623a'].includes(x.id)).map(x=>x.disabled),
              th:s.tavern_helper?.script?.scripts?.[0]?.enabled}}''')
    ok('takeover persisted to disk before reload', disk['regs'] == [True, True] and disk['th'] is False, disk)
    rows = page.evaluate("__zhutianApp.features.replacementRows().at(-1)[1]")
    ok('diagnostics: fully taken over', '✅' in rows, rows)
    back = page.evaluate("(async()=>{const r=await __zhutianApp.takeover.restore();return r.items.length})()")
    st2 = page.evaluate('''()=>{const c=SillyTavern.getContext();return {regs:c.extensionSettings.regex.filter(r=>r.disabled===false&&['47b6bdaf-f89c-4cc0-bb12-617286788c94','bd2a75db-7ddd-4311-9f5b-db21afec623a'].includes(r.id)).length,th:c.extensionSettings.tavern_helper.script.scripts[0].enabled}}''')
    ok('restore re-enables exactly those', back == 3 and st2['regs'] == 2 and st2['th'] is True, f'{back} {st2}')
    page.evaluate("(async()=>{await __zhutianApp.takeover.run();const c=SillyTavern.getContext();c.extensionSettings.regex=c.extensionSettings.regex.filter(r=>!['47b6bdaf-f89c-4cc0-bb12-617286788c94','bd2a75db-7ddd-4311-9f5b-db21afec623a'].includes(r.id));delete c.extensionSettings.tavern_helper;__zhutianApp.settings.set('takeoverLog',[]);c.saveSettingsDebounced();})()")

def phase_diag(page):
    page.evaluate("jQuery('#openai_max_context').val(16384).trigger('input');jQuery('#world_info_budget').val(25).trigger('input')"); page.wait_for_timeout(500)
    page.evaluate("__zhutianApp.features.openDiagnostics()"); page.wait_for_timeout(1200)
    low = page.evaluate("__zhutianApp.features.wbBudget")
    btn = page.locator('.zt-popup [data-diag=budget]')
    ok('diagnostics warns when the world-info budget is too small', low and not low['ok'] and btn.count() == 1, str(low))
    if btn.count():
        btn.click(); page.wait_for_timeout(800)
        fixed = page.evaluate("__zhutianApp.features.worldbookBudget()")
        ok('一键调整 raises the budget through ST controls', fixed and fixed['ok'], str(fixed))
    page.keyboard.press('Escape'); page.wait_for_timeout(400)
    page.evaluate("__zhutianApp.features.openDiagnostics()"); page.wait_for_timeout(1000)
    page.screenshot(path=str(SHOTS / 'r040-diagnostics.png'))
    txt = page.locator('.zt-popup').last.inner_text()
    ok('diagnostics shows v1.1 replacement table', '原版 v1.1 取代情况' in txt and '莉莉丝专属语音框' in txt)
    page.keyboard.press('Escape')

SR = "document.getElementById('zt-memory-assistant-v1').shadowRoot"
def sr_eval(page, js):
    return page.evaluate(f"(async()=>{{const sr={SR};{js}}})()")

def wait_mock(page, pred, before, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        hit = [r for r in mock_requests()[before:] if pred(r)]
        if hit: return hit
        page.wait_for_timeout(500)
    return []

def phase_assistant(page):
    # start from the API center's "SillyTavern main API" choice regardless of earlier runs
    page.evaluate("(async()=>{const m=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/api-center.js');const t=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/th-bridge.js');await m.saveConfigs(__zhutianApp.bridge,'诸天记忆助手_v1',{url:t.MAIN_API_URL});})()")
    page.evaluate("__zhutianApp.assistant.open()"); page.wait_for_timeout(2000)
    ok('assistant running (not 未启动) with stage', sr_eval(page, "return !!sr.querySelector('.zt-stage') && !/未启动/.test(sr.getElementById('status')?.textContent||'')"))
    url = sr_eval(page, "sr.getElementById('tab-api').click();await new Promise(r=>setTimeout(r,400));return sr.getElementById('url').value")
    ok('assistant connection page shows API-center value', 'st-main.zhutian.invalid' in url, url)
    before = len(mock_requests())
    sr_eval(page, "sr.getElementById('test').click()")
    hit = wait_mock(page, lambda r: True, before, 30)
    ok('assistant 测试连接 via SillyTavern main API (sentinel never fetched)', len(hit) >= 1 and not any('zhutian.invalid' in r['path'] for r in hit), f'{len(hit)}')
    # memory recorder on the newest reply
    before = len(mock_requests())
    sr_eval(page, "sr.getElementById('tab-memory').click();await new Promise(r=>setTimeout(r,300));const e=sr.getElementById('enabled');if(!e.checked){e.click();}await new Promise(r=>setTimeout(r,300));sr.getElementById('save-chat').click();await new Promise(r=>setTimeout(r,1200));sr.getElementById('latest').click()")
    hit = wait_mock(page, lambda r: '你是诸天系统外挂世界书的事实记录员' in body_text(r), before, 40)
    ok('memory recorder request (original prompt) answered', len(hit) >= 1)
    page.wait_for_timeout(2500)
    mem = page.evaluate("(()=>{const v=SillyTavern.getContext().chatMetadata.variables['诸天记忆助手_v1'];return v?{frames:(v.frames||[]).length,facts:JSON.stringify(v).includes('引气入体')}:null})()")
    ok('memory saved to chat variables', bool(mem) and (mem['frames'] >= 1 or mem['facts']), str(mem))
    # private chat with independent API
    page.evaluate(f"__zhutianApp.bridge.updateVariablesWith(v=>{{v['诸天记忆助手_v1_API']={{url:{json.dumps(args.mock)},key:'qa-key-not-real',model:'mock-zt'}};return v}},{{type:'script'}})")
    before = len(mock_requests())
    sr_eval(page, "sr.getElementById('header-avatar').click();await new Promise(r=>setTimeout(r,600));const i=sr.getElementById('lc-input');i.value='今天修炼累了吗？';i.dispatchEvent(new Event('input',{bubbles:true}));sr.getElementById('lc-send').click()")
    hit = wait_mock(page, lambda r: '今天修炼累了吗' in body_text(r), before, 40)
    ok('private chat request reached independent API', len(hit) >= 1 and hit[0]['auth'] == 'Bearer qa-key-not-real', f'{len(hit)}')
    page.wait_for_timeout(2500)
    log = sr_eval(page, "return sr.getElementById('lc-log').innerText")
    ok('private chat reply shown', '今天修炼累了吗' in log and '宿主大人终于想起莉莉丝' in log, log[:120])
    page.screenshot(path=str(SHOTS / 'r040-private-chat.png'))
    sr_eval(page, "sr.getElementById('lc-close')?.click()")


def phase_sbai(page):
    """Every AI button of the original status bar (all go through window.sysFetchAPI), here via the SillyTavern main API mode."""
    SB = '#chat .mes:last-child .zt-native-statusbar iframe'
    page.evaluate(f"document.querySelector('{SB}').scrollIntoView()")
    # Seed a ledger that can afford a draw and has materials (the fixture chat only holds ~1000 points and an empty bag).
    page.evaluate("""async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{const z=v.诸天系统||(v.诸天系统={});
        z.系统点=200000;z.界面记账时间=Date.now();
        z.背包=[{名称:'铁剑',品级:'凡品',来源:'测试',价格:300,分类:'其他',效果:'',数量:1},
               {名称:'灵草',品级:'凡品',来源:'测试',价格:80,分类:'其他',效果:'',数量:2},
               {名称:'布衣',品级:'凡品',来源:'测试',价格:120,分类:'其他',效果:'',数量:1}];return v;},{type:'chat'});}""")
    page.wait_for_timeout(600)
    frame = page.locator(SB).element_handle().content_frame(); fr = page.frame_locator(SB)
    # Deterministic: no alert/confirm dialogs, and no random 10% fusion failure (a failed fusion never calls the API).
    frame.evaluate("window.__alerts=[];window.alert=m=>window.__alerts.push(String(m));window.confirm=()=>true;Math.random=()=>0.5;")
    z = lambda: page.evaluate("__zhutianApp.bridge.getVariables({type:'chat'}).诸天系统")
    tab = lambda n: (fr.locator(f'.mvu-nav-item.t{n}, label:has(input.t{n}), input.t{n}').first.click(force=True), page.wait_for_timeout(500))
    def fired(phrase, before): return [r for r in mock_requests()[before:] if phrase in body_text(r)]
    alerts = lambda: frame.evaluate("window.__alerts.splice(0)")

    # 1. Status-bar own API dialog → 测试连接
    before = len(mock_requests())
    fr.locator('.btn-open-api').first.click(force=True); page.wait_for_timeout(400)
    fr.locator('.btn-test-api').first.click(force=True); page.wait_for_timeout(3000)
    res = fr.locator('.sys-api-modal').first.inner_text()
    ok('status bar ⚙ 测试连接 (main API)', '连接成功' in res and fired('回复两个字：成功', before), res.strip().replace('\n', ' ')[-60:])
    fr.locator('.sys-api-modal .api-btn:has-text("关闭")').first.click(force=True); page.wait_for_timeout(300)

    # 2. 商城 → 单抽 (charges 10,000, reward generator, result → pending → keep all → bag)
    tab(5); before = len(mock_requests()); p0 = z()['系统点']; bag0 = len(z()['背包'])
    fr.locator('.btn-gacha[data-times="1"], .btn-gacha').first.click(force=True); page.wait_for_timeout(5000)
    g = fired('你是诸天系统的奖励生成器', before); z1 = z()
    ok('gacha: reward generator called once and 10,000 charged', len(g) == 1 and z1['系统点'] == p0 - 10000, f"{len(g)} {p0}->{z1['系统点']} {alerts()}")
    fr.locator('.btn-close-gacha').first.dispatch_event('click'); page.wait_for_timeout(500)   # result card 「收下奖励」
    pend = frame.evaluate("document.querySelectorAll('#pending-list > *').length")
    fr.locator('.mvu-panel.p5 .btn-keep-all').first.dispatch_event('click'); page.wait_for_timeout(1200)
    bag = z()['背包']
    ok('gacha: drawn item kept into the bag', len(bag) == bag0 + 1 and any(i['名称'] in ('回气散',) or '秘宝' in i['名称'] for i in bag), f"pending={pend} {[i['名称'] for i in bag]}")
    page.screenshot(path=str(SHOTS / 'r040-gacha.png'))

    # 3. 背包 → AI 背包整理 (every item re-classified from the model output)
    tab(6); before = len(mock_requests())
    fr.locator('.btn-bag-organize').first.click(force=True); page.wait_for_timeout(4000)
    o = fired('你是背包整理助手', before); bag = z()['背包']
    ok('bag organise: AI re-classified every item', len(o) == 1 and all(i.get('分类') == '消耗品' and i.get('效果') for i in bag), [(i['名称'], i.get('分类')) for i in bag] + alerts())

    # 4. 外挂 → 召唤 (recruit officer → mercenary card)
    tab(7); before = len(mock_requests())
    fr.locator('#summon-name').first.fill('叶清寒'); fr.locator('#summon-world').first.fill('问剑宗')
    fr.locator('.btn-summon').first.click(force=True); page.wait_for_timeout(4000)
    s_ = fired('你是诸天万界的招募官', before)
    card = fr.locator('.mvu-panel.p7').first.inner_text()
    ok('recruit: officer called and mercenary card shown', len(s_) == 1 and '叶清寒' in card and 'B+' in card, f"{len(s_)} {alerts()}")

    # 5. 外挂 → 万物熔炉 (two bag items → AI names the fused item)
    before = len(mock_requests()); n0 = len(z()['背包'])
    frame.evaluate("""()=>{for(const [id,v] of [['#zt-fu-a','0'],['#zt-fu-b','1']]){const e=document.querySelector(id);if(e){e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));}}}""")
    page.wait_for_timeout(300)
    fr.locator('.zt-fu-go').first.click(force=True); page.wait_for_timeout(4000)
    fu = fired('严格只输出一行', before); names = [i['名称'] for i in z()['背包']]
    ok('fusion furnace: AI named the fused item', len(fu) == 1 and '九转凝元丹' in names, f"{len(fu)} {names} {alerts()}")
    page.screenshot(path=str(SHOTS / 'r040-plugins.png'))

    # 6. 神通 → AI 评估实力档
    tab(8); before = len(mock_requests())
    fr.locator('#zt-cp-name').first.fill('叶清寒')
    fr.locator('.zt-cp-eval').first.click(force=True); page.wait_for_timeout(3500)
    ev = fired('严格执行格式要求，只输出一行', before)
    tier = frame.evaluate("document.querySelector('#zt-cp-tier')?.value")
    ok('power evaluation: AI tier applied', len(ev) == 1 and tier == '5', f"{len(ev)} tier={tier} {alerts()}")
    # every one of these went through SillyTavern's main API, never to the sentinel host
    ok('status-bar AI requests all used the main API', all(r.get('auth') != 'Bearer st-main' for r in mock_requests()[-6:]))

def phase_touch(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 760}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    boot(page)
    page.evaluate(f"(async()=>{{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name==={json.dumps(CARD)}));}})()"); page.wait_for_timeout(2500)
    page.evaluate("__zhutianApp.assistant.open()"); page.wait_for_timeout(2500)
    cdp = ctx.new_cdp_session(page)
    def zone_point(zone):
        return page.evaluate(f"""(()=>{{const sr={SR};const z=sr.querySelector('.zt-zone[data-zone="{zone}"]');const b=z.getBoundingClientRect();
          for(let fy=.5;fy<.95;fy+=.07)for(let fx=.5;fx>.05&&fx<.95;fx+=(fx>=.5?.07:-.07)){{const x=b.left+b.width*fx,y=b.top+b.height*fy;const el=sr.elementFromPoint(x,y);if(el===z)return [x,y];}}
          for(let fy=.1;fy<.95;fy+=.05)for(let fx=.1;fx<.95;fx+=.05){{const x=b.left+b.width*fx,y=b.top+b.height*fy;if(sr.elementFromPoint(x,y)===z)return [x,y];}}return null}})()""")
    def touch(kind, x, y): cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'id': 1}]})
    bubble = lambda: page.evaluate(f"{SR}.querySelector('.zt-bubble')?.textContent||''")
    lines = page.evaluate("(async()=>{const m=await import('/scripts/extensions/third-party/zhutianxitongchajianban/src/touch.js');return {s:m.STROKE_LINES,h:m.HOLD_LINES}})()")
    ok('touch layer attached on mobile', page.evaluate("!!__zhutianApp.touch.stage"))
    # stroke the cheek: rub back and forth
    pt = zone_point('cheek'); ok('cheek zone reachable', pt is not None, str(pt))
    if pt:
        x, y = pt; touch('touchStart', x, y)
        for i in range(4): page.wait_for_timeout(16); touch('touchMove', x + (12 if i % 2 == 0 else -12), y + (i % 3))
        page.wait_for_timeout(100); b1 = bubble()
        for i in range(40): page.wait_for_timeout(12); touch('touchMove', x + (14 if i % 2 == 0 else -14), y)
        b2 = bubble(); touch('touchEnd', x, y); page.wait_for_timeout(400); b3 = bubble()
        ok('stroke → first stroke line (level 0)', b1 == lines['s']['cheek'][0], b1)
        ok('continued stroke escalates', b2 in lines['s']['cheek'][1:], b2)
        ok('release does not add a tap line (click swallowed)', b3 == b2, b3)
        page.screenshot(path=str(SHOTS / 'r040-touch-stroke.png'))
    page.wait_for_timeout(1200)
    pt = zone_point('horn') or zone_point('wing')
    if pt:
        zone = 'horn' if zone_point('horn') else 'wing'
        x, y = pt; touch('touchStart', x, y); page.wait_for_timeout(900); bh = bubble(); touch('touchEnd', x, y); page.wait_for_timeout(400)
        ok(f'long press ({zone}) → hold line, no tap line after', bh in lines['h'][zone] and bubble() == bh, bh)
    page.wait_for_timeout(600)
    pt = zone_point('arm') or zone_point('tail')
    if pt:
        x, y = pt; before = page.evaluate("__zhutianApp.touch.stats.taps")
        page.touchscreen.tap(x, y); page.wait_for_timeout(500)
        ok('tap → original tap reaction still works', page.evaluate("__zhutianApp.touch.stats.taps") == before + 1 and len(bubble()) > 0 and bubble() not in sum(lines['s'].values(), []), bubble())
    ok('no page errors (mobile)', not errs, ' | '.join(errs)[:300])
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    page = b.new_page(viewport={'width': 1400, 'height': 950}); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' and 'zhutian' in m.text.lower() else None)
    boot(page)
    status = connect_main_api(page); ok('ST main API connected to mock', status not in ('no_connection', None), str(status))
    setup_chat(page)
    phases = args.phase.split(',') if args.phase != 'all' else ['render', 'generate', 'api', 'sbai', 'assistant', 'takeover', 'diag', 'touch']
    for ph in phases:
        try: globals()['phase_' + ph](b if ph == 'touch' else page)
        except Exception as e:
            ok('phase ' + ph + ' crashed', False, repr(e)[:300]); page.screenshot(path=str(SHOTS / f'r040-crash-{ph}.png'))
    ok('no page errors', not errs, ' | '.join(errs)[:400])
    b.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
