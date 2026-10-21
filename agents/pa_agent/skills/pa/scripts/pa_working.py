#!/usr/bin/env python3
"""Tells the board which tasks pa is about to change, and when it has finished.

Usage:
    python3 pa_working.py start data/<dataset>/pa-working.json "Task title" ab12cd ...
    python3 pa_working.py done data/<dataset>/pa-working.json

`start` writes `{tasks, started}` to the path, each task named by its title or
its `id:`, whichever is to hand. A task about to be added has neither yet and
is left out: the board glows it once it lands. Running `start` again during
the same sitting replaces the list, which is also what keeps a long sitting
from being taken for an abandoned one.

`done` removes the file. The board polls it every couple of seconds while the
tab is open (kanban/js/24-autosave-watching.js): while it is there the named
cards glow and the board holds its reload of todo.md, and once it is gone the
board reloads straight away and slides each card it moved into its new place.
A file older than ten minutes is ignored, so one left behind by a session
that stopped halfway does not hold the board for ever.

Written atomically, so the board never reads half a file.
"""

import argparse
import datetime
import json
import os
import sys


def cmd_start(args):
    tasks = [t.strip() for t in args.tasks if t.strip()]
    os.makedirs(os.path.dirname(os.path.abspath(args.path)), exist_ok=True)
    tmp = args.path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        json.dump({"tasks": tasks,
                   "started": datetime.datetime.now().isoformat(timespec="seconds")}, fh)
    os.replace(tmp, args.path)
    return 0


def cmd_done(args):
    try:
        os.remove(args.path)
    except FileNotFoundError:
        pass
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_start = sub.add_parser("start", help="name the tasks about to change")
    p_start.add_argument("path", help="data/<dataset>/pa-working.json")
    p_start.add_argument("tasks", nargs="*", help="each task's title or id")
    p_start.set_defaults(func=cmd_start)

    p_done = sub.add_parser("done", help="say the edit is finished")
    p_done.add_argument("path", help="data/<dataset>/pa-working.json")
    p_done.set_defaults(func=cmd_done)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
