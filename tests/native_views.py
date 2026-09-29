from playwright.sync_api import sync_playwright,expect
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
 b=p.chromium.launch(args=['--no-sandbox','--disable-webgl'])
 page=b.new_page(viewport={'width':390,'height':844},reduced_motion='reduce');errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
 page.add_init_script('window.__ztTestBase='+json.dumps('/scripts/extensions/third-party/'+args.extension_folder))
 page.goto(args.base_url.rstrip('/')+'/');page.wait_for_function("typeof SillyTavern !== 'undefined' && SillyTavern.getContext().eventSource.autoFireLastArgs.has(SillyTavern.getContext().eventTypes.APP_READY)",timeout=60000)
 page.evaluate("async()=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name==='莉莉丝 · 隔离验收'));}")
 page.locator('#zt-covenant-launcher').click();root=page.locator('#zhutian-covenant-terminal');views={}
 for name in ['home','book','ledger','interact','commerce','memory','diagnostics']:
  root.locator(f'nav [data-page="{name}"]').click()
  overflow=root.locator('#content').evaluate('(e)=>e.scrollWidth>e.clientWidth')
  assert not overflow,(name,overflow)
  views[name]={'noHorizontalOverflow':not overflow}
 root.locator('nav [data-page="book"]').click();assert root.locator('#book-list details').count()==35
 root.locator('#rule-search').fill('没有这种规则-验收');expect(root.locator('#book-list')).to_contain_text('没有匹配');root.locator('#rule-search').fill('');assert root.locator('#book-list details').count()==35
 root.locator('nav [data-page="ledger"]').click();root.locator('[data-task-discuss]').first.click();expect(root.locator('#action-text')).to_contain_text('验证正文互动')
 root.locator('nav [data-page="ledger"]').click();root.locator('[data-item-discuss]').first.click();expect(root.locator('#action-text')).to_contain_text('不消耗')
 root.locator('.top [data-act="portrait"]').click();page.wait_for_timeout(500);assert root.locator('.zt-stage').get_attribute('data-renderer')=='static'
 assert root.locator('.zt-stage .zt-media > img').first.is_visible()
 root.locator('.top [data-act="portrait"]').click();root.locator('nav [data-page="interact"]').click();root.locator('#action-text').fill('必须明确确认才能发送')
 root.locator('[data-act="preview"]').click();before=page.evaluate('SillyTavern.getContext().chat.length');root.locator('[data-act="send"]').click();assert page.evaluate('SillyTavern.getContext().chat.length')==before;expect(root.locator('#interaction-status')).to_contain_text('勾选确认')
 root.locator('#action-text').fill('聚焦中的旧聊天草稿');root.locator('#action-text').focus()
 page.evaluate("async()=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name==='叶清寒 · 隔离验收'));}")
 expect(root.locator('#action-text')).to_have_value('')
 page.evaluate("async()=>{const m=await import(window.__ztTestBase+'/index.js');m.deactivate();m.activate();m.deactivate();m.activate();}")
 expect(page.locator('#zt-covenant-launcher')).to_have_count(1);expect(page.locator('#zhutian-covenant-terminal')).to_have_count(1)
 assert not errs,errs
 result={'host':'SillyTavern 1.19.0','viewport':'390x844','mobileViews':views,'builtinRules':35,'tests':['all seven mobile views','worldbook search','task to unsent player draft','inventory to unsent observation draft','WebGL unavailable original-art fallback','focused draft cleared on chat switch','launcher works from initial mobile load','missing consent blocks send','rapid disable/enable lifecycle'],'pageErrors':errs}
 (ARTIFACTS/'views.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
