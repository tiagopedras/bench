#!/usr/bin/env python3
"""The owner's profile, read the same way by every Python caller.

`data/profile.md` holds the owner's setup (template:
`agents/pa_agent/profile.example.md`). Git ignores it. Two things in it matter
outside the PA:

- `Name:` under About, the first name as people.md and `[to::]` spell it. It is
  who the two review sub-tasks of a handover are assigned to. Missing, or still
  the template's `<placeholder>`, it is "Me".
- `Country:` under About, a two-letter code (`GB`, `PT`, `DE`), and an optional
  `Region:` (`GB-ENG`, `GB-SCT`). The public holidays that decide what counts as
  a working day, fetched by core/holidays.py. Neither set, the older
  `Holidays:` line is read instead: `UK`, `PT` or `UK, PT`, meaning England and
  Wales and Portugal. With none of these both count.
- `Facts file:` under About, the path to a file about the owner. Optional.
  Agents and skills read it when it is set and carry on without it otherwise.
- `Workspace folder:` and `Improve agent folder:` under Setup. Both optional:
  a parent folder the agents may read beyond this repo, and where an
  improve-agent checkout lives. Unset, the agents stay inside this repo and code
  plans are not run.

A line is `- Key: value`; backticks around the value are dropped, and `none` or
an unfilled `<placeholder>` counts as unset.

With `memory_root` set in data/settings.json (core/settings.py), the profile is
`<memory_root>/me/profile.md` when that file is there, and data/profile.md when
it is not. Reads and writes both go to whichever profile_path() names.
"""

import os
import re

import settings  # sits beside this file

DEFAULT_OWNER = "Me"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def data_root():
    return os.environ.get("TODOS_DATA_ROOT") or os.path.join(ROOT, "data")


def profile_path(root=None):
    """The profile in force: the memory folder's `me/profile.md` when the
    setting names one and the file is there, else data/profile.md."""
    root = root or data_root()
    memory = settings.memory_root(root)
    if memory:
        path = os.path.join(memory, "me", "profile.md")
        if os.path.isfile(path):
            return path
    return os.path.join(root, "profile.md")


def read(root=None):
    """Every `- Key: value` line in the profile, keys lower-cased."""
    path = profile_path(root)
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                m = re.match(r"\s*[-*]\s+([^:]+):\s*(.*?)\s*$", line)
                if not m:
                    continue
                value = m.group(2).strip().strip("`").strip()
                if not value or value.lower() == "none" or re.search(r"<[^>]*>", value):
                    continue
                out.setdefault(m.group(1).strip().lower(), value)
    except OSError:
        pass
    return out


def owner_name(root=None):
    return read(root).get("name", DEFAULT_OWNER)


def holiday_place(root=None):
    """(country, region) the profile names, region "" when none; (None, "") when
    it names neither. An old `Holidays:` line reads as GB + GB-ENG for UK, and
    PT for PT; UK wins when both are listed."""
    prof = read(root)
    country = prof.get("country", "").strip().upper()
    if re.fullmatch(r"[A-Z]{2}", country):
        region = prof.get("region", "").strip().upper()
        return country, region if re.fullmatch(r"[A-Z]{2}-[A-Z0-9]{1,3}", region) else ""
    old = re.split(r"[,\s/&]+", prof.get("holidays", "").upper())
    if "UK" in old:
        return "GB", "GB-ENG"
    if "PT" in old:
        return "PT", ""
    return None, ""


def holiday_regions(root=None):
    """The holiday calendars the profile names, as a tuple of keys for todo.py.

    `Country:` gives one key, "CC:REGION". Otherwise the `Holidays:` line gives
    todo.py's built-in "UK" and "PT", both when the line is missing or names
    none it knows. Unknown entries are skipped, so `UK, FR` is just `UK`."""
    import todo  # sits beside this file; imported here so todo can import this one later
    prof = read(root)
    if re.fullmatch(r"[A-Za-z]{2}", prof.get("country", "")):
        country, region = holiday_place(root)
        return ("%s:%s" % (country, region),)
    wanted = re.split(r"[,\s/&]+", prof.get("holidays", "").upper())
    picked = tuple(r for r in todo.REGIONS if r in wanted)
    return picked or tuple(todo.REGIONS)


def facts_file(root=None):
    """The owner's facts file as an absolute path, or None when unset or missing."""
    value = read(root).get("facts file")
    if not value:
        return None
    path = os.path.expanduser(value)
    return path if os.path.isfile(path) else None


def _folder(key, root=None):
    value = read(root).get(key)
    return os.path.expanduser(value) if value else None


def workspace_folder(root=None):
    """The parent folder the agents may read beyond this repo, or None."""
    return _folder("workspace folder", root)


def improve_agent_folder(root=None):
    """Where improve-agent lives, or None."""
    return _folder("improve agent folder", root)


TEMPLATE = os.path.join(ROOT, "agents", "pa_agent", "profile.example.md")
REGION_ORDER = ("UK", "PT")


def needs_setup(root=None):
    """True when there is no profile or its Name is missing or still the placeholder."""
    return "name" not in read(root)


def _set_line(text, key, value):
    """Put `- Key: value` in place of the first line for that key, leaving the rest."""
    lines = text.split("\n")
    pattern = re.compile(r"^(\s*[-*]\s+)%s:.*$" % re.escape(key), re.I)
    for i, line in enumerate(lines):
        m = pattern.match(line)
        if m:
            lines[i] = "%s%s: %s" % (m.group(1), key, value)
            return "\n".join(lines)
    # Not there: add it under About, or at the end when there is no About.
    new = "- %s: %s" % (key, value)
    for i, line in enumerate(lines):
        if re.match(r"^##\s+About\s*$", line):
            j = i + 1
            while j < len(lines) and not lines[j].startswith("## "):
                j += 1
            while j > i + 1 and not lines[j - 1].strip():
                j -= 1
            lines.insert(j, new)
            return "\n".join(lines)
    return text.rstrip("\n") + "\n\n## About\n\n" + new + "\n"


def _drop_line(text, key):
    pattern = re.compile(r"^\s*[-*]\s+%s:" % re.escape(key), re.I)
    return "\n".join(l for l in text.split("\n") if not pattern.match(l))


def write_basics(root=None, name=None, holidays=None, country=None, region=None):
    """Write only the `Name:` line and the holiday lines of the profile.

    `country` and `region` write `Country:` and `Region:` (an empty region
    removes its line) and retire an old `Holidays:` line. The caller checks them
    against the country list. `holidays` is the older way, a list of `UK`, `PT`;
    none picked means both. Every other line stays as it was. A missing file
    starts from the template. Returns an error message, or None."""
    root = root or data_root()
    if name is not None:
        name = " ".join(str(name).split())
        if not name or re.search(r"[<>`]", name):
            return "name must be text without < > or backticks"
    if holidays is not None:
        if not isinstance(holidays, (list, tuple)) or any(h not in REGION_ORDER for h in holidays):
            return "holidays must be a list of: %s" % ", ".join(REGION_ORDER)
    if country is not None:
        country = str(country).strip().upper()
        region = str(region or "").strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", country):
            return "country must be a two-letter code"
        if region and not re.fullmatch(r"%s-[A-Z0-9]{1,3}" % country, region):
            return "region must look like %s-XX" % country
    path = profile_path(root)
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        try:
            with open(TEMPLATE, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            text = "# PA profile\n\n## About\n\n"
    if name is not None:
        text = _set_line(text, "Name", name)
    if country is not None:
        text = _drop_line(text, "Holidays")
        text = _set_line(text, "Country", country)
        text = _drop_line(text, "Region")
        if region:
            text = _set_line(text, "Region", region)
    elif holidays is not None:
        picked = [r for r in REGION_ORDER if r in holidays] or list(REGION_ORDER)
        text = _set_line(text, "Holidays", ", ".join(picked))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)
    return None
