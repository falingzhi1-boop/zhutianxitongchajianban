// 1.1.4: 说明书 — the full manual (docs/MANUAL.md, shipped with the extension) inside the terminal.
// Read-only: it fetches the file from the extension folder, renders a small, safe Markdown subset (every piece of
// text is escaped first; no raw HTML from the file reaches the page), and offers a table of contents and a search.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Inline Markdown on an ALREADY escaped line: `code`, **bold**, [text](#anchor | https://…). */
function inline(s) {
    return s
        .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
            const h = href.replace(/&amp;/g, '&');
            if (h.startsWith('#')) return `<a href="${esc(h)}" data-anchor="${esc(h.slice(1))}">${t}</a>`;
            if (/^https:\/\//.test(h)) return `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${t}</a>`;
            return t;   // relative file links (docs/…) are shown as plain text inside the terminal
        });
}
export const slug = (text, used) => {
    let base = String(text).replace(/<[^>]+>/g, '').replace(/[`*]/g, '').trim().toLowerCase().replace(/[\s·、，。：:（）()「」『』/\\?？!！]+/g, '-').replace(/^-+|-+$/g, '') || 'sec';
    let id = base, n = 1; while (used.has(id)) id = `${base}-${++n}`; used.add(id); return id;
};

/** Markdown subset → { html, toc, sections } (pure). Sections = text of each ## block, for the search. */
export function renderManual(md) {
    const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [], toc = [], used = new Set();
    let i = 0, para = [], list = null, section = -1;
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(t => `<li>${t}</li>`).join('')}</${list.tag}>`); list = null; } };
    const flush = () => { flushPara(); flushList(); };
    while (i < lines.length) {
        const raw = lines[i], line = raw.trimEnd();
        if (/^```/.test(line)) {
            flush(); const body = []; i++;
            while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
            out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`); i++; continue;
        }
        const h = /^(#{1,4})\s+(.+)$/.exec(line);
        if (h) {
            flush(); const level = h[1].length, text = inline(esc(h[2])), id = slug(h[2], used);
            if (level === 2) { section++; out.push(`</div><div class="zt-man-sec" data-sec="${section}">`); toc.push({ id, text: h[2].replace(/[`*]/g, '') }); }
            out.push(`<h${level + 1} id="man-${id}">${text}</h${level + 1}>`); i++; continue;
        }
        if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
        if (/^\|.*\|$/.test(line.trim()) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
            flush(); const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(esc(c.trim())));
            const head = cells(line); i += 2; const rows = [];
            while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) rows.push(cells(lines[i++]));
            out.push(`<div class="zt-man-table"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
            continue;
        }
        if (/^>\s?/.test(line)) {
            flush(); const body = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
            out.push(`<blockquote>${inline(esc(body.join(' ')))}</blockquote>`); continue;
        }
        const li = /^(\s*)([-*]|\d+[.)])\s+(.+)$/.exec(raw);
        if (li) {
            flushPara(); const tag = /\d/.test(li[2]) ? 'ol' : 'ul', deep = li[1].length >= 2;
            if (!list || (list.tag !== tag && !deep)) { flushList(); list = { tag, items: [] }; }
            const item = inline(esc(li[3]));
            if (deep && list.items.length) list.items[list.items.length - 1] += `<div class="zt-man-sub">· ${item}</div>`; else list.items.push(item);
            i++; continue;
        }
        if (!line.trim()) { flush(); i++; continue; }
        flushList(); para.push(line.trim()); i++;
    }
    flush();
    const html = `<div class="zt-man-sec" data-sec="-1">${out.join('')}</div>`;
    return { html, toc };
}

export class HubManual {
    constructor(app) { this.app = app; this.md = null; this.error = ''; }
    get hub() { return this.app.hub; }
    start() {
        const hub = this.hub; if (!hub) return this;
        hub.addNav('终端', 'man', '说明书', 'book', { title: '说明书', render: el => this.render(el) });
        return this;
    }
    dispose() { /* the hub removes its pages and buttons */ }
    url() { return String(this.app.base || '') + 'docs/MANUAL.md'; }
    async load() {
        if (this.md != null) return this.md;
        const r = await fetch(this.url(), { cache: 'no-cache' });
        if (!r.ok) throw new Error(`读取说明书失败（HTTP ${r.status}）`);
        this.md = await r.text(); return this.md;
    }
    async render(el) {
        if (!el) return;
        if (this.md == null) el.innerHTML = '<div class="zt-card"><h3>说明书</h3><p class="zt-muted">正在读取 docs/MANUAL.md …</p></div>';
        let md;
        try { md = await this.load(); this.error = ''; }
        catch (e) { this.error = e.message; el.innerHTML = `<div class="zt-card"><h3>说明书</h3><p>${esc(e.message)}</p><p class="zt-muted">说明书文件随插件一起安装，在插件文件夹的 docs/MANUAL.md，也可以直接用文本编辑器打开。</p></div>`; return; }
        const { html, toc } = renderManual(md);
        el.innerHTML = `<div class="zt-man">
            <div class="zt-man-bar"><input type="search" class="zt-man-q" placeholder="搜索功能 / 按钮，例如：重roll、解冻、红包" aria-label="搜索说明书"><span class="zt-man-hit"></span></div>
            <details class="zt-man-toc" open><summary>目录（${toc.length} 章）</summary><ul>${toc.map(t => `<li><a href="#man-${esc(t.id)}" data-anchor="${esc(t.id)}">${esc(t.text)}</a></li>`).join('')}</ul></details>
            <article class="zt-man-body">${html}</article></div>`;
        const body = el.querySelector('.zt-man-body'), q = el.querySelector('.zt-man-q'), hit = el.querySelector('.zt-man-hit');
        el.addEventListener('click', e => {
            const a = e.target.closest('a[data-anchor]'); if (!a) return;
            e.preventDefault(); const t = el.querySelector(`#man-${CSS.escape(a.dataset.anchor)}`);
            if (t) { const sec = t.closest('.zt-man-sec'); if (sec) sec.hidden = false; t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        });
        q.addEventListener('input', () => {
            const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
            let n = 0; body.querySelectorAll('.zt-man-sec').forEach(s => {
                const yes = !words.length || words.every(w => s.textContent.toLowerCase().includes(w));
                s.hidden = !yes; if (yes && words.length && s.dataset.sec !== '-1') n++;
            });
            hit.textContent = words.length ? (n ? `${n} 章相关` : '没有找到，换个词试试') : '';
        });
    }
}
