#!/usr/bin/env python3
"""Build db/astro.db: schema, reference seed files and simulated history.

Usage: python tools/seed.py [--db PATH] [--days 60] [--fresh] [--seed 7]
Python 3.10+, standard library only. Contract: docs/CONTRACT.md section 7.
"""
import argparse
import json
import math
import os
import random
import re
import sqlite3
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "db" / "schema.sql"
SEED_DIR = ROOT / "data" / "seed"

# Foreign-key order: each table comes after the tables it references.
SEED_TABLES = [
    "sources", "missions", "body_regions", "indicators", "indicator_adjustments",
    "bone_sites", "habitat_zones", "guidance", "triage_actions", "model_params",
    "astronauts", "bone_baselines",
]
COUNT_TABLES = ["meta"] + SEED_TABLES + ["solar_events", "checkins", "readings", "exposure_log", "cabin_readings", "gravity_readings"]

OFFSET_RE = re.compile(r"^OFFSET:(-?\d+)$")

# Demo settings for the simulated history (not thresholds; the app reads thresholds from the db).
SEP_DAYS_AGO = 3              # the simulated solar particle event started this many days ago
SEP_START_HOUR_UTC = 4
SEP_DURATION_H = 30
SEP_SEVERITY = 0.8
STORM_SHELTER_HOURS = 20.0    # hours per storm day spent in the shelter zone
POST_STORM_DAYS = 2           # days after the storm that show worse head readings
POST_STORM_FACTOR = 0.12      # 12 percent worse: lower for "higher is better", higher otherwise
OPTIONAL_READING_RATE = 0.9   # share of days an optional indicator is asked
ANOMALY_ALERT_RATE = 0.2      # share of planted anomalies that reach alert (rest are watch)


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None)


def stamp(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_path(text):
    path = Path(text)
    return path if path.is_absolute() else ROOT / path


def day_range(first, last):
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def convert(value, today):
    """Lists/dicts become JSON text; 'OFFSET:-N' dates become today minus N days."""
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, str):
        match = OFFSET_RE.match(value)
        if match:
            return (today + timedelta(days=int(match.group(1)))).isoformat()
    return value


def load_seed(table, today):
    path = SEED_DIR / f"{table}.json"
    if not path.is_file():
        sys.exit(f"Missing seed file: {path}")
    with path.open(encoding="utf-8") as fh:
        rows = json.load(fh)
    if not isinstance(rows, list):
        sys.exit(f"{path} must hold a JSON array of row objects")
    return [{k: convert(v, today) for k, v in row.items()} for row in rows]


def insert(conn, table, rows):
    known = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    for i, row in enumerate(rows):
        extra = set(row) - known
        if extra:
            sys.exit(f"{table} row {i}: unknown column(s) {sorted(extra)}")
        keys = list(row)
        sql = f"INSERT INTO {table} ({', '.join(keys)}) VALUES ({', '.join('?' for _ in keys)})"
        conn.execute(sql, [row[k] for k in keys])
    return len(rows)


def open_db(db_path, fresh):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if fresh and db_path.exists():
        for suffix in ("", "-journal", "-wal", "-shm"):
            leftover = Path(str(db_path) + suffix)
            if leftover.exists():
                leftover.unlink()
    conn = sqlite3.connect(db_path, isolation_level=None)  # explicit BEGIN/COMMIT below
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    if conn.execute("SELECT COUNT(*) FROM meta").fetchone()[0] > 0:
        conn.close()
        sys.exit(f"{db_path} already holds seeded data. Re-run with --fresh to rebuild it.")
    return conn


# ---- simulation helpers -------------------------------------------------------

def profile(ind):
    """Typical value and day-to-day spread, derived from the Earth range in the row."""
    lo, hi = ind["normal_low"], ind["normal_high"]
    pmin, pmax = ind["min_plausible"], ind["max_plausible"]
    if lo is not None and hi is not None:
        return (lo + hi) / 2, max((hi - lo) / 12, 1e-6)
    spread = max((pmax - pmin) / 16, 1e-6)
    if lo is not None:
        return lo + 0.25 * (pmax - lo), spread
    if hi is not None:
        return hi - 0.25 * (hi - pmin), spread
    return (pmin + pmax) / 2, spread


def personal_mean(ind, mean, sd, rng):
    """One astronaut's usual value, kept inside the normal range."""
    lo, hi = ind["normal_low"], ind["normal_high"]
    safe_lo = lo + 2 * sd if lo is not None else ind["min_plausible"] + sd
    safe_hi = hi - 2 * sd if hi is not None else ind["max_plausible"] - sd
    if safe_lo > safe_hi:
        return mean
    return min(max(mean + rng.gauss(0, sd), safe_lo), safe_hi)


def sample(ind, mean, sd, factor, rng):
    raw = rng.gauss(mean, sd) * factor
    step = ind["step"] or 1
    value = round(raw / step) * step
    value = min(max(value, ind["min_plausible"]), ind["max_plausible"])
    if ind["input_type"] == "scale" or ind["decimals"] == 0:
        return float(round(value))
    return round(value, ind["decimals"])


def status_of(ind, value):
    """Status from the Earth bounds only (the simulation does not apply adjustments)."""
    if ind["critical_low"] is not None and value < ind["critical_low"]:
        return "alert"
    if ind["critical_high"] is not None and value > ind["critical_high"]:
        return "alert"
    if ind["normal_low"] is not None and value < ind["normal_low"]:
        return "watch"
    if ind["normal_high"] is not None and value > ind["normal_high"]:
        return "watch"
    return "normal"


def push_out(ind, target, rng):
    """A plausible value that lands in the target status, or None if none is found."""
    directions = []
    if ind["normal_high"] is not None:
        directions.append(1)
    if ind["normal_low"] is not None:
        directions.append(-1)
    if not directions:
        return None
    d = rng.choice(directions)
    edge = ind["normal_high"] if d == 1 else ind["normal_low"]
    step = ind["step"] or 1
    for k in range(1, 200):
        value = round(edge + d * k * step, ind["decimals"])
        if value < ind["min_plausible"] or value > ind["max_plausible"]:
            return None
        if status_of(ind, value) == target:
            return float(value)
    return None


def plan_anomalies(n, ml_inds, indicators, rng, force_today):
    """Map check-in offset k (0 = today) to {indicator_id: target status} for a few planted days."""
    plan = {}
    picks = rng.sample(range(3, n), min(rng.choice([2, 3]), max(0, n - 3)))
    for k in picks:
        ind = rng.choice(ml_inds)
        target = "alert" if rng.random() < ANOMALY_ALERT_RATE else "watch"
        plan.setdefault(k, {})[ind["id"]] = target
    if force_today:
        ind = next(i for i in indicators if i["normal_high"] is not None)
        plan.setdefault(0, {})[ind["id"]] = "watch"
    return plan


def storm_hours(zones, shelter):
    """Most hours in the shelter; the rest spread over other zones in their usual proportions."""
    others = [z for z in zones if z["id"] != shelter["id"]]
    spare = 24.0 - STORM_SHELTER_HOURS
    total = sum(z["default_hours"] for z in others) or 1.0
    hours = {z["id"]: round(spare * z["default_hours"] / total, 2) for z in others}
    hours[shelter["id"]] = round(24.0 - sum(hours.values()), 2)
    return hours


def personal_normal_low(ind_id, default_nl, astro, params, current_year):
    """Personalized lower normal bound for kcal_intake (EER) and grip_strength (EWGSOP2)."""
    if not astro or not params:
        return default_nl
    sex = astro.get("sex")
    if ind_id == "kcal_intake":
        by = astro.get("birth_year")
        h_cm = astro.get("height_cm")
        m_kg = astro.get("preflight_mass_kg")
        if (
            sex not in ("M", "F")
            or by is None or h_cm is None or m_kg is None
            or by <= 1900 or by >= current_year or h_cm <= 0 or m_kg <= 0
        ):
            return default_nl
        age = current_year - by
        h_m = h_cm / 100.0
        act = params.get("kcal.activity_factor")
        keys = (
            ("kcal.eer_m_const", "kcal.eer_m_age", "kcal.eer_m_mass", "kcal.eer_m_height")
            if sex == "M"
            else ("kcal.eer_f_const", "kcal.eer_f_age", "kcal.eer_f_mass", "kcal.eer_f_height")
        )
        if act is None or any(params.get(k) is None for k in keys):
            return default_nl
        c_const, c_age, c_mass, c_height = (params[k] for k in keys)
        eer = c_const - c_age * age + act * (c_mass * m_kg + c_height * h_m)
        # math.floor(x + 0.5) matches Rust's f64::round() (half away from zero for positive EER)
        return math.floor(eer / 10.0 + 0.5) * 10.0
    if ind_id == "grip_strength":
        if sex == "M" and params.get("grip.normal_low_m") is not None:
            return params["grip.normal_low_m"]
        if sex == "F" and params.get("grip.normal_low_f") is not None:
            return params["grip.normal_low_f"]
        return default_nl
    return default_nl


def simulate(conn, days, today, rng):
    now = now_utc()
    indicators = [dict(r) for r in conn.execute("SELECT * FROM indicators ORDER BY display_order, id")]
    astronauts = [dict(r) for r in conn.execute("SELECT * FROM astronauts ORDER BY id")]
    params = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM model_params")}
    mission_gravity = {r["id"]: r["gravity_g"] for r in conn.execute("SELECT id, gravity_g FROM missions")}
    zones_by_mission = {}
    for r in conn.execute("SELECT * FROM habitat_zones ORDER BY mission_id, display_order, id"):
        zones_by_mission.setdefault(r["mission_id"], []).append(dict(r))
    ml_inds = [i for i in indicators
               if i["ml_feature"] and (i["normal_low"] is not None or i["normal_high"] is not None)]

    # One strong particle event, plus a few minor flares and a CME.
    def at(days_ago, hour):
        return datetime.combine(today - timedelta(days=days_ago), time(hour))

    sep_start = datetime.combine(today - timedelta(days=SEP_DAYS_AGO), time(SEP_START_HOUR_UTC))
    sep_end = sep_start + timedelta(hours=SEP_DURATION_H)
    storm_days = set(day_range(sep_start.date(), sep_end.date()))
    post_days = {sep_end.date() + timedelta(days=i) for i in range(1, POST_STORM_DAYS + 1)}

    events = [
        {"id": "sim-sep-1", "event_type": "SEP", "start_time": stamp(sep_start), "end_time": stamp(sep_end),
         "class_type": None, "severity": SEP_SEVERITY, "dose_relevant": 1, "source": "sim", "link": None,
         "note": "Simulated solar particle event for the demo. Not a real event."},
        {"id": "sim-flr-1", "event_type": "FLR", "start_time": stamp(at(25, 14)), "end_time": stamp(at(25, 16)),
         "class_type": "M1.8", "severity": 0.65, "dose_relevant": 0, "source": "sim", "link": None,
         "note": "Simulated flare for the demo."},
        {"id": "sim-flr-2", "event_type": "FLR", "start_time": stamp(at(18, 9)), "end_time": stamp(at(18, 10)),
         "class_type": "C4.2", "severity": 0.52, "dose_relevant": 0, "source": "sim", "link": None,
         "note": "Simulated flare for the demo."},
        {"id": "sim-cme-1", "event_type": "CME", "start_time": stamp(at(12, 3)), "end_time": None,
         "class_type": None, "severity": 0.3, "dose_relevant": 0, "source": "sim", "link": None,
         "note": "Simulated coronal mass ejection for the demo."},
        {"id": "sim-flr-3", "event_type": "FLR", "start_time": stamp(at(6, 21)), "end_time": stamp(at(6, 23)),
         "class_type": "M2.5", "severity": 0.68, "dose_relevant": 0, "source": "sim", "link": None,
         "note": "Simulated flare for the demo."},
    ]
    insert(conn, "solar_events", events)

    conn.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
        ("schema_version", "1"),
        ("seeded_at", stamp(now)),
        ("seed_today", today.isoformat()),
    ])

    for idx, astro in enumerate(astronauts):
        start = date.fromisoformat(astro["mission_start"])
        mday_today = (today - start).days + 1
        if mday_today < 1:
            continue
        n = min(days, mday_today)
        zones = zones_by_mission.get(astro["mission_id"], [])
        if not zones:
            sys.exit(f"No habitat zones for mission {astro['mission_id']}")

        astro_inds = []
        for ind in indicators:
            row = dict(ind)
            row["normal_low"] = personal_normal_low(ind["id"], ind["normal_low"], astro, params, today.year)
            astro_inds.append(row)
        astro_ml_inds = [i for i in astro_inds
                         if i["ml_feature"] and (i["normal_low"] is not None or i["normal_high"] is not None)]

        profiles = {}
        for ind in astro_inds:
            mean, sd = profile(ind)
            profiles[ind["id"]] = (personal_mean(ind, mean, sd, rng), sd)
        plan = plan_anomalies(n, astro_ml_inds, astro_inds, rng, force_today=(idx == 1))

        for k in range(n):
            day = today - timedelta(days=k)
            taken = datetime.combine(day, time(rng.randint(6, 9), rng.randint(0, 59), rng.randint(0, 59)))
            taken = min(taken, now)
            cur = conn.execute(
                "INSERT INTO checkins (astronaut_id, taken_at, mission_day, source, notes) "
                "VALUES (?, ?, ?, 'sim', NULL)",
                (astro["id"], stamp(taken), mday_today - k))
            checkin_id = cur.lastrowid
            forced = plan.get(k, {})
            after_storm = day in post_days
            for ind in astro_inds:
                iid = ind["id"]
                if not (ind["required"] or iid in forced or rng.random() < OPTIONAL_READING_RATE):
                    continue
                value = push_out(ind, forced[iid], rng) if iid in forced else None
                if value is None:
                    mean_p, sd = profiles[iid]
                    factor = 1.0
                    if after_storm and ind["body_region_id"] == "head" and ind["higher_is_better"] is not None:
                        factor = 1 - POST_STORM_FACTOR if ind["higher_is_better"] == 1 else 1 + POST_STORM_FACTOR
                    value = sample(ind, mean_p, sd, factor, rng)
                conn.execute(
                    "INSERT INTO readings (checkin_id, indicator_id, value, method) VALUES (?, ?, ?, 'sim')",
                    (checkin_id, iid, value))

        shelter = next((z for z in zones if z["is_shelter"]), None)
        for k in range(n):
            day = today - timedelta(days=k)
            if shelter is not None and day in storm_days:
                hours = storm_hours(zones, shelter)
            else:
                hours = {z["id"]: z["default_hours"] for z in zones}
            for zone_id, h in hours.items():
                if h > 0:
                    conn.execute(
                        "INSERT INTO exposure_log (astronaut_id, day, zone_id, hours) VALUES (?, ?, ?, ?)",
                        (astro["id"], day.isoformat(), zone_id, h))

    # Daily cabin context per mission. These simulated observations are displayed alongside
    # health history, but deliberately do not alter the health score.
    for mission_id in sorted(zones_by_mission):
        co2_base = rng.uniform(720, 880)
        temp_base = rng.uniform(21.5, 23.5)
        humidity_base = rng.uniform(38.0, 50.0)
        first_day = today - timedelta(days=max(0, days - 1))
        for index, cabin_day in enumerate(day_range(first_day, today)):
            taken = min(datetime.combine(cabin_day, time(8)), now)
            cycle = math.sin(index * math.tau / 14)
            conn.execute(
                "INSERT INTO cabin_readings (mission_id, taken_at, co2_ppm, temperature_c, humidity_pct, source) "
                "VALUES (?, ?, ?, ?, ?, 'sim')",
                (mission_id, stamp(taken), round(co2_base + 45 * cycle + rng.uniform(-25, 25)),
                 round(temp_base + 0.5 * cycle + rng.uniform(-0.25, 0.25), 1),
                 round(humidity_base - 2.5 * cycle + rng.uniform(-1.5, 1.5), 1)))

    # Daily gravity context uses the configured mission profile. Future imports can provide
    # time-varying sensor/profile values through the same table and API.
    for mission_id, gravity_g in sorted(mission_gravity.items()):
        first_day = today - timedelta(days=max(0, days - 1))
        partial = 0 < gravity_g < 1
        uncertainty = 0.08 if partial else 0.0
        for gravity_day in day_range(first_day, today):
            observed = min(datetime.combine(gravity_day, time(8)), now)
            conn.execute(
                "INSERT INTO gravity_readings (mission_id, observed_at, gravity_g, uncertainty_low_g, uncertainty_high_g, source) "
                "VALUES (?, ?, ?, ?, ?, 'mission_profile_sim')",
                (mission_id, stamp(observed), gravity_g,
                 max(0, gravity_g - uncertainty), min(2, gravity_g + uncertainty)))


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build the astronaut health database.")
    ap.add_argument("--db", default=None, help="database path (default: $ASTRO_DB or db/astro.db)")
    ap.add_argument("--days", type=int, default=60, help="days of simulated history, ending today (default 60)")
    ap.add_argument("--fresh", action="store_true", help="delete the database first")
    ap.add_argument("--seed", type=int, default=7, help="random seed (default 7)")
    args = ap.parse_args(argv)
    if args.days < 1:
        ap.error("--days must be at least 1")

    db_path = resolve_path(args.db or os.environ.get("ASTRO_DB") or "db/astro.db")
    today = datetime.now(timezone.utc).date()
    try:
        conn = open_db(db_path, args.fresh)
    except sqlite3.Error as err:
        sys.exit(f"Could not open {db_path}: {err}")
    try:
        conn.execute("BEGIN")
        for table in SEED_TABLES:
            insert(conn, table, load_seed(table, today))
        simulate(conn, args.days, today, random.Random(args.seed))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise

    print(f"Seeded {db_path} (today {today.isoformat()}, {args.days} days, seed {args.seed})")
    for table in COUNT_TABLES:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table:<22}{count:>7}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
