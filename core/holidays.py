#!/usr/bin/env python3
"""Public holidays for any country, from the Nager.Date API, cached on disk.

    countries()                   [{"code", "name"}], fetched once
    regions(country)              [{"code", "name"}] a country's regions
    holidays(year, country, region)   {date: name}, or None when nothing is known

Nager.Date needs no key. `data/holidays/` holds what it returned:
`countries.json` and one `<CC>-<year>.json` per country and year. A cached file
is used as it is and never refetched, because a year's holidays do not change.

Everything here has to work offline, since the PA's checker and the board both
call it. A failed fetch is not an error: `holidays()` returns None and the
caller (todo.py) falls back to its built-in England and Wales and Portugal
tables, or to no holidays with a one-line warning on stderr. After a failure
the network is left alone for ten minutes, so the companion asking once a
minute does not wait on a timeout each time.

A holiday applies to a region when Nager marks it `global` or lists the region's
code in `counties` (GB-SCT, PT-20). With no region only the global ones apply.

Tests inject `FETCH`, or set `BENCH_HOLIDAYS_FIXTURES` to a folder holding
`countries.json` and `<CC>-<year>.json`; a file missing from it counts as a
failed fetch.
"""

import datetime as dt
import json
import os
import sys
import time
import urllib.request

API = "https://date.nager.at/api/v3"
TIMEOUT = 4
RETRY_AFTER = 600

# Nager gives county codes and no names. The rest show their code.
REGION_NAMES = {
    "GB-ENG": "England", "GB-SCT": "Scotland", "GB-WLS": "Wales",
    "GB-NIR": "Northern Ireland",
}
# Offline, before any country list has been cached.
BUILTIN_COUNTRIES = [{"code": "GB", "name": "United Kingdom"}, {"code": "PT", "name": "Portugal"}]

_failed = {}      # url -> time of the last failure
_warned = set()


def _default_fetch(url):
    fixtures = os.environ.get("BENCH_HOLIDAYS_FIXTURES")
    if fixtures:
        name = url[len(API):].strip("/")
        name = "countries" if name == "AvailableCountries" else name.split("/", 1)[1].replace("/", "-")
        with open(os.path.join(fixtures, name + ".json"), encoding="utf-8") as fh:
            return json.load(fh)
    req = urllib.request.Request(url, headers={"User-Agent": "bench"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


FETCH = _default_fetch


def _cache_dir(root=None):
    if root is None:
        import owner_profile
        root = owner_profile.data_root()
    return os.path.join(root, "holidays")


def _read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _write(path, data):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, path)
    except OSError:
        pass


def _load(url, path, fetch=None):
    """The cached file when there is one, else a fetch (which is then cached).
    None when neither works."""
    data = _read(path)
    if data is not None:
        return data
    if time.time() - _failed.get(url, 0) < RETRY_AFTER:
        return None
    try:
        data = (fetch or FETCH)(url)
    except Exception:  # offline, timeout, bad JSON, missing fixture: all the same here
        _failed[url] = time.time()
        return None
    if not isinstance(data, list):
        _failed[url] = time.time()
        return None
    _write(path, data)
    return data


def countries(root=None, fetch=None):
    """[{"code", "name"}] sorted by name. The built-in pair when nothing is cached
    and the fetch fails."""
    data = _load(API + "/AvailableCountries", os.path.join(_cache_dir(root), "countries.json"), fetch)
    out = []
    for c in data or []:
        if isinstance(c, dict) and c.get("countryCode") and c.get("name"):
            out.append({"code": str(c["countryCode"]).upper(), "name": c["name"]})
    return sorted(out, key=lambda c: c["name"]) or [dict(c) for c in BUILTIN_COUNTRIES]


def country_name(code, root=None):
    for c in countries(root):
        if c["code"] == code:
            return c["name"]
    return code


def _raw(year, country, root=None, fetch=None):
    return _load("%s/PublicHolidays/%d/%s" % (API, year, country),
                 os.path.join(_cache_dir(root), "%s-%d.json" % (country, year)), fetch)


def _counted(h):
    """Optional days and observances are not days off."""
    types = h.get("types") or []
    return not types or any(t not in ("Optional", "Observance") for t in types)


def holidays(year, country, region=None, root=None, fetch=None):
    """{date: name} of the days off in this country (and region) that year, or
    None when there is no cache and the fetch failed."""
    data = _raw(year, country, root, fetch)
    if data is None:
        return None
    out = {}
    for h in data:
        try:
            date = dt.date.fromisoformat(h["date"])
        except (KeyError, TypeError, ValueError):
            continue
        counties = h.get("counties") or []
        if not _counted(h):
            continue
        if h.get("global") or (region and region in counties):
            out.setdefault(date, h.get("name") or h.get("localName") or "Public holiday")
    return out


def regions(country, root=None, fetch=None, year=None):
    """[{"code", "name"}] for the regions the country's holidays mention this
    year. Empty for a country with none."""
    data = _raw(year or dt.date.today().year, country, root, fetch) or []
    seen = set()
    for h in data:
        for c in h.get("counties") or []:
            seen.add(c)
    if country == "GB":
        seen |= set(REGION_NAMES)
    return [{"code": c, "name": REGION_NAMES.get(c, c)} for c in sorted(seen)]


def warn(message):
    """One line on stderr, once per message."""
    if message not in _warned:
        _warned.add(message)
        print("holidays: " + message, file=sys.stderr)
