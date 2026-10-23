#!/usr/bin/env bash
# Update the agency server's Bench (and optionally its shared packages) to given
# commits. Run from the Mac. Dry run unless --apply is given.
#
#   scripts/deploy-server.sh <bench-ref> [--packages <name>=<ref> ...] [--apply]
#
#   scripts/deploy-server.sh main
#   scripts/deploy-server.sh v1.2 --packages agents-engine=main --apply
#
# <name> is agents-engine, ai_chat_engine or work-streams. A ref is a branch,
# tag or commit on the repo's GitHub origin, so push it there first.
#
# --apply records the current commits, fetches, checks out the refs, installs
# and builds the board's front end, restarts bench.service and waits up to 20 s
# for the board to answer (200, or 302 and 401 under sign-in). If it does not, the recorded commits go back and
# the service restarts again. data/ is never touched.
#
# DEPLOY_HOST changes the server (default root@167.235.25.240).

set -u

HOST="${DEPLOY_HOST:-root@167.235.25.240}"
BENCH_REPO="/opt/agency/bench"
PKG_DIR="/opt/agency/PACKAGES"

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[ $# -ge 1 ] || usage
BENCH_REF=""
APPLY=0
PKGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --packages)
      shift
      while [ $# -gt 0 ] && [[ "$1" != --* ]] && [[ "$1" == *=* ]]; do
        PKGS+=("$1"); shift
      done
      continue ;;
    -h|--help) usage ;;
    --*) echo "Unknown option $1" >&2; usage ;;
    *) if [ -z "$BENCH_REF" ]; then BENCH_REF="$1"; else echo "Unexpected argument $1" >&2; usage; fi ;;
  esac
  shift
done
[ -n "$BENCH_REF" ] || usage

# Refs are checked here, before any ssh call, and quoted again when sent.
valid_ref() { [[ "$1" =~ ^[A-Za-z0-9._/-]+$ && "$1" != -* ]]; }
valid_ref "$BENCH_REF" || { echo "Refused ref '$BENCH_REF': use letters, digits, . _ / - only, and not a leading -." >&2; exit 2; }
for p in ${PKGS[@]+"${PKGS[@]}"}; do
  case "${p%%=*}" in
    agents-engine|ai_chat_engine|work-streams) ;;
    *) echo "Unknown package '${p%%=*}'. Use agents-engine, ai_chat_engine or work-streams." >&2; exit 2 ;;
  esac
  valid_ref "${p#*=}" || { echo "Refused ref '${p#*=}' for ${p%%=*}: use letters, digits, . _ / - only, and not a leading -." >&2; exit 2; }
done

# ssh joins its arguments into one string for the server's shell, so each is
# quoted with %q.
ARGS=""
for a in "$APPLY" "$BENCH_REPO" "$PKG_DIR" "$BENCH_REF" ${PKGS[@]+"${PKGS[@]}"}; do
  ARGS+=" $(printf '%q' "$a")"
done

# Everything below runs on the server, as root, with git and npm handed to the
# bench user (git refuses a checkout owned by someone else).
ssh "$HOST" "bash -s --$ARGS" <<'REMOTE'
set -uo pipefail
APPLY="$1"; BENCH_REPO="$2"; PKG_DIR="$3"; BENCH_REF="$4"; shift 4
BHOME="$(getent passwd bench | cut -d: -f6)"
as_bench() { runuser -u bench -- env HOME="$BHOME" "$@"; }
git_in() { local d="$1"; shift; as_bench git -C "$d" "$@"; }

REPOS=("bench|$BENCH_REPO|$BENCH_REF")
for p in "$@"; do REPOS+=("${p%%=*}|$PKG_DIR/${p%%=*}|${p#*=}"); done

say() { printf '%s\n' "$*"; }
die() { say "ABORT: $*" >&2; exit 1; }

# Resolve a ref to a full commit. Dry run asks the remote without writing
# anything; apply resolves after the fetch.
# Both follow one order: branch, then tag (the commit a tag points at), then,
# on --apply only, anything else git can name (a short commit id).
resolve_remote() {
  local dir="$1" ref="$2" out
  if [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then echo "$ref"; return; fi
  out="$(git_in "$dir" ls-remote origin "refs/heads/$ref" 2>/dev/null | head -1 | cut -f1)"
  if [ -z "$out" ]; then
    out="$(git_in "$dir" ls-remote origin "refs/tags/$ref^{}" 2>/dev/null | head -1 | cut -f1)"
  fi
  if [ -z "$out" ]; then
    out="$(git_in "$dir" ls-remote origin "refs/tags/$ref" 2>/dev/null | head -1 | cut -f1)"
  fi
  echo "$out"
}
resolve_local() {
  local dir="$1" ref="$2"
  git_in "$dir" rev-parse --verify --quiet "refs/remotes/origin/$ref^{commit}" \
    || git_in "$dir" rev-parse --verify --quiet "refs/tags/$ref^{commit}" \
    || git_in "$dir" rev-parse --verify --quiet "$ref^{commit}"
}
short() { echo "${1:0:9}"; }

declare -A OLD NEW
for r in "${REPOS[@]}"; do
  IFS='|' read -r name dir ref <<<"$r"
  [ -d "$dir/.git" ] || die "$dir is not a git checkout"
  OLD[$name]="$(git_in "$dir" rev-parse HEAD)" || die "cannot read HEAD of $dir"
  if [ -n "$(git_in "$dir" status --porcelain --untracked-files=no)" ]; then
    die "$dir has uncommitted changes to tracked files; deploying would overwrite them"
  fi
done

if [ "$APPLY" = 1 ]; then
  say "== Fetch"
  for r in "${REPOS[@]}"; do
    IFS='|' read -r name dir ref <<<"$r"
    git_in "$dir" fetch --tags --prune origin 2>&1 | sed "s/^/  $name: /" || die "fetch failed for $name"
    NEW[$name]="$(resolve_local "$dir" "$ref")" || true
    [ -n "${NEW[$name]:-}" ] || die "$name: '$ref' not found on origin"
  done
else
  say "DRY RUN (nothing on the server changes). Add --apply to deploy."
  for r in "${REPOS[@]}"; do
    IFS='|' read -r name dir ref <<<"$r"
    NEW[$name]="$(resolve_remote "$dir" "$ref")"
  done
fi

say
for r in "${REPOS[@]}"; do
  IFS='|' read -r name dir ref <<<"$r"
  to="${NEW[$name]:-}"
  [ -n "$to" ] || to="(cannot resolve '$ref' without fetching; a short commit id resolves on --apply)"
  [ "${NEW[$name]:-}" = "${OLD[$name]}" ] && same=" (already there)" || same=""
  say "$name ($dir)"
  say "  from $(short "${OLD[$name]}")  ${OLD[$name]}"
  say "  to   ${to}  [$ref]$same"
done

build() {
  # npm ci installs exactly package-lock.json and never rewrites it. The board's front end builds to kanban/dist (gitignored). The packages
  # ship their built files in git, so only bench needs it.
  local bhead="$1"
  say "== npm ci + build (bench)"
  as_bench bash -c "cd '$BENCH_REPO' && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent" 2>&1 | sed 's/^/  /'
}

health() {
  say "== Waiting for http://127.0.0.1:8765/ (20 s)"
  local i code
  for i in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/ || true)"
    case "$code" in 200|302|401) say "  ${code} after ${i} s"; return 0 ;; esac
    sleep 1
  done
  say "  last answer: ${code:-none}"
  return 1
}

checkout_all() {  # args: associative array name to read, then 1 to discard edits to tracked files first
  local -n target="$1"
  for r in "${REPOS[@]}"; do
    IFS='|' read -r name dir ref <<<"$r"
    if [ "${2:-0}" = 1 ]; then git_in "$dir" checkout --quiet -- . || return 1; fi
    git_in "$dir" checkout --quiet --detach "${target[$name]}" || return 1
  done
}

if [ "$APPLY" != 1 ]; then
  say
  say "Steps with --apply:"
  say "  1. record the commits above"
  say "  2. git fetch --tags origin in each repo, as the bench user"
  say "  3. git checkout --detach <commit> in each repo"
  say "  4. npm ci and npm run build in $BENCH_REPO (data/ untouched)"
  say "  5. systemctl restart bench.service"
  say "  6. wait up to 20 s for the board to answer on http://127.0.0.1:8765/ (200, 302 or 401)"
  say "  7. on failure: check out the recorded commits, rebuild, restart"
  exit 0
fi

say
say "== Checkout"
if ! checkout_all NEW; then
  say "Checkout failed, putting the recorded commits back."
  checkout_all OLD 1
  exit 1
fi

if build x && systemctl restart bench.service && health; then
  say "Deployed. Each repo on the server is now on a detached HEAD at:"
  for r in "${REPOS[@]}"; do
    IFS='|' read -r name dir ref <<<"$r"
    say "  $name $(git_in "$dir" rev-parse HEAD)"
  done
  exit 0
fi

say
say "== FAILED, rolling back"
checkout_all OLD 1 || say "  rollback checkout failed; check $BENCH_REPO by hand"
build x || say "  rebuild failed"
systemctl restart bench.service
if health; then say "Rolled back to the recorded commits; the board answers."; else say "Rolled back, but the board is not answering. Check: journalctl -u bench.service -n 50"; fi
exit 1
REMOTE
