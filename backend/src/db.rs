//! Database access: connection, generic row-to-JSON queries, model parameters, time and number helpers.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use rusqlite::types::{ToSql, ValueRef};
use rusqlite::Connection;
use serde_json::{Map, Value};

use crate::errors::AppError;

/// One database row as JSON: column name -> value.
pub type Row = Map<String, Value>;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub db_path: String,
    pub model: String,
    pub python: String,
}

/// Locks the shared connection. Never hold the guard across an .await.
pub fn lock(st: &AppState) -> Result<MutexGuard<'_, Connection>, AppError> {
    st.db
        .lock()
        .map_err(|_| AppError::internal("The database is busy. Try again."))
}

pub fn open(path: &str) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS submission_keys (
            key TEXT PRIMARY KEY,
            checkin_id INTEGER NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cabin_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id TEXT NOT NULL REFERENCES missions(id),
            taken_at TEXT NOT NULL,
            co2_ppm REAL NOT NULL,
            temperature_c REAL NOT NULL,
            humidity_pct REAL NOT NULL,
            source TEXT NOT NULL DEFAULT 'sim'
        );
        CREATE INDEX IF NOT EXISTS idx_cabin_readings_mission_time
            ON cabin_readings(mission_id, taken_at);
        CREATE TABLE IF NOT EXISTS gravity_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id TEXT NOT NULL REFERENCES missions(id),
            observed_at TEXT NOT NULL,
            gravity_g REAL NOT NULL CHECK (gravity_g >= 0 AND gravity_g <= 2),
            uncertainty_low_g REAL,
            uncertainty_high_g REAL,
            source TEXT NOT NULL DEFAULT 'mission_profile_sim'
        );
        CREATE INDEX IF NOT EXISTS idx_gravity_readings_mission_time
            ON gravity_readings(mission_id, observed_at);
        INSERT INTO gravity_readings
            (mission_id, observed_at, gravity_g, uncertainty_low_g, uncertainty_high_g, source)
        SELECT m.id, strftime('%Y-%m-%dT%H:%M:%SZ','now'), m.gravity_g,
               CASE WHEN m.gravity_g > 0 AND m.gravity_g < 1 THEN MAX(0, m.gravity_g - 0.08) ELSE m.gravity_g END,
               CASE WHEN m.gravity_g > 0 AND m.gravity_g < 1 THEN MIN(2, m.gravity_g + 0.08) ELSE m.gravity_g END,
               'mission_profile_migration'
        FROM missions m
        WHERE NOT EXISTS (SELECT 1 FROM gravity_readings g WHERE g.mission_id=m.id);",
    )?;
    Ok(conn)
}

fn read_row(r: &rusqlite::Row<'_>, names: &[String]) -> rusqlite::Result<Row> {
    let mut m = Row::new();
    for (i, name) in names.iter().enumerate() {
        let v = match r.get_ref(i)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n) => Value::from(n),
            ValueRef::Real(f) => Value::from(f),
            ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(_) => Value::Null,
        };
        m.insert(name.clone(), v);
    }
    Ok(m)
}

/// Runs a query and returns every row as a JSON object keyed by column name.
pub fn query_rows(conn: &Connection, sql: &str, args: &[&dyn ToSql]) -> Result<Vec<Row>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(args)?;
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        out.push(read_row(r, &names)?);
    }
    Ok(out)
}

pub fn first_row(
    conn: &Connection,
    sql: &str,
    args: &[&dyn ToSql],
) -> Result<Option<Row>, AppError> {
    Ok(query_rows(conn, sql, args)?.into_iter().next())
}

pub fn num(r: &Row, k: &str) -> Option<f64> {
    r.get(k).and_then(|v| v.as_f64())
}

pub fn int(r: &Row, k: &str) -> Option<i64> {
    r.get(k).and_then(|v| v.as_i64())
}

pub fn text(r: &Row, k: &str) -> Option<String> {
    r.get(k).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub fn sval(r: &Row, k: &str) -> String {
    text(r, k).unwrap_or_default()
}

/// Tunable numbers from model_params, with the section 4 defaults as fallback.
pub struct Params {
    map: HashMap<String, f64>,
}

impl Params {
    pub fn load(conn: &Connection) -> Result<Params, AppError> {
        let rows = query_rows(conn, "SELECT key, value FROM model_params", &[])?;
        let mut map = HashMap::new();
        for r in &rows {
            if let (Some(k), Some(v)) = (text(r, "key"), num(r, "value")) {
                map.insert(k, v);
            }
        }
        Ok(Params { map })
    }

    pub fn get(&self, key: &str) -> f64 {
        match self.map.get(key) {
            Some(v) => *v,
            None => default_for(key),
        }
    }
}

fn default_for(key: &str) -> f64 {
    for &(k, v) in DEFAULTS {
        if k == key {
            return v;
        }
    }
    0.0
}

const DEFAULTS: &[(&str, f64)] = &[
    ("context.environment_fresh_h", 24.0),
    ("score.normal_points", 100.0),
    ("score.watch_points", 60.0),
    ("score.alert_points", 10.0),
    ("score.bone_penalty_per_pct", 8.0),
    ("score.storm_penalty", 20.0),
    ("score.w_vitals", 0.45),
    ("score.w_anomaly", 0.25),
    ("score.w_bone", 0.15),
    ("score.w_radiation", 0.15),
    ("ml.baseline_n", 20.0),
    ("ml.min_history", 7.0),
    ("ml.sd_floor_frac", 0.05),
    ("ml.z_alert", 3.0),
    ("bone.exercise_window_days", 7.0),
    ("bone.exercise_max_reduction", 0.5),
    ("bone.exercise_target_min", 120.0),
    ("bone.alert_pct", 10.0),
    ("bone.watch_pct", 5.0),
    ("rad.ref_shield_g_cm2", 20.0),
    ("rad.gcr_atten_g_cm2", 70.0),
    ("rad.sep_peak_msv_per_h", 93.0),
    ("rad.sep_atten_g_cm2", 8.0),
    ("rad.sep_default_duration_h", 72.0),
    ("rad.career_limit_msv", 600.0),
    ("kcal.eer_m_const", 622.0),
    ("kcal.eer_m_age", 9.53),
    ("kcal.eer_m_mass", 15.9),
    ("kcal.eer_m_height", 539.6),
    ("kcal.eer_f_const", 354.0),
    ("kcal.eer_f_age", 6.91),
    ("kcal.eer_f_mass", 9.36),
    ("kcal.eer_f_height", 726.0),
    ("kcal.activity_factor", 1.25),
    ("grip.normal_low_m", 27.0),
    ("grip.normal_low_f", 16.0),
];

/// Current time as ISO 8601 UTC text, e.g. 2026-11-12T07:10:00Z.
pub fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// ISO 8601 UTC text for `days` days ago (days must be small enough for chrono).
pub fn iso_ago(days: i64) -> String {
    (Utc::now() - chrono::Duration::days(days))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

pub fn today() -> NaiveDate {
    Utc::now().date_naive()
}

/// Parses ISO timestamps (with or without seconds, with or without Z) to Unix seconds.
pub fn parse_ts(s: &str) -> Option<i64> {
    let t = s.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(t) {
        return Some(dt.timestamp());
    }
    let base = t.trim_end_matches('Z');
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(base, fmt) {
            return Some(DateTime::<Utc>::from_naive_utc_and_offset(n, Utc).timestamp());
        }
    }
    None
}

/// Unix seconds at 00:00 UTC of the given date.
pub fn day_start_secs(d: NaiveDate) -> Option<i64> {
    d.and_hms_opt(0, 0, 0)
        .map(|n| DateTime::<Utc>::from_naive_utc_and_offset(n, Utc).timestamp())
}

/// Mission day: days between mission_start and today, plus one.
pub fn mission_day(start: &str, today: NaiveDate) -> i64 {
    match NaiveDate::parse_from_str(start, "%Y-%m-%d") {
        Ok(d) => (today - d).num_days() + 1,
        Err(_) => 1,
    }
}

pub fn round_to(x: f64, decimals: i32) -> f64 {
    let m = 10f64.powi(decimals);
    (x * m).round() / m
}

pub fn fmt_num(x: f64, decimals: i64) -> String {
    format!("{:.*}", decimals.max(0) as usize, x)
}

/// Reads an integer query parameter, falling back to a default and clamping to [min, max].
pub fn qint(q: &HashMap<String, String>, key: &str, default: i64, min: i64, max: i64) -> i64 {
    match q.get(key).and_then(|s| s.trim().parse::<i64>().ok()) {
        Some(v) => v.max(min).min(max),
        None => default,
    }
}
