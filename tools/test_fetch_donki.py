"""Self-check: fetch_donki.main() keeps good endpoints when one fails. Run: python -m unittest tools/test_fetch_donki.py -v"""
import contextlib
import io
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import fetch_donki  # noqa: E402

SCHEMA = (TOOLS.parent / "db" / "schema.sql").read_text(encoding="utf-8")
CREATE = re.search(r"CREATE TABLE IF NOT EXISTS solar_events \(.*?\n\);", SCHEMA, re.S).group(0)
RECORDS = {"SEP": {"sepID": "s1", "eventTime": "2026-11-01T01:00Z"},
           "CME": {"activityID": "c1", "startTime": "2026-11-02T02:00Z"}}


class FetchDonkiTest(unittest.TestCase):
    def run_main(self, fake_fetch):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "t.db"
            conn = sqlite3.connect(db)
            conn.execute(CREATE)
            conn.commit()
            conn.close()
            with mock.patch.object(fetch_donki, "fetch", fake_fetch), \
                    contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                code = fetch_donki.main(["--days", "1", "--db", str(db)])
            conn = sqlite3.connect(db)
            count = conn.execute("SELECT COUNT(*) FROM solar_events").fetchone()[0]
            conn.close()
            return code, count

    def test_one_endpoint_fails(self):
        def fake(kind, first, last, key):
            if kind == "CME":
                raise fetch_donki.FetchError("NASA DONKI CME returned HTTP 404. Check the API key.")
            return [RECORDS[kind]]
        self.assertEqual(self.run_main(fake), (0, 1))

    def test_all_endpoints_fail(self):
        def fake(kind, first, last, key):
            raise fetch_donki.FetchError(f"NASA DONKI {kind} returned HTTP 404.")
        self.assertEqual(self.run_main(fake), (1, 0))


if __name__ == "__main__":
    unittest.main()
