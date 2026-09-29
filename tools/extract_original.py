"""Rebuild the private runtime from the pinned, untouched original source. No host calls."""
from pathlib import Path
import re,json,hashlib
root=Path(__file__).resolve().parents[1]
folder=root/'vendor/original'
provenance=json.loads((folder/'provenance.json').read_text())
for name,digest in provenance['sourceHashes'].items():
    assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==digest, 'Baseline changed: '+name
source=(folder/'assistant-v1.1.js').read_text()
starts=[m.start() for m in re.finditer(r'^/\*',source,re.M)]+[len(source)]
assert len(starts)==17, 'Unexpected source section structure; manual review required'
parts=[source[a:b] for a,b in zip(starts,starts[1:])]
prefix='// Original pure modules, private scope; host adapter deliberately excluded.\nconst platformAtob = globalThis.atob.bind(globalThis);\nconst original = (() => {\nconst globalThis = { atob: platformAtob };\n'
suffix='\nreturn globalThis;\n})();\nexport default original;\n'
output=prefix+'\n'.join(parts[i] for i in provenance['sectionIndices'])+suffix
(folder/'runtime.js').write_text(output)
print('Rebuilt runtime:',len(output.encode()),'bytes; old Tavern Helper adapter excluded.')
