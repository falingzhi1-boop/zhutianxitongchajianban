"""1.1.1 phone: the docked Lilith avatar must sit inside the terminal / 私聊 header, below the phone status bar.
Disposable SillyTavern only; the status bar is emulated with CDP Emulation.setSafeAreaInsetsOverride (NOT a real phone).
python tests/native_v111_mobile.py --isolated-test-only --base-url http://127.0.0.1:8019
"""
import argparse, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent/'qa'))
import zt_common as Z
ap=argparse.ArgumentParser();ap.add_argument('--isolated-test-only',action='store_true',required=True);ap.add_argument('--base-url',default='http://127.0.0.1:8019');ap.add_argument('--output',default='/tmp/zt-v111-mobile');args=ap.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);Z.configure(args.base_url,'http://127.0.0.1:5001/v1',out)
results=[]
def ok(name,cond,detail=''):
    results.append({'name':name,'pass':bool(cond),'detail':str(detail)[:400]});print(('PASS ' if cond else 'FAIL ')+name+' '+str(detail)[:400],flush=True)
MEASURE="""()=>{const sh=__zhutianApp.assistant.shadow,d=sh.querySelector('dialog'),e=sh.getElementById('entry'),chat=sh.getElementById('lc-panel');
  const inD=d.open,chatOn=!!chat&&!chat.hidden,head=chatOn?sh.getElementById('lc-head'):sh.getElementById('drag-handle');
  const pr=document.createElement('div');pr.style.cssText='position:fixed;left:0;top:0;width:env(safe-area-inset-left,0px);height:env(safe-area-inset-top,0px)';document.body.append(pr);const ins=pr.getBoundingClientRect();pr.remove();
  const R=x=>{if(!x)return null;const r=x.getBoundingClientRect();return {left:Math.round(r.left),top:Math.round(r.top),right:Math.round(r.right),bottom:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)}};
  const er=e.getBoundingClientRect(),hit=sh.elementFromPoint(er.left+er.width/2,er.top+er.height/2);
  const title=chatOn?null:sh.getElementById('title');
  return {mobile:d.dataset.ztMobile||'',docked:e.dataset.docked,inDialog:inD,chatOpen:!!chat&&!chat.hidden,inset:{top:Math.round(ins.height),left:Math.round(ins.width)},
    entry:R(e),head:R(head),title:R(title),transform:e.style.transform||'',hitIsEntry:!!hit&&(hit===e||e.contains(hit))}}"""
def inside(m):
    e,h=m['entry'],m['head']
    return e and h and e['top']>=m['inset']['top'] and e['top']>=h['top']-1 and e['bottom']<=h['bottom']+1 and e['left']>=m['inset']['left']
def centred(m):
    e,h=m['entry'],m['head'];return abs((e['top']+e['bottom'])/2-(h['top']+h['bottom'])/2)<=2
def no_overlap_title(m):
    e,t=m['entry'],m['title'];return not t or e['right']<=t['left']+1
def run(p,name,viewport,touch,insets):
    b=p.chromium.launch(headless=True,args=['--no-sandbox'])
    ctx=b.new_context(viewport=viewport,device_scale_factor=2 if touch else 1,is_mobile=touch,has_touch=touch);page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    s=ctx.new_cdp_session(page)
    if insets: s.send('Emulation.setSafeAreaInsetsOverride',{'insets':insets})
    Z.boot(page);Z.setup_chat(page);page.wait_for_timeout(1500)
    page.evaluate("()=>{const s=__zhutianApp.settings;s.set('floatLilith','off');s.set('mobileLayout','auto');__zhutianApp.mobile?.apply();}")
    page.evaluate("__zhutianApp.openTerminal('ov')");page.wait_for_timeout(2200)
    m=page.evaluate(MEASURE);page.screenshot(path=str(out/f'{name}-terminal.png'),clip={'x':0,'y':0,'width':viewport['width'],'height':min(220,viewport['height'])})
    res={'terminal':m,'errors':errors}
    if touch:
        # tap the avatar = open 私聊 (original behaviour) — it must be reachable and then dock in the 私聊 header
        page.evaluate("()=>__zhutianApp.assistant.shadow.getElementById('entry').click()");page.wait_for_timeout(1500)
        c=page.evaluate(MEASURE);page.screenshot(path=str(out/f'{name}-private.png'),clip={'x':0,'y':0,'width':viewport['width'],'height':min(220,viewport['height'])})
        res['private']=c
        # back to the terminal (close the 私聊 sheet), then the touch floating window
        page.evaluate("()=>{const sh=__zhutianApp.assistant.shadow;sh.getElementById('lc-back')?.click();}");page.wait_for_timeout(1200)
        res['back']=page.evaluate(MEASURE)
        page.evaluate("()=>{__zhutianApp.settings.set('mobileLayout','window');__zhutianApp.mobile?.apply();}");page.wait_for_timeout(1500)
        res['float']=page.evaluate(MEASURE);page.screenshot(path=str(out/f'{name}-float.png'))
        page.evaluate("()=>{__zhutianApp.settings.set('mobileLayout','auto');__zhutianApp.mobile?.apply();}");page.wait_for_timeout(1500)
    b.close();return res
with sync_playwright() as p:
    r=run(p,'port-statusbar',{'width':360,'height':780},True,{'top':40,'bottom':20})
    m=r['terminal'];ok('phone portrait + 40px status bar: full-screen terminal, avatar docked',m['mobile']=='port' and m['docked']=='true' and m['inset']['top']==40,m)
    ok('avatar completely below the status bar and inside the header',inside(m),{'entry':m['entry'],'head':m['head']})
    ok('avatar centred on the header and left of the title',centred(m) and no_overlap_title(m),{'entry':m['entry'],'title':m['title']})
    ok('a tap at the avatar centre hits the avatar',m['hitIsEntry'])
    c=r['private'];ok('tap opens 私聊; avatar docks below the status bar in the 私聊 header',c['chatOpen'] and c['docked']=='true' and inside(c) and centred(c) and c['hitIsEntry'],{'entry':c['entry'],'head':c['head'],'hit':c['hitIsEntry']})
    k=r['back'];ok('closing 私聊 puts the avatar back into the terminal header',not k['chatOpen'] and k['inDialog'] and inside(k) and centred(k) and k['hitIsEntry'],{'entry':k['entry'],'head':k['head']})
    f=r['float'];ok('touch floating window: avatar docked inside the floating window header',f['mobile']=='' and f['docked']=='true' and inside(f) and centred(f),{'entry':f['entry'],'head':f['head']})
    ok('no page errors (portrait)',not r['errors'],r['errors'][:2])
    r=run(p,'port-plain',{'width':360,'height':780},True,None)
    m=r['terminal'];ok('phone without status-bar inset: avatar still in the header',m['mobile']=='port' and inside(m) and centred(m),{'entry':m['entry'],'head':m['head']})
    r=run(p,'land-notch',{'width':780,'height':360},True,{'top':0,'left':36,'right':36,'bottom':12})
    m=r['terminal'];ok('phone landscape + 36px side notch: avatar in the header, right of the notch',m['mobile']=='land' and inside(m) and m['entry']['left']>=36,{'entry':m['entry'],'head':m['head'],'inset':m['inset']})
    r=run(p,'desktop',{'width':1280,'height':860},False,None)
    m=r['terminal'];ok('desktop window: avatar in the header, centred, left of the title (at most a few px from before)',m['mobile']=='' and inside(m) and centred(m) and no_overlap_title(m),{'entry':m['entry'],'head':m['head'],'transform':m['transform']})
    ok('no page errors (desktop)',not r['errors'],r['errors'][:2])
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=1),'utf8')
n=sum(x['pass'] for x in results);print(f'{n}/{len(results)} passed');sys.exit(0 if n==len(results) else 1)
