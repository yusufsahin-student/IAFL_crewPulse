"""Score check-ins for anomalies and write ml_scores (contract sections 5.3 and 6).

    python ml/score.py --db PATH --checkin ID
    python ml/score.py --db PATH --all

Uses the trained autoencoder when TensorFlow and ml/model/ exist, otherwise the z-score
fallback (contract 4.2). Exit codes: 0 ok, 1 other error, 2 check-in not found, 3 db cannot be opened.
"""
import os

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"  # silence TensorFlow logs before any TensorFlow import

import argparse
import json
import sqlite3
import sys
from collections import Counter

import common


def load_tf_model():
    """(model, meta) when both model files exist and load, else (None, None).
    TensorFlow is imported only when the model files exist, so the fallback path stays fast."""
    model_path = os.path.join(common.MODEL_DIR, "autoencoder.keras")
    meta_path = os.path.join(common.MODEL_DIR, "meta.json")
    if not (os.path.isfile(model_path) and os.path.isfile(meta_path)):
        return None, None
    try:
        import tensorflow as tf
        model = tf.keras.models.load_model(model_path, compile=False)
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        return model, meta
    except Exception as e:  # any failure means: use the fallback
        print("Autoencoder unavailable, using z-score fallback: %s" % e, file=sys.stderr)
        return None, None


def pending_items(histories, features, params, only=None):
    """(checkin, enough_history, z-scores) for every check-in, or just the one with id `only`."""
    items = []
    for hist in histories.values():
        for i, c in enumerate(hist):
            if only is not None and c["id"] != only:
                continue
            ok, zs = common.checkin_inputs(hist, i, features, params)
            items.append((c, ok, zs))
    return items


def compute_rows(conn, only=None):
    """ml_scores rows for all check-ins, or for one. The model's own feature list is used when it loads
    (so indicators added later do not change it); the z-score fallback uses the current ml_feature set."""
    params = common.load_params(conn)
    if only is None:
        histories = common.load_histories(conn)
    else:
        aid = common.astronaut_of(conn, only)
        if aid is None:
            return []
        histories = common.load_histories(conn, aid)

    model, meta = load_tf_model()
    if model is not None:
        try:
            return common.tf_score_rows(model, meta, pending_items(histories, meta["features"], params, only))
        except Exception as e:
            print("Autoencoder scoring failed, using z-score fallback: %s" % e, file=sys.stderr)

    items = pending_items(histories, common.feature_ids(conn), params, only)
    return [common.zscore_row(c["id"], ok, zs, params) for c, ok, zs in items]


def main():
    ap = argparse.ArgumentParser(description="Score check-ins for anomalies (writes ml_scores).")
    ap.add_argument("--db", help="SQLite path (default: ASTRO_DB, then db/astro.db)")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--checkin", type=int, help="score one check-in by id")
    group.add_argument("--all", action="store_true", help="score every check-in")
    args = ap.parse_args()

    try:
        conn = common.open_db(args.db)
    except (sqlite3.Error, OSError) as e:
        print("Cannot open database: %s" % e, file=sys.stderr)
        return 3

    try:
        if args.checkin is not None and common.astronaut_of(conn, args.checkin) is None:
            print("Check-in %d does not exist." % args.checkin, file=sys.stderr)
            return 2
        rows = compute_rows(conn, args.checkin)
        common.save_scores(conn, rows)
    except sqlite3.Error as e:
        print("Database error: %s" % e, file=sys.stderr)
        return 1

    methods = Counter(r["method"] for r in rows)
    print("Scored %d check-in(s): %s. Anomalies: %d" % (
        len(rows), ", ".join("%s=%d" % kv for kv in sorted(methods.items())) or "none",
        sum(r["is_anomaly"] for r in rows)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
