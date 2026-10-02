#!/usr/bin/env python3
"""FILELIST.sha256 — sha256 of every file that ships with the extension (0.9.1: generated, LF, byte order of paths).

  python3 tools/filelist.py          rewrite FILELIST.sha256
  python3 tools/filelist.py --check  exit 1 (and list the differences) when FILELIST.sha256 is out of date

Works with or without git: walks the folder and skips what .gitignore keeps out of the repository (node_modules,
caches, logs, zip files, user data / local import folders) plus .git and FILELIST.sha256 itself.
Hashes are of the bytes on disk; .gitattributes keeps text files LF in every checkout, so they match GitHub.
"""
import hashlib, os, sys
from fnmatch import fnmatch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'FILELIST.sha256'
SKIP_DIRS = {'.git', 'node_modules', '.cache', '__pycache__', 'user-data', 'local-imports', '.venv', '.pytest_cache'}
SKIP_FILES = ['FILELIST.sha256', '.env', '.env.*', '*.log', '*.zip', '*.pyc', '.DS_Store', 'Thumbs.db']


def files():
    out = []
    for d, dirs, names in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for n in names:
            if any(fnmatch(n, p) for p in SKIP_FILES):
                continue
            out.append((Path(d) / n).relative_to(ROOT).as_posix())
    return sorted(out, key=lambda s: s.encode('utf-8'))


def listing():
    return ''.join(f'{hashlib.sha256((ROOT / f).read_bytes()).hexdigest()}  {f}\n' for f in files())


if __name__ == '__main__':
    text = listing()
    if '--check' in sys.argv:
        old = OUT.read_text('utf-8') if OUT.exists() else ''
        if old == text:
            print(f'FILELIST.sha256 is up to date ({text.count(chr(10))} files)')
            sys.exit(0)
        a, b = dict(l.split('  ', 1)[::-1] for l in old.splitlines() if '  ' in l), dict(l.split('  ', 1)[::-1] for l in text.splitlines())
        for f in sorted(set(a) | set(b)):
            if a.get(f) != b.get(f):
                print(('changed ' if f in a and f in b else 'missing ' if f in b else 'extra   ') + f)
        print('FILELIST.sha256 is out of date — run: npm run filelist')
        sys.exit(1)
    OUT.write_text(text, 'utf-8', newline='\n')
    print(f'wrote FILELIST.sha256 ({text.count(chr(10))} files)')
