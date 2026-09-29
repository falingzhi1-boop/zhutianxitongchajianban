from playwright.sync_api import sync_playwright,expect
from pathlib import Path
import argparse,json
parser=argparse.ArgumentParser(description='Run after native_ledger.py on disposable QA fixtures only.')
parser.add_argument('--isolated-test-only',action='store_true',required=True);parser.add_argument('--base-url',default='http://127.0.0.1:8010');args=parser.parse_args()
out=Path(__file__).resolve().parents[1]/'docs/evidence'
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox','--disable-webgl']);context=b.new_context(reduced_motion='reduce');pages=[context.new_page(),context.new_page()];errors=[]
 def setup(page):
  page.on('pageerror',lambda e:errors.append(str(e)));page.goto(args.base_url);page.wait_for_function("()=>{try{return SillyTavern.getContext().eventSource.autoFireLastArgs.has(SillyTavern.getContext().eventTypes.APP_READY)}catch{return false}}",timeout=60000)
  page.evaluate("async()=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name==='结算 QA · 非生产账本'));}");page.locator('#zt-covenant-launcher').click();page.locator('#zhutian-covenant-terminal nav [data-page="commerce"]').click()
 for page in pages:setup(page)
 a,z=pages;ra=a.locator('#zhutian-covenant-terminal');rz=z.locator('#zhutian-covenant-terminal')
 def persisted_count(page):return page.evaluate("async()=>{const c=SillyTavern.getContext();const r=await fetch('/api/chats/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar_url:c.characters[c.characterId].avatar,file_name:c.getCurrentChatId()})});const d=await r.json();return Object.keys(d[0].chat_metadata.zhutianCovenantTerminal.ledgerReceipts||{}).length;}")
 before=persisted_count(a)
 # Same-origin tab lock: held lock blocks a second tab before any write.
 a.evaluate("()=>{const c=SillyTavern.getContext();const id=c.characters[c.characterId].avatar+'/'+c.getCurrentChatId();void navigator.locks.request('zhutian-ledger:'+id,()=>new Promise(r=>{window.__qaRelease=r;window.__qaLocked=true;}));}");a.wait_for_function('window.__qaLocked===true')
 rz.locator('[data-tx="use"][data-index="0"]').click();rz.locator('#transaction-consent').check();rz.locator('[data-act="commit-ledger"]').click();expect(rz.locator('#toast')).to_contain_text('其他标签');assert persisted_count(a)==before;a.evaluate('window.__qaRelease()')
 # Both tabs preview the same snapshot. The second cannot overwrite the first committed receipt.
 for root in [ra,rz]:root.locator('[data-tx="use"][data-index="0"]').click();expect(root.locator('.settlement-preview')).to_be_visible()
 ra.locator('#transaction-consent').check();ra.locator('[data-act="commit-ledger"]').click();expect(ra.locator('#toast')).to_contain_text('服务器凭据已核实',timeout=15000)
 rz.locator('#transaction-consent').check();rz.locator('[data-act="commit-ledger"]').click();expect(rz.locator('#toast')).to_contain_text('存档与预览不一致');assert persisted_count(a)==before+1
 # Switch to another real chat after the disk write but before the save response is delivered.
 ra.locator('[data-tx="use"][data-index="0"]').click();expect(ra.locator('.settlement-preview')).to_be_visible()
 def switching(route):
  response=route.fetch()
  a.evaluate("async()=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name==='叶清寒 · 隔离验收'));}")
  route.fulfill(response=response)
 a.route('**/api/chats/save',switching);ra.locator('#transaction-consent').check();ra.locator('[data-act="commit-ledger"]').click();expect(ra.locator('#toast')).to_contain_text('原聊天已保存并核实',timeout=20000);a.unroute('**/api/chats/save')
 assert a.evaluate('SillyTavern.getContext().name2')=='叶清寒 · 隔离验收'
 assert a.evaluate('SillyTavern.getContext().chat.some(m=>m.extra?.zhutianCovenantTerminal?.kind==="ledger-receipt")')==False
 a.evaluate("async()=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name==='结算 QA · 非生产账本'));}");assert persisted_count(a)==before+2
 assert not errors,errors
 result={'host':'SillyTavern 1.19.0','extension':'0.2.0','tests':['same-origin Web Lock rejects competing tab without writing','stale second-tab preview cannot overwrite first receipt','captured save target survives mid-response real chat switch; no metadata injected into other chat'],'pageErrors':errors,'receiptCountBefore':before,'receiptCountAfter':before+2,'transportNote':'For chat-switch test route.fetch performs the real save; its response is delayed until a real selectCharacterById call completes.'}
 (out/'native-ledger-guards.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
