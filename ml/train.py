"""Train the anomaly autoencoder and score every check-in (contract section 6).

Run by hand from the repository root:   python ml/train.py [--db PATH]
Writes ml/model/autoencoder.keras and ml/model/meta.json, then upserts ml_scores.
With fewer than 50 training samples it skips the model and scores with the z-score fallback.
"""
import os

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"  # silence TensorFlow logs before it is imported

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone

import common

MIN_TRAIN_SAMPLES = 50
EPOCHS = 60
BATCH_SIZE = 32
SEED = 42
THRESHOLD_PERCENTILE = 99


def remove_model_files():
    """Delete an old model so that score.py does not use it after a fallback run."""
    for name in ("autoencoder.keras", "meta.json"):
        path = os.path.join(common.MODEL_DIR, name)
        if os.path.isfile(path):
            os.remove(path)


def main():
    ap = argparse.ArgumentParser(description="Train the anomaly autoencoder and score all check-ins.")
    ap.add_argument("--db", help="SQLite path (default: ASTRO_DB, then db/astro.db)")
    args = ap.parse_args()

    try:
        conn = common.open_db(args.db)
    except (sqlite3.Error, OSError) as e:
        print("Cannot open database: %s" % e, file=sys.stderr)
        return 3

    params = common.load_params(conn)
    features = common.feature_ids(conn)
    histories = common.load_histories(conn)

    # One (checkin, enough_history, z-scores) item per check-in. Training uses the ones with history.
    items = []
    for hist in histories.values():
        for i, c in enumerate(hist):
            ok, zs = common.checkin_inputs(hist, i, features, params)
            items.append((c, ok, zs))
    ready = [(c, zs) for c, ok, zs in items if ok]
    print("Check-ins: %d, with enough history: %d, features: %d" % (len(items), len(ready), len(features)))

    if len(ready) < MIN_TRAIN_SAMPLES or not features:
        print("Only %d training samples (need %d). Not training; scoring with the z-score fallback."
              % (len(ready), MIN_TRAIN_SAMPLES))
        remove_model_files()
        rows = [common.zscore_row(c["id"], ok, zs, params) for c, ok, zs in items]
        common.save_scores(conn, rows)
        print("Scored %d check-ins. Anomalies: %d" % (len(rows), sum(r["is_anomaly"] for r in rows)))
        return 0

    try:
        import numpy as np
        import tensorflow as tf
    except ImportError as e:
        print("TensorFlow and NumPy are needed for training (pip install -r ml/requirements.txt): %s" % e,
              file=sys.stderr)
        return 1

    # Global chronological holdout. Baselines always use only earlier check-ins.
    ready.sort(key=lambda item: (item[0]["taken_at"], item[0]["id"]))
    X = np.array([common.feature_vector(zs, features) for _, zs in ready], dtype="float32")
    n = len(features)

    tf.keras.utils.set_random_seed(SEED)
    model = tf.keras.Sequential([
        tf.keras.Input(shape=(n,)),
        tf.keras.layers.Dense(8, activation="relu"),
        tf.keras.layers.Dense(3, activation="relu"),  # bottleneck
        tf.keras.layers.Dense(8, activation="relu"),
        tf.keras.layers.Dense(n),                     # linear output
    ])
    model.compile(optimizer=tf.keras.optimizers.Adam(), loss="mse")
    train_end = int(len(X) * 0.6)
    val_end = int(len(X) * 0.8)
    train, validation, test = X[:train_end], X[train_end:val_end], X[val_end:]
    model.fit(train, train, epochs=EPOCHS, batch_size=BATCH_SIZE, verbose=0, shuffle=False)

    # Threshold is calibrated on a separate chronological validation set.
    recon = model.predict(validation, verbose=0)
    errors = np.mean((recon - validation) ** 2, axis=1)
    threshold = max(float(np.percentile(errors, THRESHOLD_PERCENTILE)), common.THRESHOLD_FLOOR)

    heldout_errors = np.mean((model.predict(test, verbose=0) - test) ** 2, axis=1)
    evaluation = {"split": "chronological 60/20/20", "train_n": len(train), "validation_n": len(validation), "test_n": len(test), "test_flag_rate": float(np.mean(heldout_errors > threshold)), "note": "Flag rate is not sensitivity or false-positive rate: data have no adjudicated labels."}
    os.makedirs(common.MODEL_DIR, exist_ok=True)
    model.save(os.path.join(common.MODEL_DIR, "autoencoder.keras"))
    meta = {
        "version": "ae-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "features": list(features),
        "threshold": threshold,
        "trained_at": common.utc_now_iso(),
        "n_samples": len(train),
        "evaluation": evaluation,
    }
    with open(os.path.join(common.MODEL_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    rows = common.tf_score_rows(model, meta, items)
    common.save_scores(conn, rows)
    anomalies = sum(r["is_anomaly"] for r in rows)
    print("Trained %s on %d samples, %d features. Threshold: %.6f" % (meta["version"], len(train), n, threshold))
    print("Scored %d check-ins. Anomalies (above threshold): %d" % (len(rows), anomalies))
    return 0


if __name__ == "__main__":
    sys.exit(main())
