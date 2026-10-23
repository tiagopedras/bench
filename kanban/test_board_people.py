#!/usr/bin/env python3
"""Who a task on a shared board can be given to.

    python3 kanban/test_board_people.py

No browser. It starts kanban/server.py itself on free ports (never 8765 or
8766) over a throwaway data root, signed in with BENCH_AUTH=header and once
as the Mac board. The real data/ is never read or written.

What it holds to:

  * /board-people.json lists the board's people and nobody else: its owner,
    its named people, and everyone who has signed in as a member of one of its
    teams, but not someone signed in only to another team;
  * each comes with the name they first signed in with, kept when a later
    sign-in sends another, and "" for someone who has never signed in;
  * someone outside the board cannot list them, and the Mac board has no
    such list;
  * an agent's request on behalf of a person is never credited as an agent's.
"""

import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "core"))
from test_board_access import Server, seed, access, as_json, TIAGO, JEROME  # noqa: E402
import tick_queue  # noqa: E402

PASS = []
FAIL = []


def ok(label, cond, detail=""):
    (PASS if cond else FAIL).append(label if cond else
                                    (label + (" — " + detail if detail else "")))


ANA = {"X-Offdesk-Email": "ana@example.com", "X-Offdesk-Name": "Ana%20Silva", "X-Offdesk-Teams": "offdesk"}
BOB = {"X-Offdesk-Email": "bob@example.com", "X-Offdesk-Name": "Bob", "X-Offdesk-Teams": "elsewhere"}
NOBODY = {"X-Offdesk-Email": "nobody@example.com", "X-Offdesk-Name": "Nobody"}
LIST = """# To-do

## 1. Tasks

### To do

- [ ] **Give it to Jerome** [to:: jerome@example.com] `id:aaaaaa`
  - [ ] His step [to:: jerome@example.com] `id:s00001`

### Done

"""


def signed_in(root):
    data = os.path.join(root, "signed-in")
    seed(data, "offdesk", LIST)
    access(data, "offdesk", TIAGO["X-Offdesk-Email"], people=[JEROME["X-Offdesk-Email"], "carla@example.com"],
           teams=["offdesk"])
    seed(data, "elsewhere")
    access(data, "elsewhere", BOB["X-Offdesk-Email"], teams=["elsewhere"])
    srv = Server(data, "header")
    ok("server starts", srv.wait())
    try:
        # Everyone signs in once, which is how the server learns names and teams.
        for who in (TIAGO, JEROME, ANA, BOB, NOBODY):
            srv.ask("GET", "/whoami", who)
        # A later sign-in under another name does not rename anybody.
        srv.ask("GET", "/whoami", dict(JEROME, **{"X-Offdesk-Name": "Somebody%20Else"}))

        code, body, _ = srv.ask("GET", "/board-people.json", JEROME)
        got = (as_json(body) or {}).get("people")
        ok("the board's people are listed", code == 200, "%d %s" % (code, body[:200]))
        emails = [p["email"] for p in got or []]
        ok("owner, named people, then signed-in team members",
           emails == ["tiagopedras+claude@gmail.com", "jerome@example.com", "carla@example.com", "ana@example.com"],
           repr(emails))
        ok("nobody from another team", "bob@example.com" not in emails)
        names = {p["email"]: p["name"] for p in got or []}
        ok("each with the name they first signed in with",
           names.get("jerome@example.com") == "Jérôme" and names.get("ana@example.com") == "Ana Silva", repr(names))
        ok("and no name for someone who never signed in", names.get("carla@example.com") == "", repr(names))

        code, body, _ = srv.ask("GET", "/board-people.json", BOB)
        bobs = [p["email"] for p in (as_json(body) or {}).get("people") or []]
        ok("Bob's board lists Bob's people", bobs == ["bob@example.com"], repr(bobs))
        code, body, _ = srv.ask("GET", "/board-people.json", NOBODY)
        ok("someone outside every board cannot list anybody", code == 404, "%d %s" % (code, body[:200]))

        # An agent's tick on behalf of a person: credits nobody.
        folder = os.path.join(data, "offdesk")
        entry = tick_queue.append("s00001", "jerome@example.com", path=os.path.join(folder, "tick-queue.json"))
        srv.ask("POST", "/tick-queue.json", dict(JEROME, **{"X-Board": "1", "Content-Type": "application/json"}),
                {"done": [entry["id"]]})
        with open(os.path.join(folder, "todo.md"), encoding="utf-8") as fh:
            base = fh.read()
        code, body, _ = srv.ask("PUT", "/data/todo.md", dict(TIAGO, **{"Content-Type": "application/json"}),
                                {"text": base.replace("- [ ] His step", "- [x] His step"), "base": base})
        with open(os.path.join(folder, "todo.md"), encoding="utf-8") as fh:
            step = next(l for l in fh.read().split("\n") if "His step" in l)
        ok("a request in a person's name is never an agent's",
           "`edited-by:tiagopedras+claude@gmail.com`" in step, step)
    finally:
        srv.stop()


def mac(root):
    data = os.path.join(root, "mac")
    seed(data, "tasks", LIST)
    srv = Server(data, None)
    ok("Mac server starts", srv.wait())
    try:
        code, _, _ = srv.ask("GET", "/board-people.json")
        ok("the Mac board has no list of people to give a task to", code == 404, "got %d" % code)
    finally:
        srv.stop()


def main():
    root = tempfile.mkdtemp(prefix="board-people-test-")
    try:
        signed_in(root)
        mac(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n%d passed" % len(PASS))
    for f in FAIL:
        print("  FAIL  " + f)
    if FAIL:
        print("\n%d failed\n" % len(FAIL))
        sys.exit(1)
    print("")


if __name__ == "__main__":
    main()
