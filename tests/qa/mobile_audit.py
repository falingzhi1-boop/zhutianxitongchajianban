"""Dev helper: walk every terminal page on phone viewports and report layout problems (isolated ST + mock model only).

  python3 tests/qa/mobile_audit.py --base-url http://127.0.0.1:8019 --out /var/tmp/qa/mobile [--viewport 390x844] [--page ov]

For each viewport and page it records: horizontal overflow, elements sticking out of the screen, tap targets under
the minimum size, text under 12px and inputs under 16px (iOS zooms the page when such an input gets focus).
Screenshots go to --out. This is a measuring tool, not a pass/fail suite; tests/native_v090.py holds the gates.
"""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import zt_common as Z
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base-url', default='http://127.0.0.1:8019')
ap.add_argument('--out', default='/var/tmp/qa/mobile')
ap.add_argument('--viewport', action='append', default=[])
ap.add_argument('--page', action='append', default=[])
ap.add_argument('--min-tap', type=int, default=32)
a = ap.parse_args()
Z.configure(a.base_url, 'http://127.0.0.1:5001/v1', a.out)
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
VIEWPORTS = [tuple(map(int, v.split('x'))) for v in (a.viewport or ['390x844', '360x640', '844x390'])]

MEASURE = r'''([minTap]) => {
  const app = globalThis.__zhutianApp, sh = app.hub.shadow, vw = innerWidth, vh = innerHeight, res = {};
  const vis = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return null; return r; };
  const name = el => (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ':' + (el.getAttribute('aria-label') || el.title || el.textContent || el.value || '').trim().slice(0, 18);
  // inside a horizontally scrolling strip (nav, chips) sticking out is intended
  const inScroller = (el, root) => { for (let p = el.parentElement; p && p !== root; p = p.parentElement) { const s = getComputedStyle(p); if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
  const scan = (root, offX, offY, frameW, tag) => {
    const out = { overflowX: [], offscreen: [], smallTap: [], tinyText: 0, tinyTextSample: [], zoomInputs: [] };
    for (const el of root.querySelectorAll('*')) {
      const r = vis(el); if (!r) continue;
      const left = r.left + offX, right = r.right + offX, top = r.top + offY;
      const s = getComputedStyle(el);
      if ((s.overflowX === 'visible' || s.overflowX === 'auto') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && !['NAV'].includes(el.tagName) && s.overflowX !== 'auto' && !el.matches('svg,svg *,canvas')) out.overflowX.push(name(el) + ` ${el.scrollWidth}>${el.clientWidth}`);
      if ((right > Math.min(vw, offX + frameW) + 2 || left < offX - 2) && !inScroller(el, root) && !el.closest('.zt-world-deco,.zt-deco,[aria-hidden=true]')) out.offscreen.push(name(el) + ` [${Math.round(left)},${Math.round(right)}]`);
      if (el.matches('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],label.switch') && top < vh && top > -40) {
        if ((r.height < minTap || r.width < minTap) && !(el.matches('input[type=checkbox],input[type=radio]') && el.closest('label'))) out.smallTap.push(name(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]),select,textarea') && parseFloat(s.fontSize) < 16) out.zoomInputs.push(name(el) + ' ' + s.fontSize);
      if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(s.fontSize) < 12) { out.tinyText++; if (out.tinyTextSample.length < 6) out.tinyTextSample.push(name(el) + ' ' + s.fontSize); }
    }
    for (const k of ['overflowX', 'offscreen', 'smallTap', 'zoomInputs']) { out[k + 'Count'] = out[k].length; out[k] = out[k].slice(0, 12); }
    return out;
  };
  const d = app.hub.shell.dialog, dr = d.getBoundingClientRect();
  res.vw = vw; res.vh = vh; res.page = app.hub.page; res.dialog = [Math.round(dr.left), Math.round(dr.top), Math.round(dr.width), Math.round(dr.height)];
  res.compact = d.dataset.compact; res.portrait = d.dataset.portrait;
  const ps = sh.querySelector('.page-scroll'); res.pageScroll = ps ? { sw: ps.scrollWidth, cw: ps.clientWidth, sh: ps.scrollHeight, ch: ps.clientHeight } : null;
  const nav = app.hub.shell.nav; if (nav) { const nr = nav.getBoundingClientRect(); res.nav = [Math.round(nr.width), Math.round(nr.height), nav.scrollWidth]; }
  const main = app.hub.shell.main; if (main) { const mr = main.getBoundingClientRect(); res.main = [Math.round(mr.top), Math.round(mr.height)]; }
  res.shadow = scan(sh, 0, 0, vw, 'shadow');
  const f = app.hub.engineFrame; if (f && f.isConnected && f.getBoundingClientRect().width && app.hub.page === 'zt-engine' || (f && f.closest('[hidden]') == null && f.getBoundingClientRect().width > 0)) {
    const fr = f.getBoundingClientRect(); res.frame = [Math.round(fr.width), Math.round(fr.height)];
    try { res.engine = scan(f.contentDocument, fr.left, fr.top, fr.width, 'engine'); res.engine.docOverflow = f.contentDocument.documentElement.scrollWidth - f.contentDocument.documentElement.clientWidth; } catch (e) { res.engine = String(e); }
  }
  return res;
}'''

PAGES = r'''() => { const sh = globalThis.__zhutianApp.hub.shadow; return [...new Set([...sh.querySelectorAll('.nav-button[data-page]')].map(b => b.dataset.page))]; }'''

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    report = {}
    for (w, h) in VIEWPORTS:
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, has_touch=True, is_mobile=True,
                            user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36')
        page = ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)[:300]))
        Z.boot(page); Z.setup_chat(page)
        page.evaluate("()=>globalThis.__zhutianApp.openTerminal('ov')"); page.wait_for_timeout(1800)
        pages = a.page or page.evaluate(PAGES)
        tag = f'{w}x{h}'; report[tag] = {}
        for pg in pages:
            page.evaluate("(p)=>globalThis.__zhutianApp.hub.go(p)", pg); page.wait_for_timeout(1500)
            try: r = page.evaluate(MEASURE, [a.min_tap])
            except Exception as e: r = {'error': str(e)[:300]}
            report[tag][pg] = r
            page.screenshot(path=str(out / f'{tag}-{pg}.png'))
        report[tag]['_errors'] = errs
        ctx.close()
    b.close()
(out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), 'utf-8')
for tag, pages in report.items():
    print('==', tag, 'errors:', pages.get('_errors'))
    for pg, r in pages.items():
        if pg == '_errors': continue
        if 'error' in r: print(f'  {pg}: ERROR {r["error"]}'); continue
        s = r['shadow']; e = r.get('engine') if isinstance(r.get('engine'), dict) else {}
        print(f"  {pg:10s} dlg={r['dialog']} cmp={r['compact']} nav={r.get('nav')} main={r.get('main')} ps={r['pageScroll']} | "
              f"S ovf={s['overflowXCount']} off={s['offscreenCount']} tap={s['smallTapCount']} tiny={s['tinyText']} zoom={s['zoomInputsCount']}"
              + (f" | E ovf={e.get('overflowXCount')} off={e.get('offscreenCount')} tap={e.get('smallTapCount')} tiny={e.get('tinyText')} zoom={e.get('zoomInputsCount')} doc={e.get('docOverflow')}" if e else ''))
