from playwright.sync_api import sync_playwright,expect
from pathlib import Path
import json,time

import argparse
parser=argparse.ArgumentParser(description='DESTRUCTIVE TO QA FIXTURES: isolated SillyTavern only; never use production data.')
parser.add_argument('--isolated-test-only',action='store_true',required=True,help='Acknowledge that this server contains disposable test data only.')
parser.add_argument('--base-url',default='http://127.0.0.1:8010')
parser.add_argument('--extension-folder',default='zhutianxitongchajianban')
args=parser.parse_args()
ARTIFACTS=Path(__file__).resolve().parents[1]/'docs'/'evidence'
ARTIFACTS.mkdir(parents=True,exist_ok=True)

out=ARTIFACTS
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
 page=b.new_page(viewport={'width':1500,'height':1000});errs=[];requests=[]
 page.on('pageerror',lambda e:errs.append(str(e)))
 page.on('request',lambda r:requests.append(r.url) if any(s in r.url for s in ['/generate','/chat/completions','/api/backends/chat-completions/generate']) else None)
 page.add_init_script('window.__ztTestBase='+json.dumps('/scripts/extensions/third-party/'+args.extension_folder))
 page.goto(args.base_url.rstrip('/')+'/');page.wait_for_timeout(2500)
 if page.locator('dialog.popup[open] .popup-button-ok:visible').count():
  page.locator('dialog.popup[open] .popup-button-ok:visible').click();page.wait_for_timeout(1500)
 page.wait_for_function("typeof SillyTavern !== 'undefined' && SillyTavern.getContext().eventSource.autoFireLastArgs.has(SillyTavern.getContext().eventTypes.APP_READY)",timeout=60000)
 # Create local-only fixtures through the real server import endpoint, not a mock host.
 names=['莉莉丝 · 隔离验收','叶清寒 · 隔离验收']
 for name in names:
  print('import',page.evaluate('''async name=>{
   let c=SillyTavern.getContext();if(c.characters.some(x=>x.name===name))return 'already exists';
   const card={spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'独立隔离验收角色。无真实用户存档，无模型连接。',personality:'用于技术验收',scenario:'隔离的契约空间',first_mes:'【隔离验收开场，非模型生成】原生扩展正文互动测试已就绪。',mes_example:'',creator_notes:'TEST FIXTURE ONLY',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:['isolated-test'],creator:'local-test',character_version:'1.0',extensions:{}}};
   let fd=new FormData();fd.append('avatar',new Blob([JSON.stringify(card)],{type:'application/json'}),'fixture.json');fd.append('file_type','json');let headers=c.getRequestHeaders();delete headers['Content-Type'];
   const r=await fetch('/api/characters/import',{method:'POST',headers,body:fd});const result=await r.json();await c.getCharacters();return result;
  }''',name))
 page.evaluate('''async name=>{const c=SillyTavern.getContext();await c.getCharacters();await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}''',names[0]);page.wait_for_function("SillyTavern.getContext().name2 === '莉莉丝 · 隔离验收' && SillyTavern.getContext().chat.length > 0");page.evaluate('async()=>{const c=SillyTavern.getContext();c.chat.splice(1);await c.saveChat();await c.reloadCurrentChat();}')
 # Seed a visibly labeled isolated fixture using the real metadata persistence path.
 page.evaluate('''async()=>{const c=SillyTavern.getContext();c.chatMetadata.zhutianCovenantTerminal={schema:1,recallEnabled:false};c.chatMetadata.variables={...c.chatMetadata.variables,诸天系统:{当前世界:'隔离验收 · 太初仙域',系统点:2480,累计消费:320,任务库:{qa01:{ID:'qa01',名称:'验证正文互动',内容:'玩家发送一次互动，重载后仍可读到原消息。',奖励:'无真实奖励',状态:'进行中'}},背包:[{名称:'隔离测试·无名之钥',品级:'测试',数量:1,效果:'仅用于读取验收，不参与真实交易。'}],打手:[{名称:'叶清寒',简介:'验收用角色记录'}]},诸天记忆助手_v1:{version:1,enabled:true,auto:false,budget:6000,frames:[],pins:['这是隔离验收聊天，不是用户生产数据。'],revision:0}};await c.saveMetadata();}''')
 root=page.locator('#zhutian-covenant-terminal')
 page.locator('#zt-covenant-launcher').click();page.wait_for_timeout(1900)
 page.screenshot(path=str(out/'native-terminal.png'))
 motion=root.locator('.zt-stage').evaluate('(e)=>({...e.dataset})');print('motion',motion);assert motion['renderer']=='layers'
 # Original portrait keyboard interaction prepares an unsent draft, not an AI answer.
 untouched=page.evaluate('SillyTavern.getContext().chat.length')
 root.locator('.zt-zone').first.focus();root.locator('.zt-zone').first.press('Enter');root.locator('[data-act="lilith"]').click()
 assert root.locator('#action-text').input_value()
 assert page.evaluate('SillyTavern.getContext().chat.length')==untouched
 page.emulate_media(reduced_motion='reduce');page.wait_for_timeout(150);expect(root.locator('.zt-stage')).to_have_attribute('data-running','false',timeout=5000)
 page.emulate_media(reduced_motion='no-preference');root.locator('[data-act="close"]').click();page.wait_for_timeout(150);expect(root.locator('.zt-stage')).to_have_attribute('data-running','false',timeout=5000)
 page.locator('#zt-covenant-launcher').click();root.locator('[data-page="home"]').click()
 expect(root.locator('#content')).to_contain_text('2,480')
 root.locator('[data-page="interact"]').first.click()
 root.locator('#action-text').fill('我邀请莉莉丝一起查看星图，讨论接下来的旅程。')
 root.locator('[data-act="preview"]').click()
 root.locator('#send-consent').check()
 before=page.evaluate('SillyTavern.getContext().chat.length')
 root.locator('[data-act="send"]').click();page.wait_for_timeout(1200)
 after=page.evaluate('SillyTavern.getContext().chat.length');assert after==before+1,(before,after)
 sent=page.evaluate('SillyTavern.getContext().chat.at(-1)');assert sent['is_user'] and sent['extra']['zhutianCovenantTerminal']['kind']=='player-interaction'
 expect(page.locator('.zt-covenant-story-label')).to_have_count(1)
 page.screenshot(path=str(out/'native-story-message.png'))
 # Plain chat input isn't replaced.
 page.locator('#send_textarea').fill('这是一份需要保留的主聊天草稿。')
 page.locator('#zt-covenant-launcher').click();root.locator('[data-page="interact"]').first.click();root.locator('#action-text').fill('我转向叶清寒，询问她的建议。');root.locator('#target-name').fill('叶清寒');root.locator('[data-act="preview"]').click();root.locator('#send-consent').check();root.locator('[data-act="send"]').click();page.wait_for_timeout(600)
 expect(page.locator('#send_textarea')).to_have_value('这是一份需要保留的主聊天草稿。')
 # Reload: real disk-backed messages and extension stamps remain.
 page.reload();page.wait_for_function("typeof SillyTavern !== 'undefined' && SillyTavern.getContext().eventSource.autoFireLastArgs.has(SillyTavern.getContext().eventTypes.APP_READY)",timeout=60000)
 page.evaluate('''async name=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}''',names[0]);page.wait_for_function("SillyTavern.getContext().name2 === '莉莉丝 · 隔离验收' && SillyTavern.getContext().chat.some(m=>m.extra?.zhutianCovenantTerminal)");print('reloaded',page.evaluate('({id:SillyTavern.getContext().getCurrentChatId(),len:SillyTavern.getContext().chat.length})'))
 receipts=page.evaluate('SillyTavern.getContext().chat.filter(m=>m.extra?.zhutianCovenantTerminal).length');assert receipts==2,receipts
 # Read-only original data and original recall toggle.
 page.locator('#zt-covenant-launcher').click();root.locator('[data-page="ledger"]').click();expect(root.locator('#content')).to_contain_text('隔离测试·无名之钥')
 root.locator('[data-page="memory"]').click();root.locator('[data-act="recall"]').click();page.wait_for_timeout(600)
 prompt=page.evaluate('SillyTavern.getContext().extensionPrompts["zhutian-covenant-terminal/memory"]');assert prompt and '隔离验收' in prompt['value']
 # Changing chat cannot retain previous interaction or injection.
 root.locator('[data-page="interact"]').first.click();root.locator('#action-text').fill('旧聊天草稿不可跨聊天发送');root.locator('[data-act="preview"]').click()
 page.evaluate('''async name=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}''',names[1]);page.wait_for_timeout(500)
 expect(root.locator('#action-text')).to_have_value('');assert root.locator('[data-act="send"]').count()==0
 assert not page.evaluate('SillyTavern.getContext().extensionPrompts["zhutian-covenant-terminal/memory"]?.value')
 # Mobile UI inside the same actual SillyTavern instance.
 page.set_viewport_size({'width':390,'height':844});root.locator('[data-page="interact"]').first.click();page.wait_for_timeout(300);page.screenshot(path=str(out/'native-mobile.png'))
 root.locator('.top [data-act="portrait"]').click();page.wait_for_timeout(350);expect(root.locator('.char-column')).to_be_visible();page.screenshot(path=str(out/'native-mobile-lilith.png'))
 root.locator('.top [data-act="portrait"]').click()
 overflow=page.evaluate('''()=>{const s=document.getElementById('zhutian-covenant-terminal').shadowRoot;let d=s.querySelector('dialog');return d.scrollWidth>d.clientWidth;}''');assert not overflow
 # Lifecycle: destroy -> recreate exactly one owned entry and root; no host message deletion.
 count=page.evaluate('SillyTavern.getContext().chat.length')
 page.evaluate("async()=>{const m=await import(window.__ztTestBase+'/index.js');m.deactivate();}")
 assert page.locator('#zt-covenant-launcher').count()==0
 page.evaluate("async()=>{const m=await import(window.__ztTestBase+'/index.js');m.activate();}");page.wait_for_timeout(600)
 assert page.locator('#zt-covenant-launcher').count()==1
 assert page.evaluate('SillyTavern.getContext().chat.length')==count
 result={'host':'SillyTavern 1.19.0','commit':'06bde939fb1e9c4c8d8641d810f0a916b5bce127','browser':'Playwright Chromium desktop 1500x1000 and mobile viewport 390x844','source':'real isolated server, no mock getContext','persistedPlayerMessages':receipts,'cases':['native extension activation','original animated portrait','keyboard gesture prepares unsent draft','reduced-motion and closed-dialog pause','read-only legacy ledger','confirmed player message send','other character target','main composer preserved','reload persistence','original recall injection opt-in','chat-switch invalidation and prompt cleanup','mobile horizontal layout','mobile original portrait sheet','deactivate/recreate cleanup'],'portraitRenderer':motion['renderer'],'pageErrors':errs,'modelRequests':requests,'notTestedByThisScript':['paid model generation','Git URL installation','complete legacy feature migration','physical mobile performance','old production save migration']}
 (out/'acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))
 # Leave the local isolated fixture on the primary test chat for the user's preview.
 page.evaluate('''async name=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}''',names[0]);page.wait_for_timeout(250)
 b.close()
