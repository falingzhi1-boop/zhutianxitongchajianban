"""Shared helpers for the browser suites (isolated SillyTavern + mock model only)."""
import json, time
from pathlib import Path
EXT = '/scripts/extensions/third-party/zhutianxitongchajianban'
CARD = '莉莉丝 · 诸天验收'
PANEL = lambda pts, favor, task: f'<ZhuTianPanel>\n系统点: {pts}\n好感度: {favor}\n当前任务: {task}\n任务进度: 30\n系统播报: 楼层测试\n</ZhuTianPanel>'
class _Args: base_url='http://127.0.0.1:8019'; mock='http://127.0.0.1:5001/v1'
args=_Args(); SHOTS=Path('/var/tmp/qa/shots')
def configure(base_url, mock, shots):
    args.base_url=base_url; args.mock=mock
    global SHOTS; SHOTS=Path(shots); SHOTS.mkdir(parents=True, exist_ok=True)
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
    # 0.9.3: the fixture answers the first-run 新手引导 (it would otherwise open once on the first terminal open);
    # tests/native_v093.py clears this to test the wizard itself.
    page.evaluate("()=>{const s=__zhutianApp.settings;if(!s.get('guide'))s.set('guide',{state:'skipped',at:0,version:'qa-preset'});}")

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



def open_chat(page):
    """Re-open the fixture character's existing chat (after a reload) without resetting it."""
    page.evaluate('''async name=>{const c=SillyTavern.getContext(); const i=c.characters.findIndex(x=>x.name===name); if(i>=0 && c.name2!==name) await c.selectCharacterById(i);}''', CARD)
    page.wait_for_function(f"SillyTavern.getContext().name2==={json.dumps(CARD)} && SillyTavern.getContext().chat.length>1", timeout=30000)
    page.wait_for_timeout(2000)
