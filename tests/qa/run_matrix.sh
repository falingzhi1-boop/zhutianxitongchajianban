#!/usr/bin/env bash
# Run every browser suite against throwaway SillyTavern checkouts, one host at a time (low RAM sandboxes).
# Prereqs: tests/qa/setup_isolated_st.py already ran for each /var/tmp/st-<ver>, and tests/qa/mock_model.py is listening on :5001.
# Usage: tests/qa/run_matrix.sh [LEGACY_DIR] [VERSIONS...]     e.g. tests/qa/run_matrix.sh /var/tmp/v11/zip 1.16.0 1.19.0
set -u
cd "$(dirname "$0")/../.."
LEGACY=${1:-/var/tmp/v11/zip}; shift || true
VERSIONS=${*:-1.16.0 1.17.0 1.18.0 1.19.0}
OUT=${QA_OUT:-/var/tmp/qa/matrix}; mkdir -p "$OUT"
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/var/tmp/pw}
for v in $VERSIONS; do
  minor=$(echo "$v" | cut -d. -f2); port=80$minor; st=/var/tmp/st-$v
  (cd "$st" && exec node server.js) > "$OUT/server-$v.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 120); do curl -sf "http://127.0.0.1:$port/version" >/dev/null && break; sleep 1; done
  echo "== $v ($(curl -s http://127.0.0.1:$port/version | python3 -c 'import sys,json;print(json.load(sys.stdin)["gitRevision"])'))"
  timeout 900 python3 tests/native_terminal050.py --isolated-test-only --base-url "http://127.0.0.1:$port" --shots "$OUT/shots050-$v" > "$OUT/terminal050-$v.log" 2>&1
  echo "   native_terminal050: $(tail -n 1 "$OUT/terminal050-$v.log")"; grep '^FAIL' "$OUT/terminal050-$v.log" | sed 's/^/     /'
  timeout 900 python3 tests/native_replace040.py --isolated-test-only --base-url "http://127.0.0.1:$port" --legacy-dir "$LEGACY" --shots "$OUT/shots-$v" > "$OUT/replace040-$v.log" 2>&1
  echo "   native_replace040: $(tail -n 1 "$OUT/replace040-$v.log")"; grep '^FAIL' "$OUT/replace040-$v.log" | sed 's/^/     /'
  for t in native_guards; do
    timeout 600 python3 "tests/$t.py" --isolated-test-only --base-url "http://127.0.0.1:$port" > "$OUT/$t-$v.log" 2>&1
    echo "   $t: exit $?"
  done
  kill $pid; wait $pid 2>/dev/null; sleep 2
done
echo MATRIX_DONE
