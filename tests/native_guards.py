from playwright.sync_api import sync_playwright
from pathlib import Path
import json

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
 b=p.chromium.launch(args=['--no-sandbox'])
 page=b.new_page();errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:requests.append(r.url) if '/generate' in r.url else None)
 page.add_init_script('window.__ztTestBase='+json.dumps('/scripts/extensions/third-party/'+args.extension_folder))
 page.goto(args.base_url.rstrip('/')+'/')
 page.wait_for_function("typeof SillyTavern !== 'undefined' && SillyTavern.getContext().eventSource.autoFireLastArgs.has(SillyTavern.getContext().eventTypes.APP_READY)",timeout=60000)
 page.evaluate("async()=>{let c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name==='莉莉丝 · 隔离验收'));const {HostAdapter}=await import(window.__ztTestBase+'/src/host-adapter.js');const {default:original}=await import(window.__ztTestBase+'/vendor/original/runtime.js');window.__qaAdapter=new HostAdapter(original);await __qaAdapter.start();}")
 def run(expr):return page.evaluate(expr)
 # Block attachments: native attachment input contains a real File, but no upload/send is allowed.
 page.locator('#file_form_input').set_input_files({'name':'isolated-test.txt','mimeType':'text/plain','buffer':b'ISOLATED TEST FILE - MUST NOT UPLOAD'})
 attachment=run("async()=>{let n=SillyTavern.getContext().chat.length;try{await __qaAdapter.send(__qaAdapter.draft('莉莉丝','附件阻断测试'));return {blocked:false};}catch(e){return {blocked:e.message.includes('附件'),unchanged:n===SillyTavern.getContext().chat.length};}}")
 assert attachment=={'blocked':True,'unchanged':True},attachment
 page.locator('#file_form_input').set_input_files([])
 # A genuine host edit event invalidates a previous draft even when the final message has not changed.
 stale=run("async()=>{const d=__qaAdapter.draft('莉莉丝','过期预览');const c=SillyTavern.getContext();await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED,0);try{await __qaAdapter.send(d);return false;}catch(e){return e.message.includes('聊天或正文已变化');}}")
 assert stale
 # Main generation lock; emit the host lifecycle event without making a paid generation call.
 generation=run("async()=>{const c=SillyTavern.getContext();await c.eventSource.emit(c.eventTypes.GENERATION_STARTED,'normal',{},false);try{await __qaAdapter.send(__qaAdapter.draft('莉莉丝','生成期间拒绝发送'));return false;}catch(e){return e.message.includes('正在生成');}finally{await c.eventSource.emit(c.eventTypes.GENERATION_ENDED);}}")
 assert generation
 duplicate=run("""async()=>{const c=SillyTavern.getContext(),n=c.chat.length;const d=__qaAdapter.draft('莉莉丝','安全验收：{{user}} <img src=x onerror="window.__qaExecuted=true">');const a=__qaAdapter.send(d);let concurrent=false,reused=false;try{await __qaAdapter.send(d);}catch(e){concurrent=true;}const result=await a;try{await __qaAdapter.send(d);}catch(e){reused=e.message.includes('重复发送');}return {concurrent,reused,onlyOne:c.chat.length===n+1,inert:!result.message.mes.includes('{{')&&!result.message.mes.includes('<img'),executed:!!window.__qaExecuted};}""")
 assert duplicate=={'concurrent':True,'reused':True,'onlyOne':True,'inert':True,'executed':False},duplicate
 # Deliberately fail only the read-back acknowledgement. Native host send/save stays real.
 page.route('**/api/chats/get',lambda route:route.fulfill(status=503,content_type='application/json',body='{"isolated_fault_injection":true}'))
 failedReceipt=run("""async()=>{const c=SillyTavern.getContext(),n=c.chat.length;const d=__qaAdapter.draft('莉莉丝','隔离故障注入：保存核验失败时不得自动重发。');let ambiguous=false,reused=false;try{await __qaAdapter.send(d);}catch(e){ambiguous=e.message.includes('无法核实');}try{await __qaAdapter.send(d);}catch(e){reused=e.message.includes('重复发送');}return {ambiguous,reused,onlyOne:c.chat.length===n+1};}""")
 assert failedReceipt=={'ambiguous':True,'reused':True,'onlyOne':True},failedReceipt
 page.unroute('**/api/chats/get')
 run('()=>{__qaAdapter.dispose();delete window.__qaAdapter;}')
 result={'realHost':'SillyTavern 1.19.0','pageErrors':errors,'modelRequests':requests,'cases':{'pendingAttachmentRejected':attachment,'editedHistoryInvalidatesDraft':stale,'generationLockViaRealLifecycleEvent':generation,'duplicateAndMarkup':duplicate,'readbackFailureNoAutomaticRetry':failedReceipt},'faultInjection':'Only /api/chats/get readback was made to return HTTP503 for the failure test. sendMessageAsUser, context, chat persistence were not mocked.'}
 (ARTIFACTS/'guards.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
