"""Self-check for fetch_gbm parsing. Run: python -m unittest tools/test_fetch_gbm.py -v"""
import re
import sqlite3
import sys
import unittest
from datetime import datetime
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import fetch_gbm  # noqa: E402

SAMPLE = """Fermi GBM Flare List  (generated 12-Nov-2026 05:05)

Total # flares: 3  Time range: 12-Aug-2008 00:00:00.000 - 11-Nov-2026 00:00:00.000

   Flare         Start time        Peak      End      Dur    Peak      Total   Sunward       Trigger         RHESSI
                                                        s     c/s     Counts  Detectors                     Flare #

 081102_2014  2-Nov-2008 20:14:55 20:15:07 20:16:12    78    3646     172685  n0 n3 n6 n1
 261110_2350 10-Nov-2026 23:50:10 23:55:00 00:06:51  1535   11327    1660227  n5 n1 n3 n4     bn261110415
 261111_2119 11-Nov-2026 21:19:49 21:19:53 21:35:10   922  900000     452723  n5 n4 n2 n1

Notes:
  Flare - Flare number constructed from start time of flare: yymmdd_hhmm
"""


class FetchGbmTest(unittest.TestCase):
    def test_parse_filters_and_skips_text(self):
        rows = fetch_gbm.parse(SAMPLE, datetime(2026, 11, 1))
        self.assertEqual([r["id"] for r in rows], ["GBM-261110_2350", "GBM-261111_2119"])

    def test_midnight_crossing_and_fields(self):
        row = fetch_gbm.parse(SAMPLE, datetime(2026, 11, 1))[0]
        self.assertEqual(row["start_time"], "2026-11-10T23:50:10Z")
        self.assertEqual(row["end_time"], "2026-11-11T00:06:51Z")
        self.assertEqual((row["event_type"], row["class_type"], row["dose_relevant"], row["source"]),
                         ("FLR", None, 0, "gbm"))
        self.assertEqual(row["note"], "Fermi GBM peak 11327 counts/s")

    def test_wide_window_keeps_old_rows(self):
        rows = fetch_gbm.parse(SAMPLE, datetime(2008, 1, 1))
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["start_time"], "2008-11-02T20:14:55Z")

    def test_severity_clamped(self):
        self.assertEqual(fetch_gbm.severity(500), 0.0)
        self.assertEqual(fetch_gbm.severity(10_000_000), 1.0)
        self.assertEqual(fetch_gbm.severity(10_000), 0.5)
        self.assertEqual(fetch_gbm.severity(0), 0.0)

    def test_rows_fit_schema_check(self):
        schema = (TOOLS.parent / "db" / "schema.sql").read_text(encoding="utf-8")
        create = re.search(r"CREATE TABLE IF NOT EXISTS solar_events \(.*?\n\);", schema, re.S).group(0)
        conn = sqlite3.connect(":memory:")
        conn.execute(create)
        for row in fetch_gbm.parse(SAMPLE, datetime(2008, 1, 1)):
            fetch_gbm.upsert(conn, row)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM solar_events").fetchone()[0], 3)


if __name__ == "__main__":
    unittest.main()
