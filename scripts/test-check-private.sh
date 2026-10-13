#!/usr/bin/env bash
# Tests for check-private.sh: a listed word blocks, a clean file passes.
set -u
script="$(cd "$(dirname "$0")" && pwd)/check-private.sh"
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
cd "$d" && git init -q . && git config user.email t@example.com && git config user.name t
printf '# comment\n\nzebracorn\n' > "$d/words.txt"
export PRIVATE_WORDS="$d/words.txt"
bad=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (exit $3, wanted $2)"; bad=1; fi; }

echo "I met a Zebracorn today" > dirty.txt; git add dirty.txt
out=$(bash "$script" 2>&1); check "listed word blocks" 1 $?
echo "$out" | grep -q 'dirty.txt:1:' || { echo "FAIL hit not reported as file:line"; bad=1; }
git reset -q

echo "zebracorns are fine, only whole words count" > clean.txt; git add clean.txt
bash "$script" >/dev/null 2>&1; check "clean file passes" 0 $?

git commit -q -m base; echo "plain text" > old.txt; git add old.txt; git commit -q -m old
git mv old.txt new.txt; echo "zebracorn here" >> new.txt; git add new.txt
bash "$script" >/dev/null 2>&1; check "renamed and edited file blocks" 1 $?
git reset -q --hard
PRIVATE_WORDS="$d/missing.txt" bash "$script" >/dev/null 2>&1; check "missing list skips" 0 $?
git reset -q --hard
echo "Copyright zebracorn" > LICENSE; git add LICENSE
bash "$script" >/dev/null 2>&1; check "listed word in LICENSE passes" 0 $?
echo "Copyright zebracorn" > NOTICE; git add NOTICE
bash "$script" >/dev/null 2>&1; check "same word elsewhere still blocks" 1 $?
exit $bad
