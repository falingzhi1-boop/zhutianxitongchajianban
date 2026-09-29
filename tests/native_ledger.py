from playwright.sync_api import sync_playwright,expect
from pathlib import Path
import argparse,json
parser=argparse.ArgumentParser(description='Destructive QA fixtures ONLY. Never use production Tavern.')
parser.add_argument('--isolated-test-only',action='store_true',required=True)
parser.add_argument('--base-url',default='http://127.0.0.1:8010')
args=parser.parse_args();out=Path(__file__).resolve().parents[1]/'docs/evidence';out.mkdir(exist_ok=True)
NAME='结算 QA · 非生产账本'
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox','--disable-webgl'])
 page=b.new_page(viewport={'width':1500,'height':1000},reduced_motion='reduce');errors=[];model=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:model.append(r.url) if '/generate' in r.url else None)
 def ready():page.wait_for_function("()=>{try{return SillyTavern.getContext().eventSource.autoFireLastArgs.has(SillyTavern.getContext().eventTypes.APP_READY)}catch{return false}}",timeout=60000)
 page.goto(args.base_url);ready()
 page.evaluate('''async name=>{const c=SillyTavern.getContext();if(!c.characters.some(x=>x.name===name)){const card={name,description:'独立测试夹具，不是生产角色',first_mes:'【测试夹具，非模型生成】原生结算验收开始。',mes_example:'',personality:'',scenario:''};const fd=new FormData();fd.append('avatar',new Blob([JSON.stringify(card)],{type:'application/json'}),'ledger-qa.json');fd.append('file_type','json');const r=await fetch('/api/characters/import',{method:'POST',headers:c.getRequestHeaders({omitContentType:true}),body:fd});if(!r.ok)throw Error('fixture import failed');await c.getCharacters();}await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}''',NAME)
 page.evaluate('''async()=>{const c=SillyTavern.getContext();c.chat.splice(1);c.chatMetadata.zhutianCovenantTerminal={schema:1,nativeLedgerEnabled:false};c.chatMetadata.variables={其他系统:{不可修改:42},诸天系统:{当前世界:'隔离测试 · 所有余额均为验收夹具',系统点:1000,专属资源:{名望:3000},任务库:{star:{ID:'star',名称:'星门试炼',状态:'进行中',奖励:'灵品回元丹×2，系统点100'}},背包:[],商城库存:[{名称:'凡品止血药',价格:101,品阶:'凡品',分类:'消耗品',效果:'止血。此条目仅用于测试。'},{名称:'月影灵绸',价格:200,品阶:'灵品',分类:'素材',效果:'月光织成的丝线；隔离测试商品。'}]}};const update={ID:'star',名称:'星门试炼',状态:'已完成',结算点数:100,依据:'已完成星门试炼',入包奖励:[{名称:'回元丹',品级:'灵品',数量:2,分类:'消耗品',效果:'恢复体力'}]};c.chat.push({name:'程序构造的验收消息 · 非模型输出',is_user:false,is_system:false,mes:'【测试夹具，非模型输出】我已完成星门试炼。\\n<ZhuTianPanel>\\n任务更新：'+JSON.stringify([update])+'\\n</ZhuTianPanel>',send_date:new Date().toISOString(),extra:{}});await c.saveChat();await c.reloadCurrentChat();}''')
 root=page.locator('#zhutian-covenant-terminal')
 page.locator('#zt-covenant-launcher').click();root.locator('nav [data-page="commerce"]').click()
 expect(root.locator('[data-tx="panel"]')).to_be_disabled()
 root.locator('[data-act="enable-ledger"]').click();expect(root.locator('#toast')).to_contain_text('必须先确认')
 root.locator('#ledger-consent').check()
 page.evaluate("()=>{let e=document.createElement('div');e.id='zt-memory-assistant-v1';document.body.append(e);}")
 root.locator('[data-act="enable-ledger"]').click();expect(root.locator('#toast')).to_contain_text('停用旧')
 page.evaluate("document.getElementById('zt-memory-assistant-v1').remove()")
 root.locator('[data-act="enable-ledger"]').click();expect(root.locator('[data-act="disable-ledger"]')).to_be_visible()
 def balance():return page.evaluate('SillyTavern.getContext().chatMetadata.variables.诸天系统.系统点')
 def receipt_count():return page.evaluate('Object.keys(SillyTavern.getContext().chatMetadata.zhutianCovenantTerminal.ledgerReceipts||{}).length')
 def commit(button):
  root.locator(button).click();expect(root.locator('.settlement-preview')).to_be_visible();root.locator('#transaction-consent').check();root.locator('[data-act="commit-ledger"]').click();expect(root.locator('.settlement-preview')).to_have_count(0,timeout=20000);expect(root.locator('#toast')).to_contain_text('服务器凭据已核实',timeout=20000)
 root.locator('[data-tx="panel"]').click();expect(root.locator('.settlement-preview')).to_be_visible()
 root.locator('[data-act="commit-ledger"]').click();expect(root.locator('#toast')).to_contain_text('勾选执行');assert balance()==1000
 root.locator('#transaction-consent').check();root.locator('[data-act="commit-ledger"]').click();expect(root.locator('.settlement-preview')).to_have_count(0,timeout=20000);expect(root.locator('#toast')).to_contain_text('服务器凭据已核实',timeout=20000);assert balance()==1100
 assert page.evaluate('SillyTavern.getContext().chatMetadata.variables.诸天系统.背包[0].数量')==2
 commit('[data-tx="buy"][data-index="0"]');assert balance()==1002
 expect(root.locator('[data-tx="buy"][data-index="0"]')).to_be_disabled()
 page.screenshot(path=str(out/'commerce-desktop.png'))
 commit('[data-tx="use"][data-index="0"]');commit('[data-tx="use"][data-index="0"]')
 assert page.evaluate('SillyTavern.getContext().chatMetadata.variables.诸天系统.背包.some(x=>x.名称==="回元丹")')==False
 root.locator('[data-tx="panel"]').click();expect(root.locator('#toast')).to_contain_text('已核算');assert balance()==1002
 commit('[data-tx="recycle"][data-index="0"]');assert balance()==1011;assert receipt_count()==5
 root.locator('[data-act="return"]').first.click();expect(page.locator('.zt-ledger-record')).to_have_count(5)
 page.locator('#chat').evaluate('(e)=>e.scrollTop=e.scrollHeight');page.screenshot(path=str(out/'ledger-body.png'))
 assert page.evaluate('SillyTavern.getContext().chatMetadata.variables.其他系统.不可修改')==42
 page.reload();ready();page.evaluate('''async name=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}''',NAME)
 assert balance()==1011 and receipt_count()==5
 page.locator('#zt-covenant-launcher').click();root.locator('nav [data-page="commerce"]').click()
 # Editing an earlier real host message freezes branch-sensitive writes.
 old=page.evaluate('SillyTavern.getContext().chat[0].mes')
 page.evaluate("async()=>{const c=SillyTavern.getContext();c.chat[0].mes+='历史已被改写';await c.saveChat();}")
 root.locator('[data-tx="buy"][data-index="1"]').click();expect(root.locator('#toast')).to_contain_text('分支');assert balance()==1011
 page.evaluate('''async old=>{const c=SillyTavern.getContext();c.chat[0].mes=old;await c.saveChat();}''',old)
 # Fail readback AFTER actual native save; this is deliberate fault injection, not a mock host.
 calls=[0]
 def read_fault(route):
  calls[0]+=1
  if calls[0]==2:route.fulfill(status=503,content_type='application/json',body='{"isolated_fault":true}')
  else:route.continue_()
 root.locator('[data-tx="buy"][data-index="1"]').click();expect(root.locator('.settlement-preview')).to_be_visible()
 page.route('**/api/chats/get',read_fault);root.locator('#transaction-consent').check();root.locator('[data-act="commit-ledger"]').click();expect(root.locator('#toast')).to_contain_text('已冻结交易',timeout=20000)
 assert balance()==1011 # no speculative in-memory success before server verification
 root.locator('[data-tx="buy"][data-index="1"]').click();expect(root.locator('#toast')).to_contain_text('冻结')
 page.unroute('**/api/chats/get');page.reload();ready();page.evaluate('''async name=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}''',NAME)
 assert balance()==817 and receipt_count()==6 # saved exactly once despite a missing acknowledgement
 page.locator('#zt-covenant-launcher').click();root.locator('nav [data-page="commerce"]').click();expect(root.locator('[data-tx="buy"][data-index="1"]')).to_be_disabled()
 page.set_viewport_size({'width':390,'height':844});assert not root.locator('#content').evaluate('(e)=>e.scrollWidth>e.clientWidth');page.screenshot(path=str(out/'commerce-mobile.png'))
 assert not errors,errors;assert not model,model
 result={'host':'SillyTavern 1.19.0','extension':'0.2.0','source':'real isolated host; fixture replies explicitly NOT model generated','pageErrors':errors,'modelRequests':model,'receiptsOnDisk':6,'balanceOnDisk':817,'cases':['default off','explicit backup/legacy stop consent','legacy actor detected','payment confirmation required','original task points and physical rewards','original reputation discount','one sold flag','consume one at a time','no item reaward after consumption','original recycle price','system receipts in normal chat','foreign variables unchanged','reload persistence','earlier history edit freezes ledger','missing readback freezes without retry','reload recovers single committed receipt','mobile commerce no overflow'],'faultInjection':'Second /api/chats/get returned503 after real /api/chats/save succeeded. No model or host context mocks.'}
 (out/'native-ledger.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
