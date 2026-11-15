# CrewPulse — build contract

Every part of the app is built against this file. If something here is unclear, choose the simplest reading, keep to it, and note it in your report. Never change another part's files.

## 1. Layout and ownership

```
crewpulse/ (repository root)
  db/schema.sql            SQLite schema (owner: lead, read-only for everyone)
  db/astro.db              created by tools/seed.py (never committed)
  data/seed/*.json         reference data, one file per table (Agent 1)
  tools/seed.py            builds db/astro.db (Agent 1)
  tools/fetch_donki.py     pulls NASA DONKI solar events into the db (Agent 1)
  tools/dev-server.mjs     Node static server + mock API for frontend work (lead)
  ml/train.py, ml/score.py, ml/common.py, ml/requirements.txt, ml/model/   (Agent 2)
  backend/                 Rust server, Cargo project (Agent 3)
  frontend/css/base.css, frontend/js/api.js, frontend/js/shell.js   (lead, read-only)
  frontend/index.html, frontend/checkin.html, frontend/js/home.js, frontend/js/checkin.js,
  frontend/css/home.css, frontend/css/checkin.css   (Agent 4)
  frontend/radiation.html, frontend/trends.html, frontend/js/radiation.js, frontend/js/trends.js,
  frontend/css/radiation.css, frontend/css/trends.css   (Agent 5)
  frontend/mock/*.json     mock API responses (see section 8 for who writes which)
  README.md                (lead)
```

Runtimes: Python 3.10–3.12 standard library only except TensorFlow + NumPy in `ml/`. Rust stable. Frontend: plain HTML, CSS, JavaScript ES modules, no libraries, no CDN, no build step, works offline.

Paths: every program takes the database path from env `ASTRO_DB`, default `db/astro.db` relative to the repository root. Run everything from the repository root.

## 2. Data rules

- Schema: `db/schema.sql`. Do not add tables or columns. Reference data lives only in `data/seed/<table>.json` (array of objects, keys = column names).
- "Easily changed with the data": no indicator ids, thresholds, missions, zones or numbers hard-coded in Python, Rust or JS beyond the defaults named in section 4. Everything is read from the database.
- Demo crew is fictional. No real astronaut names.
- `sources.url`: use only these verified URLs, otherwise `null`:
  - `nasa_hrp` https://www.nasa.gov/hrp/
  - `hrr` https://humanresearchroadmap.nasa.gov/
  - `donki` https://kauai.ccmc.gsfc.nasa.gov/DONKI/
  - `gbm` https://hesperia.gsfc.nasa.gov/fermi/gbm/qlook/fermi_gbm_flare_list.txt
  - `iss_tepc` https://cdaweb.gsfc.nasa.gov/hapi/info?id=ISS_DOSANL_TEPC
  - `i4_cmp` https://osdr.nasa.gov/bio/repo/data/studies/OSD-575
  - `radlab` https://visualization.osdr.nasa.gov/radlab
  - `osdr` https://science.nasa.gov/biological-physical/data/osdr/
  - `physionet` https://physionet.org/about/database/
  - `ntrs` https://ntrs.nasa.gov/
  - `hrp_hazards` https://www.nasa.gov/hrp/hazards/
  - `hrp_risks` https://www.nasa.gov/hrp/risks/
  - `hrp_research` https://www.nasa.gov/hrp/ongoing-hrp-research/
  - `csa_radiation` https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp
  - `csa_science` https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp
  - `sans_hrr` https://humanresearchroadmap.nasa.gov/risks/risk.aspx?i=105
  - `sans_mader2011` https://doi.org/10.1016/j.ophtha.2011.06.021
  - `sans_lee2020` https://www.nature.com/articles/s41526-020-0097-9
  - `assumption` (url null) — for every number that is a modelling choice.
- Input types (`indicators.input_type`): `number`, `scale`, `game` (reaction test), `camera` (pulse estimate), `vision` (near-acuity tumbling-E test, logMAR, `frontend/js/vision.js` + `vision-ui.js`) and `amsler` (Amsler grid, count of marked squares). `vision` and `amsler` fill the number field and always let the user type a value. Screen size is calibrated with a bank card (85.6 mm) and kept in `localStorage`. They are screening estimates to track change from the crew member's own baseline, not eye exams. Their pure logic is tested with `node frontend/js/vision.test.mjs`.
- `body_regions.alert` (optional text): an advisory shown as a `.notice` (advisory) above the region's readings on the home page and above the region's tests in the check-in. It is the place for the eye-risk (SANS) message: astronauts do not go blind, but many long-mission crew develop SANS and some changes last years.
- "Today" is the real current UTC date. The seeder generates history that ends today.

## 3. Core vocabulary

- Status of one reading: `normal` | `watch` | `alert` | `missing`.
- Band of the health score: `good` (>= 75) | `watch` (>= 50) | `alert` (< 50).
- Mission day: `floor((today - mission_start) days) + 1`.
- Effective range of an indicator for an astronaut: start from the `indicators` row. For `kcal_intake`, replace `normal_low` with the personalized NASA-STD-3001 V2 7003 Table 11 EER formula (activity factor 1.25) using the astronaut's `sex` (`'M'` or `'F'`), age (`current_year - birth_year`), `height_cm` (`height_cm / 100`), and `preflight_mass_kg` with `kcal.*` rows from `model_params`, rounded to the nearest 10 kcal (falling back to the base 2300 kcal when any input is missing or invalid). For `grip_strength`, replace `normal_low` with `grip.normal_low_m` (27 kg) for `'M'`, `grip.normal_low_f` (16 kg) for `'F'`, or fallback 16 kg. Then find `indicator_adjustments` rows for this indicator where `mission_id` equals the mission or is NULL and `day_from <= mission_day <= coalesce(day_to, inf)`; prefer rows with a matching `mission_id` over NULL, then the highest `day_from`; each non-NULL bound replaces the bound. `adjusted = true` when a row applied; `note` is its note.
- Reading status: `alert` if below `critical_low` or above `critical_high` (when set); else `watch` if below `normal_low` or above `normal_high` (when set); else `normal`.
- Direction: `low` if below the low bound that triggered, `high` if above.

## 4. Formulas (all constants are rows in `model_params`; defaults shown)

### 4.1 Health score (0–100)
- `vitals` = weighted mean over readings of the latest check-in, weight = `indicators.weight`, value per status: normal `score.normal_points`=100, watch `score.watch_points`=60, alert `score.alert_points`=10.
- `anomaly` = `100 * (1 - anomaly_score)`; 100 when there is no ml score.
- `bone` = `clamp(100 - worst_site_loss_pct * score.bone_penalty_per_pct(=8), 0, 100)` using today's loss.
- `radiation` = `clamp(100 - pct_of_limit, 0, 100) - (active dose-relevant event ? score.storm_penalty(=20) : 0)`, clamped 0–100.
- `value` = round(`vitals*score.w_vitals(0.45) + anomaly*score.w_anomaly(0.25) + bone*score.w_bone(0.15) + radiation*score.w_radiation(0.15)`).
- If any reading is `alert`, `value = min(value, 49)`.
- `reasons`: plain sentences, most severe first, max 5. Examples: "Systolic blood pressure 152 mmHg is above the watch limit (140).", "Heart rate is 18% above your usual level.", "Projected bone loss at the hip is 6.1%.", "Solar particle event in progress: move to Storm shelter."

### 4.2 Anomaly (z-score fallback; also the spec the TensorFlow model must improve on)
- Features: indicators with `ml_feature = 1`.
- Baseline for check-in C: the astronaut's previous `ml.baseline_n`(=20) check-ins before C.
- If fewer than `ml.min_history`(=7) baseline check-ins: `method='insufficient_history'`, `anomaly_score=0`, `is_anomaly=0`, contributors `[]`.
- Per feature present in C and in >= 3 baseline check-ins: `mean`, `sd` (population), `sd = max(sd, ml.sd_floor_frac(=0.05)*abs(mean), 1e-6)`, `z = (value-mean)/sd`.
- `anomaly_score = clamp(max(|z|) / (2*ml.z_alert(=3)), 0, 1)`; `is_anomaly = anomaly_score > 0.5`.
- `contributors`: top 3 by |z| where |z| >= 1: `{"indicator_id","z","value","baseline_mean","baseline_sd"}` (numbers rounded to 3 decimals).

### 4.3 Bone projection (projection, not a measurement)
- `months = (mission_day - 1) / 30.44`.
- `gravity_factor = clamp(1 - mission.gravity_g, 0, 1)`.
- `exercise_avg` = mean of indicator `exercise_minutes` over the astronaut's check-ins in the last `bone.exercise_window_days`(=7) days; 0 if none.
- `exercise_factor = 1 - bone.exercise_max_reduction(=0.5) * min(1, exercise_avg / bone.exercise_target_min(=120))` (minutes per day).
- Site `loss_pct = loss_pct_per_month * months * gravity_factor * exercise_factor`; `current_bmd = baseline * (1 - loss_pct/100)`.
- Projection: same factors, points every 7 mission days from day 1 to `mission_day + days_ahead`.
- Site status: `alert` if loss_pct >= `bone.alert_pct`(=10), `watch` if >= `bone.watch_pct`(=5), else `normal`.

### 4.4 Radiation (estimate from a simplified zone model)
- Zone background rate (mSv/day): `mission.gcr_msv_per_day * exp(-(shielding - rad.ref_shield_g_cm2(=20)) / rad.gcr_atten_g_cm2(=70))`.
- Event rate in zone (mSv/hour) while a `dose_relevant` event is active: `rad.sep_peak_msv_per_h(=93) * severity * mission.sep_exposure_factor * exp(-shielding / rad.sep_atten_g_cm2(=8))`.
- Event window: `start_time` to `end_time` or `start_time + rad.sep_default_duration_h(=72)` hours.
- Astronaut daily dose for date D: for each zone of the mission, hours `h` from `exposure_log` (or `default_hours` when the day has no rows): `sum( h/24 * background + (h/24) * overlap_hours(D) * event_rate )` over zones and active events.
- `mission_dose_msv` = sum of daily doses from mission start to today. `limit_msv = rad.career_limit_msv(=600)`, `pct_of_limit = 100 * mission_dose / limit`.
- `recommended_zone_id` = zone with `is_shelter=1` and the highest shielding (or highest shielding overall).

### 4.5 Distance-aware triage
- Level 0: every reading normal and no anomaly. Level 1: any `watch` reading, or `is_anomaly`, or bone site in watch. Level 2: any `alert` reading, or score < 50, or an active dose-relevant event. Level 3: two or more `alert` readings.
- Consult mode and delay come from the mission (or the `mission` override, section 5).
- `reply_minutes = round(2 * comms_delay_s / 60, 1)`.
- Text: the `triage_actions` row for (level, consult_mode); replace `{mission}`, `{delay}` (human text like "22 min" or "1.3 s"), `{reply_minutes}`; split `instructions` on `\n`.
- `guidance`: for each non-normal reading, the `guidance` row matching indicator, direction (or `any`) and severity (`watch` reading → `watch`; `alert` reading → `alert`, falling back to `watch`). Split `self_care` and `protocol` on `\n`. Include `protocol` only when consult_mode is `crew_led` or `shared`; otherwise `null`.

### 4.6 Adaptive daily activity and recommendations (client-side prototype)

The Activity & Recommendations view uses the configured `bone.exercise_target_min` as its base target. It combines the last seven different activity days with the latest sleep, mood, stress, freshness, safety status, gravity assessment and cabin-environment freshness. Daily increases are capped at five minutes relative to the previous locally stored plan. Low recovery reduces the load; stale measurements produce a light verification plan; alert-level cardiovascular, oxygen or temperature readings produce only a safety hold. Microgravity emphasizes approved resistance loading, partial-gravity profiles preserve balance/mobility work, and a detected gravity-field transition adds a readiness recommendation. Every recommendation exposes its category, priority and data basis. Local completion logs stay in the browser and do not replace the official check-in. This is prototype decision support, not a prescribed exercise protocol or diagnosis.

## 5. HTTP API (Rust backend on `http://127.0.0.1:8080`, JSON, UTF-8)

`GET /api/config?astronaut_id=` returns the current effective ranges for that astronaut's mission and mission day. Forms must use these effective ranges for both preview and submission review.

`POST /api/checkins` accepts an optional `client_submission_id`. Repeating the same ID and identical payload returns the original check-in; reusing the ID with a different payload is rejected. This makes local queued retries safe after a lost response.

`GET /api/environment?astronaut_id=&mission=&days=60` returns the latest cabin CO₂, temperature, and humidity snapshot plus oldest-first history for the requested window. It also returns a versioned `layer` with `id`, `label`, `freshness`, and metric sample arrays. Trends can accept future context sources through this same boundary (for example a gravity layer) without changing health scoring. Environmental data is contextual evidence only and never contributes to the health score or establishes causation. Every reading states whether it came from a device, import, or simulation.

`GET /api/gravity?astronaut_id=&mission=&days=60` returns time-varying local gravity observations, a versioned `gravity` context layer and a transparent assessment. `window_equivalent_microgravity_days = sum(max(0, 1 - gravity_g))` over daily observations. This is an exposure index, not a clinical probability. Human evidence for long-term partial gravity is limited, so the response labels that uncertainty. The bone projection integrates each mission day's gravity observation; missing future days carry the latest observation forward.

The backend also serves `frontend/` as static files at `/` (index.html default). Errors: status 4xx/5xx with `{"error": "plain sentence", "field": "optional"}`. Numbers are JSON numbers, absent values `null`.

| Method & path | Response |
|---|---|
| `GET /api/health` | `{"ok":true,"db":"db/astro.db","model":"tf_autoencoder"\|"zscore_fallback"}` |
| `GET /api/environment?astronaut_id=1&days=60` | `{"mission_id":"iss","reading":<latest>\|null,"readings":[...],"window":{"days":60},"freshness":{"status":"current"\|"stale"\|"missing","observed_at":...,"age_h":...,"max_age_h":24},"layer":{"schema_version":1,"id":"environment","label":"Cabin environment","freshness":{...},"metrics":[{"id":"co2_ppm","label":"Carbon dioxide","unit":"ppm","samples":[{"observed_at","value","source"}]}]},"note":"..."}` |
| `GET /api/gravity?astronaut_id=1&days=60` | `{"mission_id":"iss","reading":<latest>\|null,"readings":[...],"window":{"days":60},"assessment":{"current_g":0,"earth_load_pct":0,"load_deficit_pct":100,"window_equivalent_microgravity_days":60,"transition_count":0,"interpretation":"Microgravity","evidence":"mission_profile"},"layer":{"schema_version":1,"id":"gravity","label":"Gravital tracking","metrics":[...]},"note":"..."}` |
| `GET /api/config` | `{missions:[...], body_regions:[...], indicators:[...], bone_sites:[...], sources:[...], params:{key:value}}` — rows as in the schema; when `?astronaut_id=` is passed, `indicators[].normal_low..critical_high` reflect that astronaut's effective range (including personalized `kcal_intake` and `grip_strength` limits); `indicators[].scale_labels` parsed to an array or null; lists sorted by `display_order`. |
| `GET /api/astronauts` | `[{id,name,role,sex,birth_year,height_cm,preflight_mass_kg,mission_id,mission_start,mission_day,avatar_color,latest_score,latest_band}]` |
| `GET /api/astronauts/{id}/status?mission=mars` | Status object, 5.1. `mission` is optional and only changes `mission`, `triage` (what-if for the distance slider). |
| `POST /api/checkins` | Body `{"astronaut_id":1,"readings":[{"indicator_id":"heart_rate","value":72,"method":"manual"}],"notes":""}`. Validates ids, `min_plausible..max_plausible`, required indicators. Inserts check-in (now, mission day), readings, then anomaly score (5.3). Returns 201 `{"checkin_id":123,"status":<5.1>}`; `status` always describes that check-in (also when two saves race or the same `client_submission_id` is sent again). |
| `GET /api/astronauts/{id}/history?days=60` | `{"indicators":["heart_rate",...],"points":[{"checkin_id","taken_at","mission_day","values":{"heart_rate":72,...},"anomaly_score":0.12,"is_anomaly":false,"score":84}]}` oldest first. `score` = vitals-only health score of that check-in (4.1 vitals part), to keep history cheap. |
| `GET /api/astronauts/{id}/bone?days_ahead=180` | `{"mission_day","months","gravity_factor","exercise_avg_min","exercise_factor","note":"Projection from published loss rates, not a scan.","sites":[{"bone_site_id","name","body_region_id","loss_pct_per_month","baseline_bmd","current_bmd","loss_pct","status","projected":[{"mission_day","bmd","loss_pct"}]}]}` |
| `GET /api/radiation?astronaut_id=1&mission=iss` | `{"mission_id","zones":[{zone row..., "background_msv_per_day","event_msv_per_h"}],"active_event":<event>\|null,"events":[last 30 days, newest first],"astronaut":{"mission_dose_msv","today_msv","limit_msv","pct_of_limit","daily":[{"day","msv"}] last 30 days},"recommended_zone_id","note":"Estimate from a simplified shielding model."}`. `mission` defaults to the astronaut's mission; `astronaut` is null without `astronaut_id`. |
| `GET /api/solar-events?days=30` | `[event rows]` newest first |

### 5.1 Status object

The status object includes `freshness: {state, age_hours}`. A check-in older than `routine.checkin_interval_h` is a last-known reading: its score is unavailable and triage requests a new check-in. Historical values are classified with the mission day stored on their own check-in.
```json
{
  "astronaut": {"id":1,"name":"...","role":"...","sex":"F","birth_year":1985,"height_cm":165,"preflight_mass_kg":62,"mission_id":"iss","mission_start":"2026-09-01","mission_day":73,"avatar_color":"#..."},
  "mission": { "...missions row..." },
  "checkin": {"id":123,"taken_at":"2026-11-12T07:10:00Z","mission_day":73} ,
  "score": {"value":78,"band":"good","parts":{"vitals":90,"anomaly":85,"bone":70,"radiation":88},"reasons":["..."]},
  "indicators": [{"indicator_id":"heart_rate","name":"Heart rate","unit":"bpm","decimals":0,"body_region_id":"heart",
                  "value":72,"status":"normal","direction":null,
                  "range":{"normal_low":50,"normal_high":100,"critical_low":40,"critical_high":130,"adjusted":false,"note":null},
                  "baseline_mean":68.2,"delta_pct":5.6}],
  "regions": [{"body_region_id":"heart","name":"Heart","status":"normal","indicator_ids":["heart_rate","systolic_bp"]}],
  "anomaly": {"anomaly_score":0.12,"is_anomaly":false,"method":"tf_autoencoder","contributors":[]},
  "bone": {"worst_site_id":"femoral_neck","worst_loss_pct":4.2,"status":"normal"},
  "radiation": {"mission_dose_msv":41.3,"today_msv":0.52,"pct_of_limit":6.9,"active_event":null,"recommended_zone_id":"iss_storm_shelter"},
  "triage": {"level":1,"consult_mode":"ground_led","comms_delay_s":0.5,"reply_minutes":0,"headline":"...","contact":"...",
             "instructions":["..."],
             "guidance":[{"indicator_id":"sleep_hours","severity":"watch","direction":"low","summary":"...","self_care":["..."],"protocol":null}]}
}
```
`checkin`, `anomaly` are null when the astronaut has no check-ins; then every indicator is `missing`. Region status = worst status of its indicators (missing ignored; all missing → `missing`); add region `bone` status from bone sites in that region.
`baseline_mean` = mean of that indicator over the previous 20 check-ins (null if < 3). `delta_pct` = `100*(value-baseline_mean)/abs(baseline_mean)` rounded to 1 decimal, null when no baseline.

### 5.2 Model detection
At startup the backend checks for `ml/model/meta.json`. If present, `GET /api/health` reports `tf_autoencoder`.

### 5.3 Scoring a new check-in
After insert, run `python ml/score.py --db <db> --checkin <id>` (command from env `ASTRO_PYTHON`, default `python`; 20 s timeout). Exit code 0 means `ml_scores` has the row. Any failure: compute 4.2 in Rust and insert with `method='zscore_fallback'` (or `insufficient_history`). The POST never fails because of the model.

## 6. ML (Agent 2)

- `ml/common.py`: db access, feature extraction (same feature set and baseline as 4.2), z-scoring a check-in against its baseline. Python stdlib + numpy.
- `ml/train.py`: builds training vectors for every check-in with >= `ml.min_history` baseline (vector = per-feature z, missing → 0), trains a small dense autoencoder (Keras: n → 8 → 3 → 8 → n, MSE, 60 epochs, seed 42), threshold = 99th percentile of training reconstruction error. Saves `ml/model/autoencoder.keras` and `ml/model/meta.json` `{"version","features":[...],"threshold","trained_at","n_samples"}`. Then scores every check-in and upserts `ml_scores` (`method='tf_autoencoder'`, `model_version`). `anomaly_score = clamp(err / (2*threshold), 0, 1)`; contributors = top 3 features by squared reconstruction error with their z, value, baseline mean, sd. Check-ins with too little history get `insufficient_history`.
- `ml/score.py --db PATH --checkin ID [--all]`: loads the model and scores; if TensorFlow or the model is missing, scores with 4.2 and `method='zscore_fallback'`; exit 0 on success, non-zero only when the check-in does not exist or the db cannot be opened.
- `ml/requirements.txt`: `tensorflow>=2.15,<2.21` and `numpy`.

## 7. Seeder (Agent 1)

`python tools/seed.py [--db PATH] [--days 60] [--fresh]` — creates the db from `db/schema.sql`, loads every `data/seed/*.json` in foreign-key order, then generates simulated history (`source='sim'`, `method='sim'`) for each astronaut for the last N days, one check-in per day at a random morning time, realistic personal baselines with noise, slow drifts (rising resting heart rate in microgravity is fine to omit; keep it plausible), a few deliberate anomalies, and one strong solar particle event 3 days before today (`source='sim'`, `dose_relevant=1`) plus a few non-dose events. Also exposure_log rows for the last N days (default hours, crew moved to the shelter during the simulated storm). Writes `meta` rows. Deterministic with `--seed 7` default.

`python tools/fetch_donki.py [--days 30] [--api-key DEMO_KEY]` — fetches `https://api.nasa.gov/DONKI/SEP`, `/CME` (FLR returns 404) with `startDate`/`endDate`, maps to `solar_events` (`source='donki'`, SEP rows `dose_relevant=1`, severity from flare class or 0.5 for SEP), upserts. Uses urllib only; prints a clear message and exits 1 on network failure.

`python tools/fetch_gbm.py [--days 30]` — loads Fermi GBM flares (`source='gbm'`, `dose_relevant=0`, severity from peak counts) and replaces DONKI FLR, which returns 404; `'gbm'` was added to the `solar_events.source` CHECK in `db/schema.sql` (lead-approved schema change). `python tools/fetch_tepc.py [--write-seed]` sets the `iss` mission's `gcr_msv_per_day` from the ISS TEPC measured dose (`source_ref='iss_tepc'`).

## 8. Mock API for frontend work

`node tools/dev-server.mjs` serves `frontend/` on `http://127.0.0.1:5173` and answers API calls from `frontend/mock/`:
`/api/config`→`config.json`, `/api/astronauts`→`astronauts.json`, `/api/astronauts/{id}/status`→`status.json` (or `status-{mission}.json` when `?mission=` is given and that file exists), `/api/astronauts/{id}/history`→`history.json`, `/api/astronauts/{id}/bone`→`bone.json`, `/api/radiation`→`radiation.json`, `/api/solar-events`→`solar-events.json`, `POST /api/checkins`→`checkin-post.json` (status 201), `/api/health`→`{"ok":true,"model":"mock"}`.
Mock files follow section 5 exactly. Agent 4 writes `config.json`, `astronauts.json`, `status.json`, `status-moon.json`, `status-mars.json`, `checkin-post.json`. Agent 5 writes `history.json`, `bone.json`, `radiation.json`, `solar-events.json`.

## 9. Frontend rules (Agents 4 and 5)

- Pages include `index.html` (Home), `checkin.html` (Check-in), `activity.html` (Activity & Recommendations), `radiation.html` (Radiation), `gravity.html` (Gravital Tracking), and `trends.html` (Trends). Each page links shared `css/base.css`, page/layout CSS and its JavaScript module.
- Every page starts by calling `initShell({ page: '<page id>' })` from `js/shell.js`. It renders the header and navigation into `<header id="app-header"></header>`, loads config and the crew, and resolves `{ config, astronauts, astronautId }`. Listen for the `astronaut-change` event on `window` (`event.detail.astronautId`) and re-render.
- Fetch only through `js/api.js` (`api.status(id, mission)`, etc.). Never hard-code indicator ids, ranges, labels or units: render from config and API data. The one allowed exception is the body-map drawing, whose shapes are keyed by `body_regions.id`; an unknown region id must still appear in the region list.
- Use the classes and tokens in `css/base.css`. Page css may add layout only; colours, type sizes, spacing and radii come from `var(--...)` tokens. No new colours.
- Status words and colours: always text + colour, never colour alone (`<span class="status" data-status="watch">Watch</span>`).
- Charts: inline SVG drawn by hand. No canvas libraries.
- Copy: sentence case, plain verbs, short. Label every estimate: bone values are "projected", radiation dose is "estimated", the score explains itself with reasons.
- States: loading (`<p class="state">Loading…</p>`), error (`showError(container, err)` from shell.js), empty (a sentence that says what to do next).
- Keyboard: every interactive thing is a real `button`, `a`, `input` or `select`; visible focus comes from base.css.
- Must work at 360 px wide and at 1440 px.

## 10. NASA HIDH interface rules (Human Integration Design Handbook, Rev. 1)

Verified against the handbook text. Page numbers are the printed page numbers (PDF page minus 5).

| Rule | Source | How the app does it |
|---|---|---|
| Red = warning/emergency, yellow = caution, green = normal, blue = advisory, magenta = radiation hazard; each colour keeps one meaning | 10.11.5.5, p. 1063–1064 | Tokens `--alert`, `--watch`, `--good`, `--advisory`, `--radiation`. Actions and selection use neutral `--accent` (grey/white), never a status colour. User-facing words: watch → "Caution", alert → "Warning" (`STATUS_LABEL`). |
| Colour is never the only code | p. 1033 | `statusBadge()` = word + colour + shape (circle normal, diamond advisory, triangle caution, octagon warning). SVG fills also need a pattern, a label or a text alternative. |
| Text large enough: at least 0.4° of visual angle ("10-pt font at 19 inches"; stated for high-g displays, used here as a floor) | p. 122 | Smallest text is `--text-xs` (14 px). No font-size below it anywhere, including SVG text (use `--text-chart`, 13 px only for chart axis numbers). |
| Line spacing ≥ 0.15 letter height (HFES); character contrast > 0.7 (TCO) | p. 947 | Line height 1.5; text colours on `--bg`/`--surface` all pass. Do not add lighter greys. |
| Suppressed information is indicated and restored in one action | p. 187 | Secondary detail goes in `<details class="more">` whose summary says what and how much is hidden ("Show 3 more reasons"). |
| Visual warnings paired with an auditory cue | 10.6.20.2, p. 1034 | Not implemented: the sound alert button was removed at the user's request (Nov 2026). Warnings are visual only (word, colour, shape). |
| Protect against inadvertent operation; confirm commands that cannot be undone | p. 1015 | `--target` 48 px minimum for anything pressed; `confirmAction()` before submitting a check-in (it cannot be edited afterwards). |
| Medical decision aids: numbered steps with a clear beginning and end; do not violate colour conventions | p. 621 | Triage instructions use `ol.steps` with `data-step="done" \| "current"`. |
| Most important information first | — (design choice) | Each page leads with `masterAlert()` when anything needs attention, then the action, then detail. |
