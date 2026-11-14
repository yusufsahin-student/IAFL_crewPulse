-- Astronaut Health Monitor: SQLite schema.
-- Single source of truth for every runtime (Python seeder, Python ML service, Rust backend).
-- Rules and formulas that use these tables are in docs/CONTRACT.md.
--
-- Conventions
--   * Timestamps are ISO 8601 UTC text: 'YYYY-MM-DDTHH:MM:SSZ'. Dates are 'YYYY-MM-DD'.
--   * Booleans are INTEGER 0/1.
--   * Reference tables are filled from data/seed/<table>.json: an array of row objects whose
--     keys are exactly these column names. To change the data, edit that file and reseed.
--   * Every source_ref points at sources.id, so each number shown in the app can be cited.
--   * Text columns that hold several steps use '\n' between steps.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,              -- 'schema_version', 'seeded_at', 'seed_today'
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id    TEXT PRIMARY KEY,              -- e.g. 'nasa_hrp', 'assumption'
  title TEXT NOT NULL,
  url   TEXT,                          -- NULL when no verified link is known. Never invent one.
  kind  TEXT NOT NULL DEFAULT 'reference'
        CHECK (kind IN ('reference','dataset','api','assumption')),
  note  TEXT
);

-- Where the crew is. Drives triage, radiation background and bone loss.
CREATE TABLE IF NOT EXISTS missions (
  id                  TEXT PRIMARY KEY,   -- 'iss' | 'moon' | 'mars' (more may be added)
  name                TEXT NOT NULL,
  description         TEXT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  distance_km         REAL,               -- typical distance from Earth, for display
  comms_delay_s       REAL NOT NULL,      -- one-way signal delay in seconds (worst case)
  consult_mode        TEXT NOT NULL       -- who leads medical decisions
                      CHECK (consult_mode IN ('ground_led','shared','crew_led')),
  evac_days           REAL,               -- time to reach care on Earth; NULL = no evacuation
  gravity_g           REAL NOT NULL,      -- 0 in orbit or transit, 0.166 Moon, 0.38 Mars surface
  gcr_msv_per_day     REAL NOT NULL,      -- background dose rate behind reference shielding
  sep_exposure_factor REAL NOT NULL DEFAULT 1,  -- share of a solar particle event that reaches the crew (0..1)
  source_ref          TEXT REFERENCES sources(id)
);

-- Time-varying gravity context. Imported/sensor readings can replace the simulated mission
-- profile without changing the API or the calculations that consume the latest value.
CREATE TABLE IF NOT EXISTS gravity_readings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id         TEXT NOT NULL REFERENCES missions(id),
  observed_at        TEXT NOT NULL,
  gravity_g          REAL NOT NULL CHECK (gravity_g >= 0 AND gravity_g <= 2),
  uncertainty_low_g  REAL CHECK (uncertainty_low_g IS NULL OR uncertainty_low_g >= 0),
  uncertainty_high_g REAL CHECK (uncertainty_high_g IS NULL OR uncertainty_high_g <= 2),
  source             TEXT NOT NULL DEFAULT 'mission_profile_sim'
);
CREATE INDEX IF NOT EXISTS idx_gravity_readings_mission_time
  ON gravity_readings(mission_id, observed_at);

CREATE TABLE IF NOT EXISTS astronauts (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,            -- fictional demo crew only
  role              TEXT,
  sex               TEXT CHECK (sex IN ('F','M','X')),
  birth_year        INTEGER,
  height_cm         REAL,
  preflight_mass_kg REAL,
  mission_id        TEXT NOT NULL REFERENCES missions(id),
  mission_start     TEXT NOT NULL,            -- date of mission day 1
  avatar_color      TEXT
);

-- Clickable parts of the body map.
CREATE TABLE IF NOT EXISTS body_regions (
  id            TEXT PRIMARY KEY,         -- 'head','heart','lungs','abdomen','spine','hips','legs','whole_body'
  name          TEXT NOT NULL,
  description   TEXT,
  alert         TEXT,                     -- optional advisory shown above the region's readings (e.g. eye risk)
  display_order INTEGER NOT NULL DEFAULT 0
);

-- One row per health indicator. Adding an indicator is a data change, not a code change.
CREATE TABLE IF NOT EXISTS indicators (
  id               TEXT PRIMARY KEY,      -- snake_case, e.g. 'heart_rate'
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL,         -- display unit, e.g. 'bpm'
  decimals         INTEGER NOT NULL DEFAULT 0,
  body_region_id   TEXT NOT NULL REFERENCES body_regions(id),
  hazard           TEXT CHECK (hazard IN ('radiation','isolation','distance','gravity','environment')),
  input_type       TEXT NOT NULL DEFAULT 'number'
                   CHECK (input_type IN ('number','scale','game','camera','vision','amsler')),
                   -- number: typed value. scale: 1..N self rating. game: filled by the reaction test.
                   -- camera: can be measured with the camera or typed.
                   -- vision: near-acuity tumbling-E test on screen. amsler: Amsler grid on screen. Both fill a number the user can still type.
  scale_labels     TEXT,                  -- JSON array of labels for 'scale', lowest first
  step             REAL NOT NULL DEFAULT 1,
  min_plausible    REAL NOT NULL,         -- input outside [min_plausible, max_plausible] is rejected
  max_plausible    REAL NOT NULL,
  normal_low       REAL,                  -- Earth reference range; NULL = no bound
  normal_high      REAL,
  critical_low     REAL,                  -- beyond a critical bound the status is 'alert'
  critical_high    REAL,
  higher_is_better INTEGER,               -- 1, 0 or NULL (neither)
  weight           REAL NOT NULL DEFAULT 1,     -- weight in the health score
  ml_feature       INTEGER NOT NULL DEFAULT 1,  -- 1 = used by the anomaly model
  required         INTEGER NOT NULL DEFAULT 0,  -- 1 = asked for in every check-in
  display_order    INTEGER NOT NULL DEFAULT 0,
  how_to_measure   TEXT,                  -- plain steps for the astronaut
  why_it_matters   TEXT,                  -- how spaceflight affects this indicator
  source_ref       TEXT REFERENCES sources(id)
);

-- "Normal for space": bounds that replace the Earth range for a mission and a span of mission days.
-- A NULL bound means "keep the Earth value from indicators".
CREATE TABLE IF NOT EXISTS indicator_adjustments (
  id            INTEGER PRIMARY KEY,
  indicator_id  TEXT NOT NULL REFERENCES indicators(id),
  mission_id    TEXT REFERENCES missions(id),   -- NULL = any mission
  day_from      INTEGER NOT NULL DEFAULT 1,     -- mission day, inclusive
  day_to        INTEGER,                        -- inclusive; NULL = open ended
  normal_low    REAL,
  normal_high   REAL,
  critical_low  REAL,
  critical_high REAL,
  note          TEXT NOT NULL,                  -- shown to the astronaut
  source_ref    TEXT REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS checkins (
  id           INTEGER PRIMARY KEY,
  astronaut_id INTEGER NOT NULL REFERENCES astronauts(id),
  taken_at     TEXT NOT NULL,              -- timestamp
  mission_day  INTEGER NOT NULL,           -- 1-based, from astronauts.mission_start
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','sim','import')),
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkins_astronaut_time ON checkins(astronaut_id, taken_at);

CREATE TABLE IF NOT EXISTS readings (
  id           INTEGER PRIMARY KEY,
  checkin_id   INTEGER NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  indicator_id TEXT NOT NULL REFERENCES indicators(id),
  value        REAL NOT NULL,
  method       TEXT NOT NULL DEFAULT 'manual'
               CHECK (method IN ('manual','camera','game','device','sim','import')),
  UNIQUE (checkin_id, indicator_id)
);
CREATE INDEX IF NOT EXISTS idx_readings_indicator ON readings(indicator_id);

-- One anomaly result per check-in, written by ml/train.py (backfill) or by the backend (new check-ins).
CREATE TABLE IF NOT EXISTS ml_scores (
  checkin_id    INTEGER PRIMARY KEY REFERENCES checkins(id) ON DELETE CASCADE,
  anomaly_score REAL NOT NULL,             -- 0..1; above 0.5 means unusual for this astronaut
  is_anomaly    INTEGER NOT NULL,
  method        TEXT NOT NULL
                CHECK (method IN ('tf_autoencoder','zscore_fallback','insufficient_history')),
  model_version TEXT,
  contributors  TEXT NOT NULL DEFAULT '[]', -- JSON array, see CONTRACT section 6
  scored_at     TEXT NOT NULL
);

-- Bone sites and published loss rates. Projection only; nothing here is measured in flight.
CREATE TABLE IF NOT EXISTS bone_sites (
  id                 TEXT PRIMARY KEY,     -- 'lumbar_spine','femoral_neck','trochanter','pelvis','calcaneus'
  name               TEXT NOT NULL,
  body_region_id     TEXT NOT NULL REFERENCES body_regions(id),
  loss_pct_per_month REAL NOT NULL,        -- % of bone mineral density lost per month in microgravity with no countermeasures
  display_order      INTEGER NOT NULL DEFAULT 0,
  source_ref         TEXT REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS bone_baselines (
  astronaut_id INTEGER NOT NULL REFERENCES astronauts(id),
  bone_site_id TEXT NOT NULL REFERENCES bone_sites(id),
  bmd_g_cm2    REAL NOT NULL,              -- pre-flight scan value
  measured_on  TEXT NOT NULL,              -- date
  PRIMARY KEY (astronaut_id, bone_site_id)
);

-- The habitat as rectangles on a 100 x 60 floor plan. Replace these rows to model another vehicle.
CREATE TABLE IF NOT EXISTS habitat_zones (
  id              TEXT PRIMARY KEY,        -- unique across missions, e.g. 'iss_crew_quarters'
  mission_id      TEXT NOT NULL REFERENCES missions(id),
  name            TEXT NOT NULL,
  description     TEXT,
  shielding_g_cm2 REAL NOT NULL,           -- areal density of shielding around the zone
  is_shelter      INTEGER NOT NULL DEFAULT 0,
  default_hours   REAL NOT NULL DEFAULT 0, -- typical hours per day here; sums to 24 per mission
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS solar_events (
  id            TEXT PRIMARY KEY,          -- DONKI activity id, or 'sim-...' for demo storms
  event_type    TEXT NOT NULL,             -- 'SEP','FLR','CME','GST',...
  start_time    TEXT NOT NULL,             -- timestamp
  end_time      TEXT,                      -- NULL = start + rad.sep_default_duration_h
  class_type    TEXT,                      -- e.g. flare class 'X1.2'
  severity      REAL NOT NULL DEFAULT 0 CHECK (severity >= 0 AND severity <= 1),
  dose_relevant INTEGER NOT NULL DEFAULT 0, -- 1 = adds dose in the model (particle events)
  source        TEXT NOT NULL DEFAULT 'donki' CHECK (source IN ('donki','sample','sim','gbm')),
  link          TEXT,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_solar_events_start ON solar_events(start_time);

-- Where each astronaut spent each day. Days without rows use habitat_zones.default_hours.
CREATE TABLE IF NOT EXISTS exposure_log (
  id           INTEGER PRIMARY KEY,
  astronaut_id INTEGER NOT NULL REFERENCES astronauts(id),
  day          TEXT NOT NULL,              -- date
  zone_id      TEXT NOT NULL REFERENCES habitat_zones(id),
  hours        REAL NOT NULL,
  UNIQUE (astronaut_id, day, zone_id)
);

-- Cabin context. These readings explain the environment around a check-in but never alter a
-- crew member's health score. Production missions can replace simulated rows with device imports.
CREATE TABLE IF NOT EXISTS cabin_readings (
  id            INTEGER PRIMARY KEY,
  mission_id    TEXT NOT NULL REFERENCES missions(id),
  taken_at      TEXT NOT NULL,
  co2_ppm       REAL NOT NULL,
  temperature_c REAL NOT NULL,
  humidity_pct  REAL NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('device','sim','import'))
);
CREATE INDEX IF NOT EXISTS idx_cabin_readings_mission_time ON cabin_readings(mission_id, taken_at);

-- What to do about one indicator that is out of range.
CREATE TABLE IF NOT EXISTS guidance (
  id           INTEGER PRIMARY KEY,
  indicator_id TEXT NOT NULL REFERENCES indicators(id),
  direction    TEXT NOT NULL CHECK (direction IN ('low','high','any')),
  severity     TEXT NOT NULL CHECK (severity IN ('watch','alert')),
  summary      TEXT NOT NULL,              -- one sentence: what this can mean
  self_care    TEXT NOT NULL,              -- steps the astronaut can take alone
  protocol     TEXT,                       -- extra steps when the crew must act before ground can answer
  source_ref   TEXT REFERENCES sources(id)
);

-- Distance-aware escalation: one row per triage level and consult mode (4 x 3 rows).
-- Text may contain {mission}, {delay} and {reply_minutes}.
CREATE TABLE IF NOT EXISTS triage_actions (
  id           INTEGER PRIMARY KEY,
  level        INTEGER NOT NULL CHECK (level BETWEEN 0 AND 3),
  consult_mode TEXT NOT NULL CHECK (consult_mode IN ('ground_led','shared','crew_led')),
  headline     TEXT NOT NULL,
  contact      TEXT NOT NULL,              -- who to involve
  instructions TEXT NOT NULL,              -- steps
  UNIQUE (level, consult_mode)
);

-- Every tunable number used by the score, bone, radiation and triage rules.
CREATE TABLE IF NOT EXISTS model_params (
  key         TEXT PRIMARY KEY,            -- e.g. 'bone.exercise_target_min'
  value       REAL NOT NULL,
  unit        TEXT,
  description TEXT NOT NULL,
  source_ref  TEXT REFERENCES sources(id)
);

-- Retry-safe client submissions; no duplicate health readings after a lost response.
CREATE TABLE IF NOT EXISTS submission_keys (
 key TEXT PRIMARY KEY,
 checkin_id INTEGER NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
 payload TEXT NOT NULL
);
