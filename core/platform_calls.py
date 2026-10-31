"""The few calls that differ between Mac, Linux and Windows, in one place.

Everything else in Bench is plain Python that runs the same on all three. What
is here is what is not: holding a lock on a file, and opening a folder in the
system's file browser. Each picks its own way by platform, so a caller never
checks `sys.platform` itself.
"""

import os
import subprocess
import sys
import time

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None
    import msvcrt


class Locked:
    """Holds an exclusive lock beside `path`, at `path + ".lock"`, for as long
    as it is open. Blocks until the lock is free.

    flock on Mac and Linux. On Windows, msvcrt locks the lock file's first
    byte; LK_LOCK gives up after ten tries of a second each, so it is retried
    until it holds, the same as flock waiting."""

    def __init__(self, path):
        self.path = path

    def __enter__(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.fh = open(self.path + ".lock", "w", encoding="utf-8")
        if fcntl:
            fcntl.flock(self.fh, fcntl.LOCK_EX)
        else:
            while True:
                try:
                    msvcrt.locking(self.fh.fileno(), msvcrt.LK_LOCK, 1)
                    break
                except OSError:
                    time.sleep(0.05)
        return self

    def __exit__(self, *exc):
        if fcntl:
            fcntl.flock(self.fh, fcntl.LOCK_UN)
        else:
            self.fh.seek(0)
            msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
        self.fh.close()


def open_path(path):
    """Opens a file or folder in the system's own app for it: Finder, Explorer,
    or whatever xdg-open picks. Raises OSError when it cannot."""
    if sys.platform == "win32":
        os.startfile(path)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
