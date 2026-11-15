# CrewPulse

**Team IAFL** · NASA Space Apps Challenge 2026 · Challenge: *Create Health Monitoring Software for Astronauts on Space Missions*

- **Live app:** _add the Render link here_ (free hosting: the first load can take about a minute while the server wakes up)
- **Demo:** _add the slide deck or video link here_
- **Source code:** this repository

On a Mars mission a message to the flight surgeon takes up to 22 minutes one way. CrewPulse helps astronauts check their own health every day, see what changed against their personal baseline, and know what to do next, with guidance that adapts to how far the crew is from Earth.

One daily check-in, interpreted for where the crew is in the mission:

- **Check-in**: vitals, sleep, mood, eye tests (near vision, Amsler grid) and a reaction-time test, one measurement at a time with how-to-measure diagrams.
- **Personal anomaly model**: compares each check-in with the astronaut's own last 20 check-ins and flags unusual combinations. A TensorFlow autoencoder is used when TensorFlow is installed; otherwise the same personal z-scores are scored directly. The live demo uses the z-score method (see *Honest limits*).
- **Health score** with written reasons, and **distance-aware triage**: the same reading leads to "message the flight surgeon" on the ISS and to a crew-led protocol on the way to Mars.
- **Body map**: each body region shows the status of its indicators; the mission picker shows guidance for the ISS, lunar transit, Moon base, lunar rover and Mars.
- **Projected bone loss**: published loss rates per site, adjusted for gravity and logged exercise.
- **Estimated radiation dose**: habitat-zone shielding model plus NASA DONKI and Fermi GBM solar events; shows where to shelter.
- **Mind Lab**: a short self-report, a three-minute vigilance test and eight short cognitive tasks.
- **Activity & Recommendations**: a traceable daily countermeasure plan from seven-day activity, recovery, safety alerts, gravity and cabin context.
- **Gravital Tracking** and **Trends**: charts of local gravity, readings over time, solar events and links between readings.
- **Mission Companion**: turns the latest assessment into a checklist and a handoff file. Nothing is sent automatically.
- English and Turkish interface, light and night mode.

All rules, thresholds, missions, habitat zones and guidance text live in the SQLite database built from `data/seed/*.json`. Change the data, not the code.

## NASA and space agency data

| Data | How it is used |
|---|---|
| NASA DONKI (api.nasa.gov) solar particle events and CMEs | Live space-weather events for the radiation view and trends; fetched on every server start |
| Fermi GBM solar flare list (NASA GSFC) | Live flare events shown with the radiation context |
| ISS TEPC dose measurements (NASA CDAWeb) | ISS background dose rate (`tools/fetch_tepc.py`) |
| NASA Human Research Program: 5 hazards and risks | Each indicator is mapped to a spaceflight hazard |
| NASA-STD-3001, NASA HRP evidence reports and other cited sources | Thresholds, bone loss rates, exercise targets; see `data/seed/sources.json` and `docs/SOURCE-AUDIT.md` |
| CSA: monitoring radiation for astronaut health | Background for the radiation model |
| [NASA OSDR Environmental Data Application](https://visualization.osdr.nasa.gov/eda/) and [Law et al. 2014](https://pubmed.ncbi.nlm.nih.gov/24806559/) | Level of the simulated ISS cabin CO2 (about 2 mmHg); OSDR holds the recorded cabin CO2, temperature and humidity |
| NASA HRP, OCHMO technical briefs, NASA NTRS and peer-reviewed papers | Gravity risk analysis; each source is linked on the Gravital Tracking page |

## Layout

| Path | What it is |
|---|---|
| `docs/CONTRACT.md` | The spec every part is built against: API, formulas, ownership |
| `db/schema.sql` | SQLite schema |
| `data/seed/*.json` | Reference data, one file per table: edit these to change the app |
| `tools/seed.py` | Builds `db/astro.db` from the schema, seed files and simulated history |
| `tools/fetch_donki.py`, `tools/fetch_gbm.py`, `tools/fetch_tepc.py` | Pull NASA space-weather and dose data |
| `ml/` | Anomaly model: `train.py`, `score.py` |
| `backend/` | Rust API server (axum + rusqlite), also serves the frontend |
| `frontend/` | HTML, CSS and JavaScript pages, no build step |
| `Dockerfile`, `docker-start.sh` | Container used for the live deployment |
| `tools/dev-server.mjs` | Frontend-only preview with mock data (Node) |

## Run it locally

Requirements: Python 3.10–3.12, Rust (stable) via rustup (on Windows the MSVC build tools are needed for `rusqlite`'s bundled SQLite). Node.js only for the mock preview.

On Windows, from the repository root:

```bash
powershell -ExecutionPolicy Bypass -File .\start-app.ps1 -Fresh
```

Or step by step, from the repository root:

```bash
python tools/seed.py --fresh
```

```bash
cargo run --manifest-path backend/Cargo.toml --release
```

Then open http://127.0.0.1:8080.

Optional, the TensorFlow model: `pip install -r ml/requirements.txt`, then `python ml/train.py`.

Optional, real space weather (needs internet). Without `NASA_API_KEY` the fetcher uses the rate-limited `DEMO_KEY`:

```bash
python tools/fetch_donki.py --days 30
```

```bash
python tools/fetch_gbm.py --days 30
```

Frontend preview without Python or Rust (mock data): `node tools/dev-server.mjs`, then open http://127.0.0.1:5173.

Mind Lab sessions and daily activity logs are stored only in the browser.

## Deploy (Docker, for example on Render)

The `Dockerfile` builds the Rust server and runs it with the Python tools. On every start `docker-start.sh` rebuilds the demo database, fetches NASA DONKI and Fermi GBM events, and starts the server on `0.0.0.0:$PORT`.

Environment variables:

- `NASA_API_KEY`: your api.nasa.gov key. Set it as a secret in the hosting dashboard; never commit it.
- `ASTRO_PUBLIC_HOST`: public host name(s), comma-separated. On Render this is read automatically from `RENDER_EXTERNAL_HOSTNAME`.
- Optional: `ASTRO_HOST` (default `127.0.0.1`, the container sets `0.0.0.0`), `ASTRO_PORT` or `PORT` (default `8080`), `ASTRO_DB`, `ASTRO_FRONTEND`, `ASTRO_PYTHON`.

## Changing the data

1. Edit the JSON files in `data/seed/` (for example add an indicator, change a threshold, add a habitat zone).
2. Run `python tools/seed.py --fresh` to rebuild the database.
3. Run `python ml/train.py` if you added or removed indicators used by the model.

## Tests

```bash
node --test frontend/js/
```

```bash
cargo test --manifest-path backend/Cargo.toml
```

```bash
python -m unittest discover -s tools -p "test_*.py"
```

## Honest limits

- Cabin CO2, temperature and humidity are simulated at ISS-like levels and never change the health score. Recorded ISS cabin data is available in NASA OSDR; connecting it is the next step.
- The crew and their history are simulated. Crew names are fictional and do not refer to real astronauts. The anomaly model learns the patterns of that data, not of real astronauts.
- The live demo scores check-ins with personal z-scores. The TensorFlow autoencoder was trained and tested locally, but TensorFlow does not fit the small free hosting instance.
- The live demo rebuilds its data on every restart, so check-ins entered by visitors do not persist.
- The demo has no login so judges can try it: anyone can read the simulated crew data and add check-ins, and visitors share the same demo crew. A real deployment would need sign-in and per-astronaut access checks on the server.
- The interface shows the first crew member; the other four simulated astronauts are available through the API.
- Bone values are projections from published average loss rates, not scans.
- Radiation dose is an estimate from a simplified shielding model. The strongest dose event in the demo history is a simulated solar particle event and is labelled as simulated; real DONKI and Fermi GBM events are shown as context.
- Mind Lab is an independent prototype inspired by the NASA Cognition approach, not the NASA Cognition test. Its thresholds are visible prototype rules, not validated clinical cutoffs.
- This is a hackathon prototype, not a medical device.

## Use of AI

AI coding assistants were used to help write and review parts of the code, tests, translations and documentation. The team chose the problem, the approach, the data sources and the design, and reviewed and tested the output.

No AI image, video or audio generators were used. The pictures in the app are Health Icons (CC0) and simple vector drawings written as SVG code (the logo, the cup and plate drawings and the measurement-step drawings in `frontend/img/measure/`); that SVG code falls under the AI-assisted coding statement above. NASA logos, insignia, flags and mission identifiers are not used; "NASA" appears only as text to name data sources.

## References and licenses

Every threshold, rate and guidance text in the app cites its source in `data/seed/sources.json` (shown in the app on each indicator card); values without a source are labelled `assumption`. `docs/SOURCE-AUDIT.md` explains how each value was checked.

| Third-party material | License |
|---|---|
| NASA DONKI, Fermi GBM, ISS TEPC data | NASA open data |
| [Health Icons](https://healthicons.org) (`frontend/img/healthicons/`) | CC0 1.0 |
| Rust crates: axum, tokio, tower-http, rusqlite (bundled SQLite), serde, serde_json, chrono | MIT or MIT/Apache-2.0; SQLite is public domain |
| TensorFlow (optional) | Apache-2.0 |
| NumPy | BSD-3-Clause |

No copyrighted images, music or text are included. The frontend uses no external libraries or CDNs.

## License

CrewPulse is released under the [Apache License 2.0](LICENSE).

## Team IAFL

| Name | Role |
|---|---|
| Renas Yusuf Babür | Researcher |
| Murathan Yapıcı | Scrum Master |
| Efe Yüksel | Developer |
| Mehmet Recep Baltacı | Designer |
| Semih Bakır | Researcher |
| Yusuf Şahin | Developer |
