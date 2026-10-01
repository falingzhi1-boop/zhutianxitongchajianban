"""Dev helper: boot an isolated ST, build the fixture chat, run a JS snippet list and screenshot.
python3 tests/qa/dev_shot.py --base-url http://127.0.0.1:8019 --out /var/tmp/qa/dev --js "..." [--mobile]"""
import argparse, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import zt_common as Z
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser()
ap.add_argument('--base-url', default='http://127.0.0.1:8019')
ap.add_argument('--out', default='/var/tmp/qa/dev')
ap.add_argument('--step', action='append', default=[], help='name=JS (awaited); screenshot after each')
ap.add_argument('--mobile', action='store_true')
ap.add_argument('--no-chat', action='store_true')
a = ap.parse_args()
Z.configure(a.base_url, 'http://127.0.0.1:5001/v1', a.out)
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    ctx = b.new_context(viewport={'width': 390, 'height': 800} if a.mobile else {'width': 1400, 'height': 900}, device_scale_factor=1, has_touch=a.mobile)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    page.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') and ('诸天' in m.text or 'zhutian' in m.text.lower() or 'hub' in m.text.lower()) else None)
    Z.boot(page)
    if not a.no_chat: Z.setup_chat(page)
    for s in a.step:
        name, js = s.split('=', 1)
        try:
            r = page.evaluate('async()=>{' + js + '}')
            print(name, '→', json.dumps(r, ensure_ascii=False)[:1500])
        except Exception as e: print(name, 'ERR', str(e)[:600])
        page.wait_for_timeout(900)
        page.screenshot(path=str(out / f'{name}.png'))
    print('ERRORS', json.dumps(errs, ensure_ascii=False)[:3000])
    b.close()
