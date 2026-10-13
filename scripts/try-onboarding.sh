#!/usr/bin/env bash
# See the first-run welcome as a new user would. Starts the board on port 8799
# over an empty throwaway data root (wiped on every run), opens it in Brave, and
# stops the server and deletes the root on Ctrl-C.
#
#   scripts/try-onboarding.sh
#
# BENCH_TRY_PORT changes the port (default 8799).
#
# The real data/ and the board on port 8765 are never touched.

set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${BENCH_TRY_PORT:-8799}"
ROOT="${TMPDIR:-/tmp}/bench-try-onboarding"
URL="http://127.0.0.1:$PORT/kanban/index.html"

rm -rf "$ROOT"
mkdir -p "$ROOT/data"

if lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use by process $(lsof -ti "tcp:$PORT" | head -1). Stop it with:" >&2
  echo "    lsof -ti tcp:$PORT | xargs kill" >&2
  echo "then run this again." >&2
  exit 1
fi

TODOS_DATA_ROOT="$ROOT/data" TODOS_PORT="$PORT" TODOS_NO_BROWSER=1 \
  python3 -u "$REPO/kanban/server.py" &
SERVER=$!
cleanup() {
  kill "$SERVER" 2>/dev/null
  wait "$SERVER" 2>/dev/null
  rm -rf "$ROOT"
}
trap cleanup EXIT
trap 'exit 0' INT TERM

for _ in $(seq 1 40); do
  curl -fs "http://127.0.0.1:$PORT/datasets.json" >/dev/null 2>&1 && break
  sleep 0.25
done

open -a "Brave Browser" "$URL" 2>/dev/null || open "$URL"
echo "Welcome screen at $URL (throwaway data in $ROOT). Ctrl-C to stop."
wait "$SERVER"
