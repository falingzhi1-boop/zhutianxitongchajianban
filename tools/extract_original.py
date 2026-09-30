"""Rebuild the private runtimes from the pinned, untouched original source. No host calls.

runtime.js            sections 0-4, 8-14: pure data/art/motion/ledger modules (unchanged since 0.2.0).
assistant-runtime.js  sections 5, 6, 7, 15: original Lilith window, connection, workbench and the v1.1 host adapter,
                      byte-for-byte, executed inside a factory whose private `globalThis` / `window` / `fetch` are
                      supplied by src/assistant-host.js (native SillyTavern bridge; Tavern Helper is NOT required).
"""
from pathlib import Path
import re, json, hashlib, sys

root = Path(__file__).resolve().parents[1]
folder = root / 'vendor/original'
provenance = json.loads((folder / 'provenance.json').read_text())
for name, digest in provenance['sourceHashes'].items():
    assert hashlib.sha256((folder / name).read_bytes()).hexdigest() == digest, 'Baseline changed: ' + name
source = (folder / 'assistant-v1.1.js').read_text()
starts = [m.start() for m in re.finditer(r'^/\*', source, re.M)] + [len(source)]
assert len(starts) == 17, 'Unexpected source section structure; manual review required'
parts = [source[a:b] for a, b in zip(starts, starts[1:])]

prefix = '// Original pure modules, private scope; host adapter deliberately excluded.\nconst platformAtob = globalThis.atob.bind(globalThis);\nconst original = (() => {\nconst globalThis = { atob: platformAtob };\n'
suffix = '\nreturn globalThis;\n})();\nexport default original;\n'
output = prefix + '\n'.join(parts[i] for i in provenance['sectionIndices']) + suffix
(folder / 'runtime.js').write_text(output)
print('Rebuilt runtime:', len(output.encode()), 'bytes; old Tavern Helper adapter excluded.')

assistant = provenance.get('assistantSectionIndices', [5, 6, 7, 15])
a_prefix = ('// Original Lilith window + connection + workbench + v1.1 host adapter, byte-for-byte (sections '
            + ','.join(map(str, assistant)) + ').\n'
            '// Executed only through src/assistant-host.js, which supplies a native SillyTavern bridge as the private scope.\n'
            'export default function mountOriginalAssistant(env) {\n'
            'const globalThis = env.globalThis, window = env.window, fetch = env.fetch;\n'
            'const getTavernVersion = env.getTavernVersion, getTavernHelperVersion = env.getTavernHelperVersion;\n')
a_suffix = '\n}\n'
a_output = a_prefix + '\n'.join(parts[i] for i in assistant) + a_suffix
(folder / 'assistant-runtime.js').write_text(a_output)
print('Rebuilt assistant runtime:', len(a_output.encode()), 'bytes; sha256', hashlib.sha256(a_output.encode()).hexdigest())
if '--check' in sys.argv:
    assert hashlib.sha256(output.encode()).hexdigest() == provenance['runtimeSha256'], 'runtime.js drifted'
    assert hashlib.sha256(a_output.encode()).hexdigest() == provenance['assistantRuntimeSha256'], 'assistant-runtime.js drifted'
    print('Provenance hashes match.')
