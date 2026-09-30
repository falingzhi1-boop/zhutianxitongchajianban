"""Shared helpers for the browser suites: report the real host instead of a hard-coded label."""
import json, pathlib, urllib.request

def host_info(base_url):
    try:
        with urllib.request.urlopen(base_url.rstrip('/') + '/version', timeout=10) as r:
            v = json.load(r)
        return {'host': 'SillyTavern ' + v.get('pkgVersion', '?'), 'commit': v.get('gitRevision', '?')}
    except Exception as e:  # the report must never fail a passing suite
        return {'host': 'SillyTavern (unknown: %s)' % e, 'commit': '?'}

def extension_version():
    return json.loads((pathlib.Path(__file__).resolve().parent.parent / 'manifest.json').read_text('utf-8'))['version']
