#!/usr/bin/env python3
"""Checks for core/agent_runs.py, against a temporary folder only.

    python3 core/test_agent_runs.py
"""

import datetime as dt
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import agent_runs  # noqa: E402

failures = []


def check(name, got, want):
    if got != want:
        failures.append(name)
        print("  %s\n    got  %r\n    want %r" % (name, got, want))


with tempfile.TemporaryDirectory() as tmp:
    path = os.path.join(tmp, "data", "demo", "agent-runs.json")
    queue = os.path.join(tmp, "data", "demo", "notify-queue.json")
    t0 = dt.datetime(2026, 9, 27, 2, 3, 40)

    check("an absent file reads as no records", agent_runs.read(path), {})

    agent_runs.start("AA0001", "ab12cd", "Write the brief", "Plan agent", path=path, now=t0)
    rec = agent_runs.get("aa0001", path)
    check("start() records the run as running, by the sub-task's id", rec["state"], "running")
    check("with its task and agent", (rec["task"], rec["agent"]), ("ab12cd", "Plan agent"))

    agent_runs.finish("aa0001", "planned", "A plan.", path=path, plan="ab12cd-x.md",
                      now=t0 + dt.timedelta(minutes=2))
    rec = agent_runs.get("aa0001", path)
    check("finish() marks it done with the agent's label", (rec["state"], rec["label"]), ("done", "planned"))
    check("and keeps the plan's name", rec["plan"], "ab12cd-x.md")
    check("and when it landed", rec["at"], "2026-09-27T02:05:40")

    agent_runs.start("aa0003", "ab12cd", "Write the brief", "Implement agent", path=path, now=t0)
    agent_runs.fail("aa0003", "it wrote nothing", "Traceback...\nValueError: x", path=path,
                    notify_path=queue, now=t0)
    rec = agent_runs.get("aa0003", path)
    check("fail() marks it failed with the reason and the output", (rec["state"], rec["why"], rec["error"]),
          ("failed", "it wrote nothing", "Traceback...\nValueError: x"))
    check("and counts it", rec["fails"], 1)
    with open(queue, encoding="utf-8") as fh:
        banner = json.load(fh)[-1]
    check("and asks the companion for one banner, pointing at the sub-task",
          (banner["title"], banner["task"]), ("Implement agent", "aa0003"))
    check("naming the task and the reason", banner["body"], "Failed on Write the brief: it wrote nothing")
    check("a record other than the one changed is left alone", agent_runs.get("aa0001", path)["state"], "done")

    check("no retry stamp before a retry", agent_runs.retry_stamp("aa0003", path), "")
    agent_runs.retry("aa0003", path=path, now=t0 + dt.timedelta(hours=8))
    rec = agent_runs.get("aa0003", path)
    check("retry() queues a failed run again", rec["state"], "queued")
    check("and stamps it, for the fingerprint", agent_runs.retry_stamp("aa0003", path), "2026-09-27T10:03:40")
    agent_runs.start("aa0003", "ab12cd", "Write the brief", "Implement agent", path=path, now=t0)
    check("the stamp survives the next start, so the fingerprint stays put",
          agent_runs.retry_stamp("aa0003", path), "2026-09-27T10:03:40")
    check("retry() leaves a finished run alone",
          agent_runs.retry("aa0001", path=path)["state"], "done")

    folder = os.path.join(tmp, "project")
    os.makedirs(folder)
    with open(os.path.join(folder, "note-to-sam.draft.md"), "w", encoding="utf-8") as fh:
        fh.write("Hey Sam 👋\n")
    drafts = agent_runs.read_drafts(folder, ["brief.md", "note-to-sam.draft.md", "gone.draft.md"])
    check("read_drafts() keeps only the drafts on disk, with their text",
          drafts, [{"name": "note-to-sam.draft.md", "text": "Hey Sam 👋\n"}])
    agent_runs.set_output("aa0003", {"files": ["brief.md"], "project": "write-the-brief"}, path=path)
    agent_runs.set_output("aa0003", {"files": ["brief.md", "b.md"], "figma": "https://figma.com/x"}, path=path)
    out = agent_runs.get("aa0003", path)["output"]
    check("set_output() merges, files without repeats", out["files"], ["brief.md", "b.md"])
    check("and keeps what the first call said", (out["project"], out["figma"]),
          ("write-the-brief", "https://figma.com/x"))

    agent_runs.clear("aa0003", path=path)
    check("clear() forgets the run", agent_runs.get("aa0003", path), None)

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("{ not json")
    check("a hand-broken file reads as no records", agent_runs.read(path), {})

print("%d failed" % len(failures) if failures else "all checks passed")
sys.exit(1 if failures else 0)
