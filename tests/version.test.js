// 0.9.1+: the ONE place that pins the exact version. Older version tests only check "≥ their version and consistent",
// so a release changes this file (plus src/contracts.js, manifest.json, package.json, package-lock.json and the docs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { VERSION } from '../src/contracts.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const V = '1.1.4';

test(`version ${V} in contracts, manifest, package.json and both package-lock entries`, () => {
    assert.equal(VERSION, V);
    assert.equal(JSON.parse(read('manifest.json')).version, V);
    assert.equal(JSON.parse(read('package.json')).version, V);
    const lock = JSON.parse(read('package-lock.json')); assert.equal(lock.version, V); assert.equal(lock.packages[''].version, V);
});
test(`docs for ${V}: README headline + section, feature matrix, CHANGES, ACCEPTANCE`, () => {
    const readme = read('README.md');
    assert.ok(readme.split('\n').slice(0, 4).join('\n').includes(V), 'README headline');
    assert.ok(readme.includes(`## ${V}`), 'README section');
    assert.ok(read('docs/FEATURE_MATRIX.md').split('\n')[0].includes(V), 'feature matrix title');
    for (const f of [`docs/CHANGES-${V}.md`, `docs/ACCEPTANCE-${V}.md`]) { assert.ok(existsSync(new URL('../' + f, import.meta.url)), f); assert.ok(read(f).includes(V), f); }
});
