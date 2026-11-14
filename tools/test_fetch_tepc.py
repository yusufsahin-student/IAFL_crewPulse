"""Self-check for fetch_tepc parsing and maths. Run: python -m unittest tools/test_fetch_tepc.py -v"""
import contextlib
import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import fetch_tepc  # noqa: E402

CSV = ("2017-03-01T00:00:00.000Z,0.100,1.000\n"
       "2017-03-01T00:01:00.000Z,-1.0E31,1.000\n"   # fill value in DOSE_EQ60
       "2017-03-01T00:02:00.000Z,0.300,3.000\n"
       "2017-03-01T00:05:00.000Z,0.500,-1.0E31\n"   # fill value in TIME_INTERVAL
       '{"status": {"code": 1200}}\n')


class FetchTepcTest(unittest.TestCase):
    def test_parse_skips_fill_and_junk(self):
        self.assertEqual(fetch_tepc.parse_csv(CSV), [(0.1, 1.0), (0.3, 3.0)])

    def test_time_weighted_mean(self):
        dose, minutes = fetch_tepc.weighted_sums(fetch_tepc.parse_csv(CSV))
        self.assertAlmostEqual(dose / minutes, (0.1 * 1 + 0.3 * 3) / 4)  # not the plain mean 0.2

    def test_unit_conversion(self):
        self.assertAlmostEqual(fetch_tepc.to_msv_day(0.25), 0.36)  # 0.25 uSv/min * 1440 / 1000

    def test_windows_inside_year(self):
        w = fetch_tepc.sample_windows(12, 2)
        self.assertEqual(len(w), 12)
        self.assertEqual(w[0][0].year, 2017)
        self.assertLessEqual(w[-1][1], fetch_tepc.YEAR_START.replace(year=2018))

    def test_patch_seed_changes_only_iss_fields(self):
        text = ('[\n  {"id": "iss", "gcr_msv_per_day": 0.5, "source_ref": "nasa_hrp"},\n'
                '  {"id": "moon", "gcr_msv_per_day": 0.5, "source_ref": "nasa_hrp"}\n]\n')
        out = fetch_tepc.patch_seed(text, 0.123)
        self.assertIn('{"id": "iss", "gcr_msv_per_day": 0.123, "source_ref": "iss_tepc"}', out)
        self.assertIn('{"id": "moon", "gcr_msv_per_day": 0.5, "source_ref": "nasa_hrp"}', out)

    def test_main_updates_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "t.db"
            conn = sqlite3.connect(db)
            conn.execute("CREATE TABLE missions (id TEXT PRIMARY KEY, gcr_msv_per_day REAL, source_ref TEXT)")
            conn.execute("INSERT INTO missions VALUES ('iss', 0.5, 'nasa_hrp')")
            conn.commit()
            conn.close()
            with mock.patch.object(fetch_tepc, "fetch", lambda a, b: "2017-03-01T00:00:00Z,0.25,2.0\n"), \
                    contextlib.redirect_stdout(io.StringIO()):
                code = fetch_tepc.main(["--samples", "2", "--db", str(db)])
            conn = sqlite3.connect(db)
            row = conn.execute("SELECT gcr_msv_per_day, source_ref FROM missions").fetchone()
            conn.close()
        self.assertEqual((code, row), (0, (0.36, "iss_tepc")))


if __name__ == "__main__":
    unittest.main()
