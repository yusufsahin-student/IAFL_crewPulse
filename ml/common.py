"""Shared helpers for the anomaly model (ml/). Standard library only.

NumPy and TensorFlow are imported only inside the functions that need them.
Baseline and z-score rules follow docs/CONTRACT.md sections 4.2 and 6.
Run `python ml/common.py` for a quick self-test (no database needed).
"""
import json
import math
import os
import sqlite3
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repository root
DEFAULT_DB = os.path.join(ROOT, "db", "astro.db")
MODEL_DIR = os.path.join(ROOT, "ml", "model")

# Used only when a key is missing from model_params (contract 4.2 and 6).
DEFAULT_PARAMS = {
    "ml.baseline_n": 20.0,
    "ml.min_history": 7.0,
    "ml.sd_floor_frac": 0.05,
    "ml.z_alert": 3.0,
}
MIN_BASELINE_VALUES = 3   # a feature needs this many baseline values (contract 4.2)
SD_FLOOR_ABS = 1e-6       # smallest sd allowed in a z-score
THRESHOLD_FLOOR = 1e-6    # keeps the autoencoder threshold above zero


def utc_now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clamp01(x):
    return min(1.0, max(0.0, x))


def open_db(path=None):
    """Open the database: argument, else env ASTRO_DB, else db/astro.db.
    Relative paths are relative to ROOT. Raises OSError or sqlite3.Error on failure."""
    path = path or os.environ.get("ASTRO_DB") or DEFAULT_DB
    if not os.path.isabs(path):
        path = os.path.join(ROOT, path)
    if not os.path.isfile(path):
        raise OSError("no database file at %s" % path)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # Fails here (sqlite3.DatabaseError) when the file is not a SQLite database.
    conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchall()
    return conn


def load_params(conn):
    """All model_params as floats, with the contract defaults for missing keys."""
    params = dict(DEFAULT_PARAMS)
    for row in conn.execute("SELECT key, value FROM model_params"):
        params[row["key"]] = float(row["value"])
    return params


def feature_ids(conn):
    """Indicator ids with ml_feature = 1, in display order."""
    rows = conn.execute("SELECT id FROM indicators WHERE ml_feature = 1 ORDER BY display_order, id")
    return [r["id"] for r in rows]


def astronaut_of(conn, checkin_id):
    """Astronaut id of a check-in, or None when the check-in does not exist."""
    row = conn.execute("SELECT astronaut_id FROM checkins WHERE id = ?", (checkin_id,)).fetchone()
    return row["astronaut_id"] if row else None


def load_histories(conn, astronaut_id=None):
    """{astronaut_id: [check-in, ...]}, oldest first. One astronaut only when astronaut_id is given.
    A check-in is a dict: id, astronaut_id, taken_at, mission_day, values {indicator_id: float}."""
    where = " WHERE astronaut_id = ?" if astronaut_id is not None else ""
    args = (astronaut_id,) if astronaut_id is not None else ()
    histories = {}
    by_id = {}
    sql = "SELECT id, astronaut_id, taken_at, mission_day FROM checkins" + where
    for r in conn.execute(sql + " ORDER BY astronaut_id, taken_at, id", args):
        c = {"id": r["id"], "astronaut_id": r["astronaut_id"], "taken_at": r["taken_at"],
             "mission_day": r["mission_day"], "values": {}}
        histories.setdefault(c["astronaut_id"], []).append(c)
        by_id[c["id"]] = c
    for r in conn.execute("SELECT checkin_id, indicator_id, value FROM readings"):
        c = by_id.get(r["checkin_id"])  # skips readings outside the requested astronaut
        if c is not None:
            c["values"][r["indicator_id"]] = float(r["value"])
    return histories


def zscores(values, baseline, features, params):
    """Per-feature z-scores of one check-in against its baseline (contract 4.2).
    Only features present in the check-in and in at least 3 baseline check-ins are returned.
    Returns {indicator_id: {"z", "value", "baseline_mean", "baseline_sd"}}."""
    out = {}
    for fid in features:
        if fid not in values:
            continue
        past = [b["values"][fid] for b in baseline if fid in b["values"]]
        if len(past) < MIN_BASELINE_VALUES:
            continue
        mean = sum(past) / len(past)
        var = sum((x - mean) ** 2 for x in past) / len(past)  # population sd
        sd = max(math.sqrt(var), params["ml.sd_floor_frac"] * abs(mean), SD_FLOOR_ABS)
        out[fid] = {"z": (values[fid] - mean) / sd, "value": values[fid],
                    "baseline_mean": mean, "baseline_sd": sd}
    return out


def checkin_inputs(history, index, features, params):
    """(enough_history, z-scores) for history[index].
    The baseline is the previous baseline_n check-ins only: never this one or a later one."""
    base = history[max(0, index - int(params["ml.baseline_n"])):index]
    if len(base) < int(params["ml.min_history"]):
        return False, {}
    zs = zscores(history[index]["values"], base, features, params)
    return bool(zs), zs


def feature_vector(zs, features):
    """Model input: one z per feature, 0 where the feature is missing or has no baseline."""
    return [zs[f]["z"] if f in zs else 0.0 for f in features]


def contributor(fid, info):
    return {"indicator_id": fid,
            "z": round(float(info["z"]), 3),
            "value": round(float(info["value"]), 3),
            "baseline_mean": round(float(info["baseline_mean"]), 3),
            "baseline_sd": round(float(info["baseline_sd"]), 3)}


def make_row(checkin_id, score, is_anomaly, method, version, contributors):
    return {"checkin_id": checkin_id, "anomaly_score": float(score), "is_anomaly": int(is_anomaly),
            "method": method, "model_version": version, "contributors": contributors}


def zscore_row(checkin_id, enough, zs, params):
    """Contract 4.2 result for one check-in (method zscore_fallback), or insufficient_history."""
    if not enough:
        return make_row(checkin_id, 0.0, 0, "insufficient_history", None, [])
    max_abs = max((abs(v["z"]) for v in zs.values()), default=0.0)
    score = clamp01(max_abs / (2.0 * params["ml.z_alert"]))
    ranked = sorted(zs.items(), key=lambda kv: abs(kv[1]["z"]), reverse=True)
    contributors = [contributor(fid, v) for fid, v in ranked if abs(v["z"]) >= 1.0][:3]
    return make_row(checkin_id, score, 1 if score > 0.5 else 0, "zscore_fallback", None, contributors)


def tf_contributors(features, zs, sq_errors):
    """Top 3 features by squared reconstruction error. Only features with a z-score can be named."""
    out = []
    for j in sorted(range(len(features)), key=lambda j: sq_errors[j], reverse=True):
        if features[j] in zs:
            out.append(contributor(features[j], zs[features[j]]))
            if len(out) == 3:
                break
    return out


def tf_score_rows(model, meta, items):
    """Score (checkin, enough_history, zs) items with a loaded Keras autoencoder.
    Returns one ml_scores row per item. anomaly_score = clamp(err / (2 * threshold), 0, 1)."""
    import numpy as np  # imported here so that the rest of this module works without NumPy

    features = meta["features"]
    if not features:
        raise ValueError("model has no features")
    threshold = max(float(meta["threshold"]), THRESHOLD_FLOOR)
    ready = [(c, zs) for c, ok, zs in items if ok]
    results = {}
    if ready:
        X = np.array([feature_vector(zs, features) for _, zs in ready], dtype="float32")
        recon = model.predict(X, verbose=0)
        for k, (c, zs) in enumerate(ready):
            sq = []
            for j in range(len(features)):
                d = float(recon[k][j]) - float(X[k][j])
                sq.append(d * d)
            err = sum(sq) / len(sq)
            score = clamp01(err / (2.0 * threshold))
            results[c["id"]] = make_row(c["id"], score, 1 if score > 0.5 else 0, "tf_autoencoder",
                                        meta["version"], tf_contributors(features, zs, sq))
    rows = []
    for c, ok, zs in items:
        if ok:
            rows.append(results[c["id"]])
        else:
            rows.append(make_row(c["id"], 0.0, 0, "insufficient_history", None, []))
    return rows


def save_scores(conn, rows):
    """Upsert ml_scores rows (dicts from make_row) and commit."""
    now = utc_now_iso()
    conn.executemany(
        "INSERT OR REPLACE INTO ml_scores "
        "(checkin_id, anomaly_score, is_anomaly, method, model_version, contributors, scored_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(r["checkin_id"], r["anomaly_score"], r["is_anomaly"], r["method"], r["model_version"],
          json.dumps(r["contributors"]), now) for r in rows])
    conn.commit()


def _selftest():
    """Checks the baseline (excludes the scored check-in) and the z-score floor. No database needed."""
    params = dict(DEFAULT_PARAMS)
    hist = [{"id": i, "values": {"hr": 60.0 + (i % 3)}} for i in range(10)]
    hist.append({"id": 10, "values": {"hr": 90.0}})
    ok, zs = checkin_inputs(hist, 10, ["hr"], params)
    assert ok and abs(zs["hr"]["baseline_mean"] - 60.9) < 1e-9
    assert zs["hr"]["value"] == 90.0
    assert abs(zs["hr"]["baseline_sd"] - params["ml.sd_floor_frac"] * 60.9) < 1e-9  # sd floor applies here
    assert checkin_inputs(hist, 3, ["hr"], params)[0] is False  # only 3 earlier check-ins
    row = zscore_row(10, ok, zs, params)
    assert row["method"] == "zscore_fallback" and row["is_anomaly"] == 1
    assert len(row["contributors"]) == 1


if __name__ == "__main__":
    _selftest()
    print("common.py self-test passed")
