#!/usr/bin/env python3
"""Measure the ISS background dose rate from the TEPC dose analyzer (CDAWeb HAPI, ISS_DOSANL_TEPC).

Usage: python tools/fetch_tepc.py [--days-per-sample 2] [--samples 12] [--db PATH] [--write-seed]
Samples short windows spread over 2017 (dataset covers 2010-04-29 to 2018-04-11), takes the
time-weighted mean of DOSE_EQ60 (uSv/min), converts it to mSv/day and writes it to the `iss`
mission (gcr_msv_per_day, source_ref 'iss_tepc'). With --write-seed the same two fields are
also changed in data/seed/missions.json. Python 3.10+, standard library only (urllib).
"""
import argparse
import http.client
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HAPI_URL = "https://cdaweb.gsfc.nasa.gov/hapi/data"
DATASET = "ISS_DOSANL_TEPC"
YEAR_START = datetime(2017, 1, 1)   # one recent year of the dataset
YEAR_DAYS = 365
TIMEOUT_S = 120
SEED_ISS_LINE = re.compile(r'^\s*\{"id": "iss",.*$', re.M)


class FetchError(Exception):
    pass


def resolve_path(text):
    path = Path(text)
    return path if path.is_absolute() else ROOT / path


def sample_windows(samples, days):
    """`samples` windows of `days` days, evenly spread over the year, each ending inside the year."""
    step = (YEAR_DAYS - days) / max(samples - 1, 1)
    return [(YEAR_START + timedelta(days=round(i * step)),
             YEAR_START + timedelta(days=round(i * step) + days)) for i in range(samples)]


def fetch(start, stop):
    query = urllib.parse.urlencode({
        "id": DATASET, "time.min": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "time.max": stop.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "parameters": "DOSE_EQ60,TIME_INTERVAL", "format": "csv"})
    request = urllib.request.Request(f"{HAPI_URL}?{query}", headers={"User-Agent": "astro-health-seeder/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        raise FetchError(f"CDAWeb HAPI returned HTTP {err.code} for {start:%Y-%m-%d}. Try again later.")
    except (OSError, http.client.HTTPException) as err:
        reason = getattr(err, "reason", err)
        raise FetchError(f"Could not reach CDAWeb HAPI: {reason}. Check your internet connection and try again.")


def parse_csv(text):
    """(dose_uSv_per_min, minutes) pairs from HAPI CSV 'time,DOSE_EQ60,TIME_INTERVAL'.

    Fill values (-1e31), negative and zero entries are skipped (zero = no reading, e.g. all of 2017-01-01..03); so are lines that are not data
    (HAPI error JSON, blank lines).
    """
    pairs = []
    for line in text.splitlines():
        parts = line.split(",")
        if len(parts) != 3:
            continue
        try:
            dose, minutes = float(parts[1]), float(parts[2])
        except ValueError:
            continue
        if dose <= 0 or minutes <= 0:  # 0.000 for a whole window means the instrument was off
            continue
        pairs.append((dose, minutes))
    return pairs


def weighted_sums(pairs):
    """(sum of dose*minutes, sum of minutes): time-weighted, so windows can be combined exactly."""
    return sum(d * m for d, m in pairs), sum(m for _, m in pairs)


def to_msv_day(usv_per_min):
    return usv_per_min * 1440 / 1000


def patch_seed(text, msv_day):
    """Change gcr_msv_per_day and source_ref on the iss row only; the rest of the text is untouched."""
    def fix(m):
        line = re.sub(r'"gcr_msv_per_day": [0-9.]+', f'"gcr_msv_per_day": {msv_day}', m.group(0))
        return re.sub(r'"source_ref": "[^"]*"', '"source_ref": "iss_tepc"', line)
    new, n = SEED_ISS_LINE.subn(fix, text, count=1)
    if not n:
        raise ValueError("no iss row in missions.json")
    return new


def main(argv=None):
    ap = argparse.ArgumentParser(description="Measure the ISS background dose from TEPC data.")
    ap.add_argument("--days-per-sample", type=int, default=2, help="days in each sample window (default 2)")
    ap.add_argument("--samples", type=int, default=12, help="number of windows across 2017 (default 12)")
    ap.add_argument("--db", default=None, help="database path (default: $ASTRO_DB or db/astro.db)")
    ap.add_argument("--write-seed", action="store_true", help="also update data/seed/missions.json")
    args = ap.parse_args(argv)
    if args.days_per_sample < 1 or args.samples < 1:
        ap.error("--days-per-sample and --samples must be at least 1")

    db_path = resolve_path(args.db or os.environ.get("ASTRO_DB") or "db/astro.db")
    if not db_path.is_file():
        print(f"No database at {db_path}. Run: python tools/seed.py", file=sys.stderr)
        return 1

    total_dose = total_min = 0.0
    print(f"ISS TEPC DOSE_EQ60, {args.samples} windows of {args.days_per_sample} days in 2017:")
    for start, stop in sample_windows(args.samples, args.days_per_sample):
        try:
            pairs = parse_csv(fetch(start, stop))
        except FetchError as err:
            print(f"Error: {err}", file=sys.stderr)
            return 1
        dose, minutes = weighted_sums(pairs)
        if minutes <= 0:
            print(f"  {start:%Y-%m-%d} to {stop:%Y-%m-%d}: no valid data")
            continue
        total_dose += dose
        total_min += minutes
        print(f"  {start:%Y-%m-%d} to {stop:%Y-%m-%d}: {to_msv_day(dose / minutes):.3f} mSv/day "
              f"({len(pairs)} records, {minutes / 60:.1f} h)")
    if total_min <= 0:
        print("Error: no valid TEPC data in any window.", file=sys.stderr)
        return 1
    msv_day = round(to_msv_day(total_dose / total_min), 3)
    print(f"Overall time-weighted mean: {msv_day} mSv/day ({total_min / 60:.1f} h of data)")

    conn = sqlite3.connect(db_path)
    try:
        with conn:
            cur = conn.execute("UPDATE missions SET gcr_msv_per_day = ?, source_ref = 'iss_tepc' "
                               "WHERE id = 'iss'", (msv_day,))
    except sqlite3.Error as err:
        print(f"Error: could not write to {db_path}: {err}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    if cur.rowcount != 1:
        print(f"{db_path} has no iss mission. Run: python tools/seed.py", file=sys.stderr)
        return 1
    print(f"Updated mission iss in {db_path.name}: gcr_msv_per_day = {msv_day}, source_ref = iss_tepc.")

    if args.write_seed:
        seed = ROOT / "data" / "seed" / "missions.json"
        try:
            text = seed.read_text(encoding="utf-8")
            with open(seed, "w", encoding="utf-8", newline="") as f:
                f.write(patch_seed(text, msv_day))
        except (OSError, ValueError) as err:
            print(f"Error: could not update {seed}: {err}", file=sys.stderr)
            return 1
        print(f"Updated {seed.relative_to(ROOT)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
