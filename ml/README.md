# Anomaly model (ml/)

The model learns each astronaut's own baseline and flags check-ins that drift from it. For every check-in it compares each ML feature (indicators with `ml_feature = 1`) with the astronaut's previous 20 check-ins, as z-scores. A small autoencoder (n -> 8 -> 3 -> 8 -> n) learns what normal combinations of those z-scores look like, and a high reconstruction error means "unusual for this person". Without TensorFlow, or before a model is trained, the same z-scores are scored directly (`zscore_fallback`).

Requires at least 7 earlier check-ins per astronaut. Earlier check-ins are scored `insufficient_history`.

- Train and score everything (by hand, from the repository root): `python ml/train.py [--db PATH]`
- Score one check-in (the backend does this after each insert): `python ml/score.py --db PATH --checkin ID`
- Score everything with the current model or fallback: `python ml/score.py --db PATH --all`
- Setup: `pip install -r ml/requirements.txt` (TensorFlow and NumPy are needed only for training and the autoencoder; the fallback needs neither).
- Outputs: `ml/model/autoencoder.keras` and `ml/model/meta.json` (feature list, threshold, version), and rows in `ml_scores`.

Limits, honestly stated:
- The data is simulated. The model learns the patterns of that data, not of real astronauts.
- Training needs at least 30 check-ins with enough history; below that, `train.py` uses the z-score fallback.
- Threshold is the 99th percentile of training error, so about 1 in 100 normal check-ins will look unusual.
- It is a screening aid for the crew and ground team. It is not a medical device and does not diagnose anything.
