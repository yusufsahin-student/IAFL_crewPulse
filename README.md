# Astronaut Health Monitor

Base app for the NASA Space Apps 2026 challenge *Create Health Monitoring Software for Astronauts on Space Missions*.

One daily check-in, interpreted for where the crew is in the mission:

- **Check-in**: vitals, sleep, mood and a reaction-time test.
- **Personal anomaly model** (TensorFlow): learns each astronaut's own baseline and flags drift.
- **Projected bone loss**: published loss rates, adjusted for gravity and logged exercise.
- **Estimated radiation dose**: habitat zone model plus NASA DONKI solar events; shows where to shelter.
- **Health score** with written reasons, and **distance-aware triage**: the same reading leads to "call the flight surgeon" on the ISS and to a crew-led protocol on the way to Mars.
- **Mind Lab**: a guided flow with a short self-report and a three-minute vigilance test. The former emoji expression exercise is removed and its place is retained as a non-scoring development marker.
- **Adaptive fitness**: a local daily countermeasure plan that adjusts within guarded limits using seven-day activity, sleep, mood, stress, data freshness and safety alerts.
- **Mission Companion**: turns the latest assessment into a local action checklist and an explicit handoff file. Nothing is sent automatically.
- **Cabin context**: shows the latest CO₂, temperature, and humidity separately from the health score; simulated readings are labelled explicitly.

The default screen is a calm, task-first mission center. The original detailed body map remains available under **Body map**. Check-ins show one measurement at a time, preserve a local draft, and use retry-safe submission IDs so a lost response cannot create duplicate readings.

All rules, thresholds, missions, habitat zones and guidance text live in the SQLite database. Change the data, not the code.

## Layout

| Path | What it is |
|---|---|
| `docs/CONTRACT.md` | The spec every part is built against: API, formulas, ownership |
| `db/schema.sql` | SQLite schema |
| `data/seed/*.json` | Reference data, one file per table: edit these to change the app |
| `tools/seed.py` | Builds `db/astro.db` from the schema, seed files and simulated history |
| `tools/fetch_donki.py` | Pulls real solar events from NASA DONKI |
| `ml/` | TensorFlow autoencoder: `train.py`, `score.py` |
| `backend/` | Rust API server (axum + rusqlite), also serves the frontend |
| `frontend/` | HTML, CSS and JavaScript pages, no build step |
| `tools/dev-server.mjs` | Frontend-only preview with mock data (Node) |

## Requirements

- Python 3.10–3.12 (TensorFlow does not support newer versions on Windows yet)
- Rust (stable) via rustup; on Windows the MSVC build tools are needed for `rusqlite`'s bundled SQLite
- Node.js only for the mock preview

## Run it

From the `astro-health/` folder:

```bash
python tools/seed.py --fresh
```

```bash
pip install -r ml/requirements.txt
```

```bash
python ml/train.py
```

```bash
cargo run --manifest-path backend/Cargo.toml --release
```

Then open http://127.0.0.1:8080.

Optional, real space weather (needs internet):

```bash
set NASA_API_KEY=your_api_nasa_gov_key
python tools/fetch_donki.py --days 30
```

`NASA_API_KEY` is also read by `start-app.ps1`. If it is absent, the fetcher falls back to the rate-limited `DEMO_KEY`.

Optional: load real solar flares from the Fermi GBM flare list:

```bash
python tools/fetch_gbm.py --days 30
```

Optional: recompute the ISS background dose from NASA TEPC measurements (CDAWeb):

```bash
python tools/fetch_tepc.py --write-seed
```

Frontend preview without Python or Rust (mock data):

```bash
node tools/dev-server.mjs
```

Then open http://127.0.0.1:5173.

Mind-lab sessions and daily fitness completion logs are stored only in this browser. They are not synced to the server; clearing browser storage or moving to another device removes that local history.

## Changing the data

1. Edit the JSON files in `data/seed/` (for example add an indicator, change a threshold, add a habitat zone).
2. Run `python tools/seed.py --fresh` to rebuild the database.
3. Run `python ml/train.py` if you added or removed indicators used by the model.

When the official challenge resources are published, replace the simulated history by importing real or published data into the `checkins` and `readings` tables, and cite each source in `sources`.

## Honest limits

- The crew and their history are simulated. The anomaly model learns the patterns of that data.
- Bone values are projections from published average loss rates, not scans.
- Radiation dose is an estimate from a simplified shielding model.
- The ISS background rate is a TEPC station average from 2017 samples, and Fermi GBM flares do not add dose.
- This is a hackathon prototype, not a medical device.
- Mind Lab thresholds are visible prototype rules, not validated clinical cutoffs. The removed face-expression step remains only as a non-scoring development marker.
