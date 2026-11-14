#!/usr/bin/env python3
"""Load recent flares from the NASA Fermi GBM Solar Flare List into the solar_events table.

Usage: python tools/fetch_gbm.py [--days 30] [--db PATH] [--url URL]
Python 3.10+, standard library only (urllib). Replaces the DONKI FLR endpoint (HTTP 404).
Run tools/seed.py first so the database and tables exist.
"""
import argparse
import http.client
import math
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIST_URL = "https://hesperia.gsfc.nasa.gov/fermi/gbm/qlook/fermi_gbm_flare_list.txt"
TIMEOUT_S = 60
MONTHS = {m: i for i, m in enumerate(
    ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}
# Row: " 261110_0941 10-Nov-2026 09:41:16 09:56:56 10:06:51  1535   11327    1660227  n5 n1 ..."
ROW_RE = re.compile(
    r"^\s*(\d{6}_\d{4})\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d\d:\d\d:\d\d)\s+(\d\d:\d\d:\d\d)"
    r"\s+(\d\d:\d\d:\d\d)\s+\d+\s+(\d+)\s+\d+")


class FetchError(Exception):
    pass


def resolve_path(text):
    path = Path(text)
    return path if path.is_absolute() else ROOT / path


def severity(peak_counts):
    """Severity 0..1 from the peak rate in counts/s: 1,000 = 0, 100,000 and above = 1 (log scale)."""
    # assumption: GBM gives counts, not a GOES class, so this log scale is a modelling choice
    if peak_counts <= 0:
        return 0.0
    return round(min(max((math.log10(peak_counts) - 3) / 2, 0.0), 1.0), 3)


def fetch_text(url):
    request = urllib.request.Request(url, headers={"User-Agent": "astro-health-seeder/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as resp:
            return resp.read().decode("latin-1")  # footer has a non-ASCII angstrom sign
    except urllib.error.HTTPError as err:
        raise FetchError(f"Fermi GBM flare list returned HTTP {err.code}. Try again later.")
    except (OSError, http.client.HTTPException) as err:
        reason = getattr(err, "reason", err)
        raise FetchError(f"Could not reach the Fermi GBM flare list: {reason}. "
                         f"Check your internet connection and try again.")


def parse(text, since, url=LIST_URL):
    """Rows for flares that start at or after `since` (naive UTC datetime). Header and footer lines are skipped."""
    rows = []
    for line in text.splitlines():
        m = ROW_RE.match(line)
        if not m or m.group(3) not in MONTHS:
            continue
        flare_id, day, mon, year, t_start, _peak, t_end, peak_counts = m.groups()
        try:
            date = datetime(int(year), MONTHS[mon], int(day))
            start = datetime.fromisoformat(f"{date:%Y-%m-%d}T{t_start}")
            end = datetime.fromisoformat(f"{date:%Y-%m-%d}T{t_end}")
        except ValueError:
            continue
        if end < start:  # flare crosses midnight
            end += timedelta(days=1)
        if start < since:
            continue
        peak = int(peak_counts)
        rows.append({"id": f"GBM-{flare_id}", "event_type": "FLR",
                     "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "end_time": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "class_type": None, "severity": severity(peak), "dose_relevant": 0,
                     "source": "gbm", "link": url, "note": f"Fermi GBM peak {peak} counts/s"})
    return rows


def upsert(conn, row):
    keys = list(row)
    sql = (f"INSERT OR REPLACE INTO solar_events ({', '.join(keys)}) "
           f"VALUES ({', '.join('?' for _ in keys)})")
    conn.execute(sql, [row[k] for k in keys])


def main(argv=None):
    ap = argparse.ArgumentParser(description="Load Fermi GBM solar flares into solar_events.")
    ap.add_argument("--days", type=int, default=30, help="days back from now to keep (default 30)")
    ap.add_argument("--db", default=None, help="database path (default: $ASTRO_DB or db/astro.db)")
    ap.add_argument("--url", default=LIST_URL, help="flare list URL")
    args = ap.parse_args(argv)
    if args.days < 1:
        ap.error("--days must be at least 1")

    db_path = resolve_path(args.db or os.environ.get("ASTRO_DB") or "db/astro.db")
    if not db_path.is_file():
        print(f"No database at {db_path}. Run: python tools/seed.py", file=sys.stderr)
        return 1
    try:
        text = fetch_text(args.url)
    except FetchError as err:
        print(f"Error: {err}", file=sys.stderr)
        return 1
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=args.days)
    rows = parse(text, since, args.url)

    conn = sqlite3.connect(db_path)
    try:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'solar_events'").fetchone()
        if not has_table:
            print(f"{db_path} has no solar_events table. Run: python tools/seed.py", file=sys.stderr)
            return 1
        with conn:
            for row in rows:
                upsert(conn, row)
    except sqlite3.Error as err:
        print(f"Error: could not write to {db_path}: {err}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    print(f"Stored {len(rows)} Fermi GBM flares for the last {args.days} days.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
