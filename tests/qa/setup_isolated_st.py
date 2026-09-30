"""Prepare a THROWAWAY SillyTavern checkout for the browser suites. Never point this at a real install.

  git clone --depth 1 --branch 1.19.0 https://github.com/SillyTavern/SillyTavern /var/tmp/st-1.19.0
  (cd /var/tmp/st-1.19.0 && npm i --omit=dev)
  python3 tests/qa/setup_isolated_st.py /var/tmp/st-1.19.0 8019
  (cd /var/tmp/st-1.19.0 && node server.js)          # then run tests/native_replace040.py --base-url http://127.0.0.1:8019

What it does: writes config.yaml (port, local listen, no whitelist/basic auth) and symlinks this plugin into
public/scripts/extensions/third-party/zhutianxitongchajianban so the suites always test the working tree.
"""
import pathlib, re, shutil, sys

if len(sys.argv) < 3: sys.exit(__doc__)
st = pathlib.Path(sys.argv[1]).resolve(); port = int(sys.argv[2])
if not (st / 'server.js').exists(): sys.exit(f'{st} is not a SillyTavern checkout')
plugin = pathlib.Path(__file__).resolve().parents[2]

cfg = st / 'config.yaml'
if not cfg.exists(): shutil.copy(st / 'default' / 'config.yaml', cfg)
text = cfg.read_text('utf-8')
def put(key, value):
    """Set a top-level `key: value` (adds it when missing)."""
    global text
    pat = re.compile(rf'(?m)^{re.escape(key)}:.*$')
    text = pat.sub(f'{key}: {value}', text) if pat.search(text) else text + f'\n{key}: {value}\n'
put('port', port)
put('listen', 'true')               # the sandbox reaches the server through a non-loopback interface
put('whitelistMode', 'false')
put('securityOverride', 'true')     # required with listen:true and no whitelist
put('basicAuthMode', 'false')
put('skipContentCheck', 'false')    # true breaks the first boot
cfg.write_text(text, 'utf-8')

tp = st / 'public' / 'scripts' / 'extensions' / 'third-party'; tp.mkdir(parents=True, exist_ok=True)
link = tp / 'zhutianxitongchajianban'
if link.is_symlink() or link.exists():
    if link.is_symlink() or link.is_file(): link.unlink()
    else: shutil.rmtree(link)
link.symlink_to(plugin, target_is_directory=True)
print(f'ok: {st} port {port}; plugin -> {plugin}')
