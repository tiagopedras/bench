#!/usr/bin/env python3
"""Who wrote each task, who last changed it, and the list's activity log.

    python3 kanban/test_authorship.py

No browser. It starts kanban/server.py itself on free ports (never 8765 or
8766) over a throwaway data root, signed in with BENCH_AUTH=header on a board
two people share, and once as the Mac board. The real data/ is never read or
written.

What it holds to:

  * signed in, a task someone adds is created by the email nginx sent, and a
    task or sub-task someone changes is last edited by it;
  * a tab cannot say either: what it sends for created-by or edited-by is put
    back to what the file says, on a task it changed or one it did not;
  * every save's changes land in data/<board>/activity.jsonl, one line per
    task, with who, their name and what changed, and /activity.json reads them
    back newest first with a name for each email;
  * on the Mac nobody signs in: no tag is written, a file without them comes
    back byte for byte, and the log names the owner from the profile.
"""

import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_board_access import Server, seed, access, as_json, write, TIAGO, JEROME  # noqa: E402

PASS = []
FAIL = []


def ok(label, cond, detail=""):
    (PASS if cond else FAIL).append(label if cond else
                                    (label + (" — " + detail if detail else "")))


LIST = """# To-do

## 1. Tasks

### To do

- [ ] **Write the brief** [due:: 2026-10-30] `created-by:tiagopedras+claude@gmail.com` `id:aaaaaa`
- [ ] **Book the venue** `id:bbbbbb`
  - [ ] Call the venue `id:s00001`
  - [ ] Send the deposit `id:s00002`

### Done

"""


def line_of(text, needle):
    return next((l for l in text.split("\n") if needle in l), "")


def signed_in(root):
    data = os.path.join(root, "signed-in")
    seed(data, "offdesk", LIST)
    access(data, "offdesk", TIAGO["X-Offdesk-Email"], people=[JEROME["X-Offdesk-Email"]])
    path = os.path.join(data, "offdesk", "todo.md")
    srv = Server(data, "header")
    ok("signed-in server starts", srv.wait())
    try:
        def save(who, text, base):
            code, body, _ = srv.ask("PUT", "/data/todo.md", dict(who, **{"Content-Type": "application/json"}),
                                    {"text": text, "base": base})
            return code, as_json(body) or {}

        def disk():
            with open(path, encoding="utf-8") as fh:
                return fh.read()

        # --- an edit, a new task and a new sub-task, from Jerome --------------------
        mine = (LIST.replace("[due:: 2026-10-30]", "[due:: 2026-11-02]")
                    .replace("  - [ ] Send the deposit `id:s00002`\n",
                             "  - [ ] Send the deposit `id:s00002`\n  - [ ] Confirm numbers `id:s00003`\n")
                    .replace("### Done", "- [ ] **Order badges** `id:cccccc`\n\n### Done"))
        code, got = save(JEROME, mine, LIST)
        now = disk()
        ok("a save from Jerome writes", code == 200, "%d %r" % (code, got))
        brief = line_of(now, "Write the brief")
        ok("the task he changed is last edited by him",
           "`edited-by:jerome@example.com`" in brief, brief)
        ok("and still created by who wrote it",
           "`created-by:tiagopedras+claude@gmail.com`" in brief, brief)
        ok("the tags sit in front of the id",
           brief.endswith("`created-by:tiagopedras+claude@gmail.com` `edited-by:jerome@example.com` `id:aaaaaa`"), brief)
        badges = line_of(now, "Order badges")
        ok("the task he added is created by him", "`created-by:jerome@example.com`" in badges, badges)
        ok("and has no editor yet", "edited-by" not in badges, badges)
        step = line_of(now, "Confirm numbers")
        ok("the sub-task he added is created by him", "`created-by:jerome@example.com`" in step, step)
        venue = line_of(now, "Book the venue")
        ok("a task whose sub-tasks he changed counts as edited by him",
           "`edited-by:jerome@example.com`" in venue, venue)
        ok("a sub-task he did not touch is left alone",
           line_of(now, "Call the venue") == "  - [ ] Call the venue `id:s00001`", line_of(now, "Call the venue"))
        ok("the reply carries the text written, tags and all",
           got.get("text") == now and not got.get("merged"), repr(got)[:200])

        # --- a tab cannot say who did it ------------------------------------------
        base = now
        forged = (base.replace("`created-by:tiagopedras+claude@gmail.com`", "`created-by:mallory@example.com`")
                      .replace("- [ ] Call the venue `id:s00001`",
                               "- [x] Call the venue `created-by:mallory@example.com` `id:s00001`")
                      .replace("### Done",
                               "- [ ] **Forged** `created-by:mallory@example.com` `edited-by:mallory@example.com` `id:dddddd`\n\n### Done"))
        code, got = save(JEROME, forged, base)
        now = disk()
        ok("a forged save still writes", code == 200, "%d %r" % (code, got))
        ok("created-by sent on an untouched task is put back",
           "`created-by:tiagopedras+claude@gmail.com`" in line_of(now, "Write the brief")
           and "mallory" not in line_of(now, "Write the brief"), line_of(now, "Write the brief"))
        call = line_of(now, "Call the venue")
        ok("created-by sent on a sub-task it changed is dropped, and the editor is the signer",
           "mallory" not in call and "`edited-by:jerome@example.com`" in call, call)
        new = line_of(now, "Forged")
        ok("both sent on a new task are replaced by the signer",
           "mallory" not in new and "`created-by:jerome@example.com`" in new and "edited-by" not in new, new)

        # --- the same edit from Tiago: the other name ---------------------------------
        base = now
        code, got = save(TIAGO, base.replace("**Order badges**", "**Order name badges**"), base)
        badges = line_of(disk(), "Order name badges")
        ok("the header decides the name: Tiago's edit is his",
           "`created-by:jerome@example.com` `edited-by:tiagopedras+claude@gmail.com`" in badges, badges)

        # --- the activity log -------------------------------------------------------
        log_path = os.path.join(data, "offdesk", "activity.jsonl")
        with open(log_path, encoding="utf-8") as fh:
            log = [json.loads(l) for l in fh if l.strip()]
        first = [e for e in log if e["who"] == "jerome@example.com"]
        ok("each save's changes are logged", len(log) >= 6, json.dumps(log)[:300])
        ok("with who, by email and name",
           all(e.get("name") == "Jérôme" for e in first) and first, json.dumps(first)[:300])
        ok("the edit says which fields",
           any(e["task"] == "Write the brief" and e["what"] == "edited" and e["fields"] == ["due"] for e in log),
           json.dumps(log)[:400])
        ok("an added task says so",
           any(e["task"] == "Order badges" and e["what"] == "added" and e["id"] == "cccccc" for e in log))
        ok("every entry carries when", all(e.get("at", "").endswith("+00:00") for e in log))
        code, body, _ = srv.ask("GET", "/activity.json", JEROME)
        got = as_json(body) or {}
        ok("/activity.json answers", code == 200, "%d %s" % (code, body[:200]))
        ok("newest first", (got.get("entries") or [{}])[0].get("task") == "Order name badges",
           json.dumps(got.get("entries"))[:200])
        ok("with a name for every email it has seen",
           got.get("names", {}).get("jerome@example.com") == "Jérôme"
           and got.get("names", {}).get("tiagopedras+claude@gmail.com") == "Tiago Pedras", repr(got.get("names")))
        ok("and says who is asking", got.get("me") == "jerome@example.com", repr(got.get("me")))
        code, _, _ = srv.ask("GET", "/activity.json", {"X-Offdesk-Email": "nobody@example.com"})
        ok("someone outside the board cannot read its log", code == 404, "got %d" % code)
    finally:
        srv.stop()


def mac(root):
    data = os.path.join(root, "mac")
    plain = LIST.replace(" `created-by:tiagopedras+claude@gmail.com`", "")
    seed(data, "tasks", plain)
    write(os.path.join(data, "profile.md"), "# Profile\n\n## About\n\n- Name: Tiago\n")
    path = os.path.join(data, "tasks", "todo.md")
    srv = Server(data, None)
    ok("Mac server starts", srv.wait())
    try:
        mine = plain.replace("[due:: 2026-10-30]", "[due:: 2026-11-02]")
        code, body, _ = srv.ask("PUT", "/data/todo.md", {"Content-Type": "application/json"},
                                {"text": mine, "base": plain})
        got = as_json(body) or {}
        with open(path, encoding="utf-8") as fh:
            ok("on the Mac the file is written as sent, no tags", fh.read() == mine)
        ok("and the reply carries no text", code == 200 and "text" not in got, repr(got))
        with open(os.path.join(data, "tasks", "activity.jsonl"), encoding="utf-8") as fh:
            log = [json.loads(l) for l in fh if l.strip()]
        ok("the log still has the change, under the owner's name",
           log and log[-1]["who"] == "" and log[-1]["name"] == "Tiago" and log[-1]["fields"] == ["due"],
           json.dumps(log))
        code, body, _ = srv.ask("GET", "/activity.json")
        ok("/activity.json answers on the Mac with nobody asking",
           code == 200 and (as_json(body) or {}).get("me") == "", body[:200])
    finally:
        srv.stop()


def main():
    root = tempfile.mkdtemp(prefix="authorship-test-")
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
