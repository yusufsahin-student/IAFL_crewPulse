//! POST /api/checkins: validate, store, score (python first, z-score fallback in Rust).

use std::collections::{HashMap, HashSet};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header::CONTENT_TYPE, HeaderMap, StatusCode};
use axum::Json;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::anomaly;
use crate::db::{self, first_row, int, num, query_rows, sval, AppState, Params, Row};
use crate::errors::AppError;
use crate::status::{build_status, checkin_values};

const SCORER_TIMEOUT_S: u64 = 20;
const METHODS: [&str; 6] = ["manual", "camera", "game", "device", "sim", "import"];

#[derive(Deserialize, serde::Serialize)]
pub struct CheckinIn {
    pub astronaut_id: i64,
    #[serde(default)]
    pub client_submission_id: Option<String>,
    #[serde(default)]
    pub readings: Vec<ReadingIn>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Deserialize, serde::Serialize)]
pub struct ReadingIn {
    pub indicator_id: String,
    pub value: f64,
    #[serde(default)]
    pub method: Option<String>,
}

pub async fn post_checkin(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type
        .split(';')
        .next()
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
    {
        return Err(AppError::unsupported_media(
            "Content-Type must be application/json.",
        ));
    }
    let input: CheckinIn = serde_json::from_slice(&body).map_err(|_| {
        AppError::bad("The request body must be JSON with astronaut_id and readings.")
    })?;
    let astro_id = input.astronaut_id;

    // Store the check-in in its own scope so the lock is released before any await.
    let cid = {
        let mut conn = db::lock(&st)?;
        save_checkin(&mut conn, &input)?
    };

    let python = st.python.clone();
    let db_path = st.db_path.clone();
    let scored = tokio::task::spawn_blocking(move || run_scorer(&python, &db_path, cid))
        .await
        .unwrap_or(false);
    if !scored {
        eprintln!(
            "ML scorer did not finish for check-in {}; using the z-score fallback.",
            cid
        );
    }

    let conn = db::lock(&st)?;
    if anomaly::stored(&conn, cid)?.is_none() {
        let taken = match first_row(
            &conn,
            "SELECT taken_at FROM checkins WHERE id = ?1",
            params![cid],
        )? {
            Some(r) => sval(&r, "taken_at"),
            None => String::new(),
        };
        let values = checkin_values(&conn, cid)?;
        let p = Params::load(&conn)?;
        let a = anomaly::zscore(&conn, &p, astro_id, cid, &taken, &values)?;
        anomaly::save(&conn, cid, &a, None)?;
    }
    let status = build_status(&conn, astro_id, None)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "checkin_id": cid, "status": status })),
    ))
}

/// Validates the body against the database, then inserts the check-in and its readings in one transaction.
fn save_checkin(conn: &mut Connection, input: &CheckinIn) -> Result<i64, AppError> {
    if input
        .notes
        .as_deref()
        .is_some_and(|notes| notes.chars().count() > 4000)
    {
        return Err(AppError::bad_field(
            "Notes must be 4000 characters or fewer.",
            "notes",
        ));
    }
    let payload = serde_json::to_string(input).map_err(|_| AppError::bad("Invalid submission"))?;
    if let Some(key) = &input.client_submission_id {
        if key.len() > 128 || key.is_empty() {
            return Err(AppError::bad("Invalid submission id"));
        }
        if let Some(row) = first_row(
            conn,
            "SELECT checkin_id, payload FROM submission_keys WHERE key = ?1",
            params![key],
        )? {
            if sval(&row, "payload") != payload {
                return Err(AppError::bad(
                    "Submission id already used with different readings",
                ));
            }
            return Ok(int(&row, "checkin_id").unwrap());
        }
    }
    let astro = match first_row(
        conn,
        "SELECT * FROM astronauts WHERE id = ?1",
        params![input.astronaut_id],
    )? {
        Some(a) => a,
        None => return Err(AppError::not_found("Unknown astronaut.")),
    };

    let indicator_rows = query_rows(conn, "SELECT * FROM indicators", &[])?;
    let mut by_id: HashMap<String, Row> = HashMap::new();
    for r in indicator_rows {
        by_id.insert(sval(&r, "id"), r);
    }

    let mut seen: HashSet<String> = HashSet::new();
    for r in &input.readings {
        let ind = match by_id.get(&r.indicator_id) {
            Some(i) => i,
            None => return Err(AppError::bad_field("Unknown indicator.", &r.indicator_id)),
        };
        if !seen.insert(r.indicator_id.clone()) {
            return Err(AppError::bad_field(
                "This indicator is listed more than once.",
                &r.indicator_id,
            ));
        }
        let lo = num(ind, "min_plausible").unwrap_or(f64::MIN);
        let hi = num(ind, "max_plausible").unwrap_or(f64::MAX);
        if !(r.value >= lo && r.value <= hi) {
            return Err(AppError::bad_field(
                format!("{} must be between {} and {}.", sval(ind, "name"), lo, hi),
                &r.indicator_id,
            ));
        }
        let method = r.method.as_deref().unwrap_or("manual");
        if !METHODS.contains(&method) {
            return Err(AppError::bad_field(
                "Unknown measurement method.",
                &r.indicator_id,
            ));
        }
    }

    for (id, ind) in &by_id {
        if int(ind, "required").unwrap_or(0) == 1 && !seen.contains(id) {
            return Err(AppError::bad_field(
                format!("{} is required.", sval(ind, "name")),
                id,
            ));
        }
    }

    let taken = db::now_iso();
    let mday = db::mission_day(&sval(&astro, "mission_start"), db::today());
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO checkins (astronaut_id, taken_at, mission_day, source, notes) VALUES (?1, ?2, ?3, 'manual', ?4)",
        params![input.astronaut_id, taken, mday, input.notes],
    )?;
    let cid = tx.last_insert_rowid();
    for r in &input.readings {
        let method = r.method.as_deref().unwrap_or("manual");
        tx.execute(
            "INSERT INTO readings (checkin_id, indicator_id, value, method) VALUES (?1, ?2, ?3, ?4)",
            params![cid, r.indicator_id, r.value, method],
        )?;
    }
    if let Some(key) = &input.client_submission_id {
        tx.execute(
            "INSERT INTO submission_keys(key, checkin_id, payload) VALUES (?1, ?2, ?3)",
            params![key, cid, payload],
        )?;
    }
    tx.commit()?;
    Ok(cid)
}

/// Runs `python ml/score.py` with a timeout. Returns true only when it exits 0.
fn run_scorer(python: &str, db_path: &str, checkin_id: i64) -> bool {
    let spawned = Command::new(python)
        .arg("ml/score.py")
        .arg("--db")
        .arg(db_path)
        .arg("--checkin")
        .arg(checkin_id.to_string())
        .stdout(Stdio::null())
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Could not start {}: {}", python, e);
            return false;
        }
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if started.elapsed() >= Duration::from_secs(SCORER_TIMEOUT_S) {
                    let _ = child.kill();
                    let _ = child.wait();
                    eprintln!("ML scorer timed out after {} seconds.", SCORER_TIMEOUT_S);
                    return false;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => {
                let _ = child.kill();
                return false;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_submission_is_idempotent_and_changed_payload_rejected() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../db/schema.sql"))
            .unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS submission_keys(key TEXT PRIMARY KEY, checkin_id INTEGER, payload TEXT);
          INSERT INTO missions(id,name,comms_delay_s,consult_mode,gravity_g,gcr_msv_per_day) VALUES('test','Test',0,'ground_led',0,0);
          INSERT INTO astronauts(id,name,mission_id,mission_start) VALUES(1,'Test','test','2026-01-01');").unwrap();
        let mut input = CheckinIn {
            astronaut_id: 1,
            client_submission_id: Some("repeat".into()),
            readings: vec![],
            notes: None,
        };
        let a = save_checkin(&mut conn, &input).unwrap();
        assert_eq!(a, save_checkin(&mut conn, &input).unwrap());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM checkins", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        input.notes = Some("changed".into());
        assert!(save_checkin(&mut conn, &input).is_err());
    }

    #[test]
    fn oversized_notes_are_rejected() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../db/schema.sql"))
            .unwrap();
        let input = CheckinIn {
            astronaut_id: 1,
            client_submission_id: None,
            readings: vec![],
            notes: Some("x".repeat(4001)),
        };
        assert!(save_checkin(&mut conn, &input).is_err());
    }
}
