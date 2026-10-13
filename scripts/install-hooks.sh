#!/usr/bin/env bash
# Point git at scripts/hooks. Safe to run more than once.
set -e
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath scripts/hooks
chmod +x scripts/hooks/pre-commit scripts/check-private.sh
echo "Hooks installed: core.hooksPath = $(git config core.hooksPath)"
