#!/usr/bin/env python3
"""Which lists the server offers.

    python3 kanban/test_hidden_lists.py

A list whose name starts with "_" stays out of the dropdown, except when
TODOS_SHOW_HIDDEN is set, which scripts/test-board.sh does so the suites see
`_test` and any other hidden list. A name starting with "." is never offered.
Reads a temporary folder only; nothing under data/ is touched.
"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402

FAIL = []


def ok(label, cond):
    print(("  ok  " if cond else " FAIL ") + label)
    if not cond:
        FAIL.append(label)


tmp = tempfile.mkdtemp(prefix="hidden-lists-test-")
try:
    for name in ("personal", "_test", "_demo", ".trash"):
        os.makedirs(os.path.join(tmp, name))
        with open(os.path.join(tmp, name, "todo.md"), "w", encoding="utf-8") as fh:
            fh.write("# To-do\n")
    server.DATA_ROOT = tmp
    os.environ.pop("TODOS_SHOW_HIDDEN", None)
    ok("without the switch, names starting with _ are hidden", server.list_datasets() == ["personal"])
    os.environ["TODOS_SHOW_HIDDEN"] = "1"
    ok("with it, they are listed", server.list_datasets() == ["_demo", "_test", "personal"])
    ok("and a name starting with . still is not", ".trash" not in server.list_datasets())
finally:
    os.environ.pop("TODOS_SHOW_HIDDEN", None)
    shutil.rmtree(tmp, ignore_errors=True)

print("\n%d failed" % len(FAIL) if FAIL else "\nall passed")
sys.exit(1 if FAIL else 0)
