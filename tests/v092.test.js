// 0.9.2: fixes from the first real-phone session — 【莉莉丝】 shown twice (raw + card) and raw data-block lines in the
// floor when another extension had touched SillyTavern's render; 莉莉丝：… inside code blocks left alone.
// The DOM side (swapContent / stText) is covered in the browser by tests/native_v092.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitCode, extractVoices, hasVoice } from '../src/voice-box.js';
import { consumedSnippets } from '../src/statusbar-host.js';
import { CAPABILITIES } from '../src/contracts.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('splitCode: prose / code alternate; fenced blocks (``` and ~~~), script, style, textarea, pre; unclosed fence runs to the end', () => {
    const s = 'a\n```html\n<b>莉莉丝：x</b>\n```\nb <script>莉莉丝：y</script> c\n~~~\nz\n~~~\nd';
    const parts = splitCode(s);
    assert.equal(parts.join(''), s, 'lossless');
    assert.deepEqual(parts.filter((_, i) => i % 2).map(p => p.trim().slice(0, 7)), ['```html', '<script', '~~~\nz\n~']);
    assert.equal(splitCode('x\n```\nopen').length, 3);
    assert.equal(splitCode('no code').length, 1);
});
test('extractVoices: lines inside code are not dialogue; prose lines still become cards in order', () => {
    const s = '【莉莉丝】："外一"\n\n```html\n<div>莉莉丝：在代码里</div>\n```\n\n莉莉丝：“外二”\n<style>.x{content:"莉莉丝：内"}</style>';
    const r = extractVoices(s);
    assert.deepEqual(r.voices.map(v => v.text), ['外一', '外二']);
    assert.match(r.text, /```html\n<div>莉莉丝：在代码里<\/div>\n```/, 'code untouched');
    assert.match(r.text, /^ZTVOICESLOT0ZT/);
    assert.equal(hasVoice('```\n莉莉丝：“只在代码里”\n```'), false);
    assert.equal(hasVoice('前文\n\n莉莉丝：“你好”'), true);
});
test('consumedSnippets: voice text alone; data-block lines as a group that needs two hits', () => {
    const g = consumedSnippets([{ text: ' 主人，痴傻十八年的少主一夜痊愈，接下来还有什么 ' }, { text: '嗯' }], ['\n系统点: 6600\n子系统: 0\n好感度: 0\n乱七八糟\n']);
    assert.deepEqual(g[0], { snips: ['主人，痴傻十八年的少主一夜痊愈，接下来还有什么'.slice(0, 24)], need: 1 });
    assert.equal(g.length, 2, 'a one-character voice gives no snippet');
    assert.deepEqual(g[1], { snips: ['系统点:6600', '子系统:0', '好感度:0'], need: 2 });
});
test('renderer: an old node that is SillyTavern text (or what we replaced) is never kept as foreign', () => {
    const s = src('src/statusbar-host.js');
    assert.match(s, /!inA\.has\(i\) && !inN\.has\(i\) && !stText\(n, ref, consumed\)/);
    assert.match(s, /swapContent\(text, box, ref, consumedSnippets\(voices, panels\)\)/);
    assert.match(s, /if \(n\.nodeType === 1 && hasFrame\(n\)\) return false;/, 'frames (Tavern Helper, 小白X) always stay foreign');
    assert.match(s, /querySelectorAll\('pre,script,style,textarea'\)\.forEach\(x => x\.remove\(\)\)/, 'a card rendered from a code block stays foreign');
    assert.match(s, /hasVoice\(text\)/);
});
test('renderer: a foreign card that replaced a code block goes where that code block is (not above earlier voice cards)', () => {
    const s = src('src/statusbar-host.js');
    assert.match(s, /if \(drop\.has\(n\)\) \{ flush\(last\); continue; \}/);
    assert.match(s, /if \(matchedN\.has\(j\)\) \{ last = j; if \(!gapHasDrop\.has\(j\)\) flush\(j\); \}/);
});
test('capability row for 0.9.2', () => {
    assert.ok(CAPABILITIES.some(c => c.name === '楼层美化不重复' && /0\.9\.2/.test(c.scope)));
});
