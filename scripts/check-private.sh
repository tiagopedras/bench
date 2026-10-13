#!/usr/bin/env bash
# Commit guard: stop private words and secrets reaching the repo.
#
#   scripts/check-private.sh          # scan the staged diff (added lines only)
#   scripts/check-private.sh --all    # scan every tracked file
#
# Two checks, each skipped with a one-line note when it cannot run:
#   1. Words, one per line, in data/private-words.txt (or the file named by
#      PRIVATE_WORDS). Case-insensitive, whole-word. Blank lines and lines
#      starting with # are ignored.
#   2. Secrets, through gitleaks when it is installed.
# LICENSE and LICENSE.md are skipped: the copyright line names the owner on purpose.
# Prints file:line and the matched word for each hit, never the word list.
# Exits 1 on any hit. data/ is never scanned.
#
set -u

mode=staged
[ "${1:-}" = "--all" ] && mode=all

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "check-private: not in a git repo"; exit 2; }
cd "$root" || exit 2

words_file=${PRIVATE_WORDS:-data/private-words.txt}
fail=0
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# 1. Private words
if [ -r "$words_file" ]; then
  tr -d '\r' < "$words_file" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
    | grep -v -e '^$' -e '^#' > "$tmp/words" || true
  if [ -s "$tmp/words" ]; then
    if [ "$mode" = all ]; then
      git ls-files -z | grep -z -v -e '^data/' -e '^LICENSE$' -e '^LICENSE\.md$' | xargs -0 grep -H -I -n -o -i -w -F -f "$tmp/words" -- 2>/dev/null \
        | sed 's/^/  /' > "$tmp/hits" || true
    else
      git diff --cached --name-only --diff-filter=ACMR -z | grep -z -v -e '^data/' -e '^LICENSE$' -e '^LICENSE\.md$' | while IFS= read -r -d '' f; do
        # line numbers added in this file
        git diff --cached -U0 -- "$f" | awk '
          /^@@/ { split($3, a, ","); s = substr(a[1], 2) + 0; n = (a[2] == "" ? 1 : a[2] + 0)
                  for (i = 0; i < n; i++) print s + i }' > "$tmp/added"
        git show ":$f" 2>/dev/null | grep -I -n -o -i -w -F -f "$tmp/words" 2>/dev/null \
          | awk -F: -v f="$f" 'NR == FNR { ok[$1] = 1; next } ok[$1] { print "  " f ":" $0 }' "$tmp/added" - 
      done > "$tmp/hits"
    fi
    if [ -s "$tmp/hits" ]; then
      echo "check-private: private words found (file:line:word)"
      cat "$tmp/hits"
      fail=1
    fi
  else
    echo "check-private: $words_file has no words, skipping word check"
  fi
else
  echo "check-private: no word list at $words_file, skipping word check"
fi

# 2. Secrets
if command -v gitleaks >/dev/null 2>&1; then
  if [ "$mode" = all ]; then
    if gitleaks git --help >/dev/null 2>&1; then
      gitleaks git --no-banner --redact || fail=1
    else
      gitleaks detect --no-banner --redact || fail=1
    fi
  else
    if gitleaks git --help >/dev/null 2>&1; then
      gitleaks git --staged --no-banner --redact || fail=1
    else
      gitleaks protect --staged --no-banner --redact || fail=1
    fi
  fi
else
  echo "check-private: gitleaks not installed, skipping secret check"
fi

[ "$fail" -eq 0 ] || echo "check-private: blocked. Fix the lines above."
exit "$fail"
