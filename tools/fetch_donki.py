#!/usr/bin/env python3
"""Pull recent NASA DONKI solar events (SEP, FLR, CME) into the solar_events table.

Usage: set NASA_API_KEY=... && python tools/fetch_donki.py [--days 30] [--db PATH]
Python 3.10+, standard library only (urllib). Contract: docs/CONTRACT.md section 7.
Run tools/seed.py first so the database and tables exist.
"""
import argparse
import http.client
import json
import math
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "https://api.nasa.gov/DONKI"
# Flares now come from tools/fetch_gbm.py because DONKI FLR returns HTTP 404 (Nov 2026).
# Failures are skipped per endpoint.
ENDPOINTS = ("SEP", "CME")
DONKI_SPAN_DAYS = 30          # DONKI date ranges are requested in 30-day windows
SEP_SEVERITY = 0.5            # contract: SEP rows have no class, so severity 0.5
CME_SEVERITY = 0.3            # assumption: DONKI CME records carry no class
TIMEOUT_S = 30
CLASS_RE = re.compile(r"^\s*([ABCMX])\s*(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)
FLUX_BY_LETTER = {"A": 1e-8, "B": 1e-7, "C": 1e-6, "M": 1e-5, "X": 1e-4}


class FetchError(Exception):
    pass


def resolve_path(text):
    path = Path(text)
    return path if path.is_absolute() else ROOT / path


def flare_severity(class_type):
    """Severity 0..1 from a GOES flare class: A1 = 0, X1 = 0.8, X10 and above = 1."""
    match = CLASS_RE.match(class_type or "")
    if not match:
        return None
    flux = FLUX_BY_LETTER[match.group(1).upper()] * float(match.group(2))
    if flux <= 0:
        return None
    return min(max((math.log10(flux) + 8) / 5, 0.0), 1.0)


def norm_time(text):
    """DONKI time text (for example 2026-11-01T12:34Z) to 'YYYY-MM-DDTHH:MM:SSZ', or None."""
    if not text:
        return None
    s = str(text).strip()
    if s[-1:] in ("Z", "z"):
        s = s[:-1]
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def windows(first, last, span=DONKI_SPAN_DAYS):
    cur = first
    while cur <= last:
        stop = min(cur + timedelta(days=span - 1), last)
        yield cur, stop
        cur = stop + timedelta(days=1)


def fetch(kind, first, last, api_key):
    query = urllib.parse.urlencode({
        "startDate": first.isoformat(),
        "endDate": last.isoformat(),
        "api_key": api_key,
    })
    request = urllib.request.Request(
        f"{BASE_URL}/{kind}?{query}",
        headers={"User-Agent": "astro-health-seeder/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        raise FetchError(f"NASA DONKI {kind} returned HTTP {err.code}. Check the API key; "
                         f"DEMO_KEY has a low hourly limit, so wait and retry if you hit it.")
    except (OSError, http.client.HTTPException) as err:  # URLError, timeouts, resets, bad responses
        reason = getattr(err, "reason", err)
        raise FetchError(f"Could not reach NASA DONKI ({kind}): {reason}. "
                         f"Check your internet connection and try again.")
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise FetchError(f"NASA DONKI {kind} sent a response that is not JSON.")
    if not isinstance(data, list):
        raise FetchError(f"NASA DONKI {kind} sent an unexpected response.")
    return data


def to_row(kind, rec):
    """Map one DONKI record to a solar_events row, or None when it lacks an id or start time."""
    if not isinstance(rec, dict):
        return None
    if kind == "SEP":
        event_id, start = rec.get("sepID"), norm_time(rec.get("eventTime"))
        row = {"id": event_id, "event_type": "SEP", "start_time": start, "end_time": None,
               "class_type": None, "severity": SEP_SEVERITY, "dose_relevant": 1, "source": "donki",
               "link": rec.get("link"), "note": None}
    elif kind == "FLR":
        event_id, start = rec.get("flrID"), norm_time(rec.get("beginTime"))
        class_type = rec.get("classType")
        severity = flare_severity(class_type)
        row = {"id": event_id, "event_type": "FLR", "start_time": start,
               "end_time": norm_time(rec.get("endTime")), "class_type": class_type,
               "severity": 0.5 if severity is None else severity, "dose_relevant": 0,
               "source": "donki", "link": rec.get("link"), "note": rec.get("sourceLocation")}
    else:
        event_id, start = rec.get("activityID"), norm_time(rec.get("startTime"))
        row = {"id": event_id, "event_type": "CME", "start_time": start, "end_time": None,
               "class_type": None, "severity": CME_SEVERITY, "dose_relevant": 0, "source": "donki",
               "link": rec.get("link"), "note": rec.get("note")}
    if not event_id or not start:
        return None
    return row


def upsert(conn, row):
    keys = list(row)
    sql = (f"INSERT OR REPLACE INTO solar_events ({', '.join(keys)}) "
           f"VALUES ({', '.join('?' for _ in keys)})")
    conn.execute(sql, [row[k] for k in keys])


def main(argv=None):
    ap = argparse.ArgumentParser(description="Fetch NASA DONKI solar events into solar_events.")
    ap.add_argument("--days", type=int, default=30, help="days back from today to fetch (default 30)")
    ap.add_argument("--api-key", default=os.environ.get("NASA_API_KEY", "DEMO_KEY"),
                    help="NASA API key (default: $NASA_API_KEY, then DEMO_KEY)")
    ap.add_argument("--db", default=None, help="database path (default: $ASTRO_DB or db/astro.db)")
    args = ap.parse_args(argv)
    if args.days < 1:
        ap.error("--days must be at least 1")

    db_path = resolve_path(args.db or os.environ.get("ASTRO_DB") or "db/astro.db")
    if not db_path.is_file():
        print(f"No database at {db_path}. Run: python tools/seed.py", file=sys.stderr)
        return 1

    today = datetime.now(timezone.utc).date()
    first = today - timedelta(days=args.days)
    found = {}
    failed = {}
    for kind in ENDPOINTS:
        rows = {}
        try:
            for w_first, w_last in windows(first, today):
                for rec in fetch(kind, w_first, w_last, args.api_key):
                    row = to_row(kind, rec)
                    if row:
                        rows[row["id"]] = row
        except FetchError as err:
            print(f"Warning: {err} Skipping {kind}.", file=sys.stderr)
            failed[kind] = str(err)
            continue
        found[kind] = rows
    if not found:
        print("Error: every NASA DONKI endpoint failed: " + " ".join(failed.values()), file=sys.stderr)
        return 1

    conn = sqlite3.connect(db_path)
    try:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'solar_events'").fetchone()
        if not has_table:
            print(f"{db_path} has no solar_events table. Run: python tools/seed.py", file=sys.stderr)
            return 1
        with conn:
            for rows in found.values():
                for row in rows.values():
                    upsert(conn, row)
    except sqlite3.Error as err:
        print(f"Error: could not write to {db_path}: {err}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    counts = ", ".join(f"{len(found[k])} {k}" for k in ENDPOINTS if k in found)
    skipped = ""
    if failed:
        # "NASA DONKI FLR returned HTTP 404. Check ..." -> "NASA returned HTTP 404"
        reasons = []
        for k in ENDPOINTS:
            if k in failed:
                m = re.search(r"returned HTTP \d+", failed[k])
                reasons.append(f"{k} (NASA {m.group(0)})" if m else k)
        skipped = " Skipped: " + ", ".join(reasons) + "."
    print(f"Stored NASA DONKI events for the last {args.days} days: {counts}.{skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
