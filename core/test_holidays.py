#!/usr/bin/env python3
"""python3 core/test_holidays.py

No network: every fetch goes through an injected fake, and every data root is a
temp folder.
"""

import datetime as dt
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import holidays  # noqa: E402
import owner_profile  # noqa: E402
import todo  # noqa: E402

COUNTRIES = [{"countryCode": "GB", "name": "United Kingdom"},
             {"countryCode": "DE", "name": "Germany"}]
GB_2026 = [
    {"date": "2026-01-01", "localName": "New Year's Day", "name": "New Year's Day", "global": True, "counties": None, "types": ["Public"]},
    {"date": "2026-01-02", "localName": "2nd January", "name": "2nd January", "global": False, "counties": ["GB-SCT"], "types": ["Public"]},
    {"date": "2026-11-30", "localName": "St Andrew's Day", "name": "St Andrew's Day", "global": False, "counties": ["GB-SCT"], "types": ["Public"]},
    {"date": "2026-07-13", "localName": "Battle of the Boyne", "name": "Battle of the Boyne", "global": False, "counties": ["GB-NIR"], "types": ["Public"]},
    {"date": "2026-12-25", "localName": "Christmas Day", "name": "Christmas Day", "global": True, "counties": None, "types": ["Public"]},
    {"date": "2026-02-14", "localName": "Valentine", "name": "Valentine", "global": True, "counties": None, "types": ["Observance"]},
]


class Fake:
    """A fetcher that serves canned answers and counts its calls."""
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def __call__(self, url):
        self.calls.append(url)
        for tail, data in self.answers.items():
            if url.endswith(tail):
                return data
        raise OSError("offline")


def down(url):
    raise OSError("offline")


class HolidaysTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        holidays._failed.clear()
        todo._CACHE.clear()
        self._env = os.environ.pop("BENCH_HOLIDAYS_FIXTURES", None)
        self.fake = Fake({"AvailableCountries": COUNTRIES, "/2026/GB": GB_2026})

    def tearDown(self):
        self.tmp.cleanup()
        if self._env is not None:
            os.environ["BENCH_HOLIDAYS_FIXTURES"] = self._env

    def test_fetch_then_cache_hit(self):
        got = holidays.holidays(2026, "GB", "GB-SCT", self.root, self.fake)
        self.assertEqual(len(self.fake.calls), 1)
        self.assertTrue(os.path.isfile(os.path.join(self.root, "holidays", "GB-2026.json")))
        again = holidays.holidays(2026, "GB", "GB-SCT", self.root, down)
        self.assertEqual(got, again)
        self.assertEqual(len(self.fake.calls), 1)

    def test_countries_cached_and_sorted(self):
        got = holidays.countries(self.root, self.fake)
        self.assertEqual([c["code"] for c in got], ["DE", "GB"])
        self.assertEqual(holidays.countries(self.root, down), got)

    def test_region_filtering(self):
        scot = holidays.holidays(2026, "GB", "GB-SCT", self.root, self.fake)
        eng = holidays.holidays(2026, "GB", "GB-ENG", self.root, self.fake)
        none = holidays.holidays(2026, "GB", None, self.root, self.fake)
        self.assertEqual(scot[dt.date(2026, 1, 2)], "2nd January")
        self.assertIn(dt.date(2026, 11, 30), scot)
        self.assertIn(dt.date(2026, 1, 1), scot)
        for other in (eng, none):
            self.assertNotIn(dt.date(2026, 1, 2), other)
            self.assertNotIn(dt.date(2026, 11, 30), other)
            self.assertIn(dt.date(2026, 12, 25), other)
        self.assertNotIn(dt.date(2026, 7, 13), eng)
        self.assertNotIn(dt.date(2026, 2, 14), scot)   # an observance is not a day off

    def test_regions_from_counties(self):
        holidays.holidays(2026, "GB", None, self.root, self.fake)
        codes = [r["code"] for r in holidays.regions("GB", self.root, self.fake, 2026)]
        self.assertEqual(codes, ["GB-ENG", "GB-NIR", "GB-SCT", "GB-WLS"])
        names = {r["code"]: r["name"] for r in holidays.regions("GB", self.root, self.fake, 2026)}
        self.assertEqual(names["GB-SCT"], "Scotland")
        self.assertEqual(holidays.regions("DE", self.root, down, 2026), [])

    def test_offline_nothing_cached(self):
        self.assertIsNone(holidays.holidays(2026, "GB", "GB-SCT", self.root, down))
        self.assertEqual([c["code"] for c in holidays.countries(self.root, down)], ["GB", "PT"])

    def test_todo_falls_back_to_builtin_tables_offline(self):
        holidays.FETCH, saved = down, holidays.FETCH
        try:
            os.environ["TODOS_DATA_ROOT"] = self.root
            eng = todo.holidays(2026, ("GB:GB-ENG",))["GB:GB-ENG"]
            self.assertIn(dt.date(2026, 12, 25), eng)
            self.assertIn(dt.date(2026, 5, 25), eng)          # Spring bank holiday, built in
            self.assertIn(dt.date(2026, 6, 10), todo.holidays(2026, ("PT:",))["PT:"])
            # Scotland has no built-in table: no holidays, and the answer is not remembered.
            self.assertEqual(todo.holidays(2026, ("GB:GB-SCT",))["GB:GB-SCT"], {})
            self.assertNotIn(("GB:GB-SCT", 2026), todo._CACHE)
        finally:
            holidays.FETCH = saved
            os.environ.pop("TODOS_DATA_ROOT", None)

    def test_todo_uses_the_fetched_region(self):
        holidays.FETCH, saved = self.fake, holidays.FETCH
        try:
            os.environ["TODOS_DATA_ROOT"] = self.root
            sct, eng = dt.date(2026, 1, 2), dt.date(2026, 1, 2)
            self.assertFalse(todo.is_working_day(sct, ("GB:GB-SCT",)))
            self.assertIn("2nd January", todo.non_working_reason(sct, ("GB:GB-SCT",)))
            self.assertTrue(todo.is_working_day(eng, ("GB:GB-ENG",)))
        finally:
            holidays.FETCH = saved
            os.environ.pop("TODOS_DATA_ROOT", None)

    def test_profile_country_region(self):
        def keys(body):
            with open(os.path.join(self.root, "profile.md"), "w", encoding="utf-8") as fh:
                fh.write("## About\n\n" + body)
            return owner_profile.holiday_place(self.root), owner_profile.holiday_regions(self.root)
        self.assertEqual(keys("- Country: gb\n- Region: GB-SCT\n"), (("GB", "GB-SCT"), ("GB:GB-SCT",)))
        self.assertEqual(keys("- Country: DE\n"), (("DE", ""), ("DE:",)))
        self.assertEqual(keys("- Country: GB\n- Region: nonsense\n")[0], ("GB", ""))

    def test_old_holidays_line_still_works(self):
        def run(body):
            with open(os.path.join(self.root, "profile.md"), "w", encoding="utf-8") as fh:
                fh.write("## About\n\n" + body)
            return owner_profile.holiday_place(self.root), owner_profile.holiday_regions(self.root)
        self.assertEqual(run("- Holidays: UK, PT\n"), (("GB", "GB-ENG"), ("UK", "PT")))
        self.assertEqual(run("- Holidays: PT\n"), (("PT", ""), ("PT",)))
        self.assertEqual(run("- Name: Sam\n"), ((None, ""), ("UK", "PT")))

    def test_write_country_retires_old_line(self):
        with open(os.path.join(self.root, "profile.md"), "w", encoding="utf-8") as fh:
            fh.write("## About\n\n- Name: Sam\n- Holidays: UK, PT\n- Facts file: none\n")
        self.assertIsNone(owner_profile.write_basics(self.root, country="GB", region="GB-SCT"))
        text = open(os.path.join(self.root, "profile.md"), encoding="utf-8").read()
        self.assertNotIn("Holidays:", text)
        self.assertIn("- Country: GB", text)
        self.assertIn("- Region: GB-SCT", text)
        self.assertIn("- Facts file: none", text)
        owner_profile.write_basics(self.root, country="PT", region="")
        text = open(os.path.join(self.root, "profile.md"), encoding="utf-8").read()
        self.assertNotIn("Region:", text)
        self.assertIsNotNone(owner_profile.write_basics(self.root, country="GBR"))
        self.assertIsNotNone(owner_profile.write_basics(self.root, country="GB", region="PT-20"))


if __name__ == "__main__":
    unittest.main()
