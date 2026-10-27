"""Checks for core/platform_calls.py, on whichever platform it runs on.

    python3 core/test_platform_calls.py

The lock is checked the way the tick queue and the run records use it: a
second holder waits until the first lets go, never overlapping it.
"""

import os
import shutil
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import platform_calls  # noqa: E402

FAILED = []


def ok(label, cond, detail=""):
    print("  %s %s%s" % ("ok  " if cond else "FAIL", label, "" if cond else "  (%s)" % detail))
    if not cond:
        FAILED.append(label)


def main():
    tmp = tempfile.mkdtemp(prefix="platform-calls-test-")
    try:
        path = os.path.join(tmp, "nested", "queue.json")
        with platform_calls.Locked(path):
            ok("makes the folder and the lock file", os.path.isfile(path + ".lock"))

        events = []

        def hold(name, wait):
            with platform_calls.Locked(path):
                events.append(name + " in")
                time.sleep(wait)
                events.append(name + " out")

        first = threading.Thread(target=hold, args=("a", 0.4))
        first.start()
        time.sleep(0.1)
        second = threading.Thread(target=hold, args=("b", 0))
        second.start()
        first.join(5)
        second.join(5)
        ok("a second holder waits for the first", events == ["a in", "a out", "b in", "b out"],
           repr(events))

        with platform_calls.Locked(path):
            ok("and the lock can be taken again after", True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if FAILED:
        print("%d failed" % len(FAILED))
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
