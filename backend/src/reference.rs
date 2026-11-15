//! Health, config and solar-event endpoints.

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::Json;
use rusqlite::params;
use serde_json::{json, Map, Value};

use crate::db::{self, first_row, lock, num, qint, query_rows, sval, text, AppState, Row};
use crate::errors::AppError;

pub async fn health(State(st): State<AppState>) -> Json<Value> {
    // tools/seed.py records seed_today in meta: the crew history in this database is simulated.
    let simulated = lock(&st)
        .ok()
        .and_then(|conn| {
            first_row(&conn, "SELECT value FROM meta WHERE key = 'seed_today'", params![]).ok().flatten()
        })
        .is_some();
    let data = if simulated { "simulated" } else { "recorded" };
    Json(json!({ "ok": true, "model": st.model, "data": data })) // no file paths: the server may be public
}

fn environment_freshness(reading: Option<&Row>, max_age_h: f64, now_secs: i64) -> Value {
    let observed_at = reading.and_then(|r| text(r, "taken_at"));
    let age_h = observed_at
        .as_deref()
        .and_then(db::parse_ts)
        .map(|ts| ((now_secs - ts).max(0) as f64 / 3600.0 * 10.0).round() / 10.0);
    let status = match age_h {
        Some(age) if age <= max_age_h => "current",
        Some(_) => "stale",
        None => "missing",
    };
    json!({
        "status": status,
        "observed_at": observed_at,
        "age_h": age_h,
        "max_age_h": max_age_h
    })
}

fn environment_layer(readings: &[Row], freshness: &Value) -> Value {
    let specs = [
        ("co2_ppm", "Carbon dioxide", "ppm"),
        ("temperature_c", "Temperature", "°C"),
        ("humidity_pct", "Relative humidity", "%"),
    ];
    let metrics: Vec<Value> = specs
        .into_iter()
        .map(|(id, label, unit)| {
            let samples: Vec<Value> = readings
                .iter()
                .filter_map(|r| {
                    num(r, id).map(|value| {
                        json!({
                            "observed_at": text(r, "taken_at"),
                            "value": value,
                            "source": text(r, "source")
                        })
                    })
                })
                .collect();
            json!({ "id": id, "label": label, "unit": unit, "samples": samples })
        })
        .collect();
    json!({
        "schema_version": 1,
        "id": "environment",
        "label": "Cabin environment",
        "freshness": freshness,
        "metrics": metrics
    })
}

pub async fn environment(
    State(st): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let days = qint(&q, "days", 60, 1, 3650);
    let conn = lock(&st)?;
    let astronaut_id = q.get("astronaut_id").and_then(|v| v.parse::<i64>().ok());
    let mission_id = if let Some(id) = astronaut_id {
        sval(&crate::status::load_astronaut(&conn, id)?, "mission_id")
    } else {
        q.get("mission")
            .cloned()
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| AppError::bad_field("Give a mission or astronaut_id.", "mission"))?
    };
    crate::status::load_mission(&conn, &mission_id)?;
    let reading = first_row(
        &conn,
        "SELECT taken_at, co2_ppm, temperature_c, humidity_pct, source FROM cabin_readings WHERE mission_id=?1 ORDER BY taken_at DESC, id DESC LIMIT 1",
        params![mission_id],
    )?;
    let readings = query_rows(
        &conn,
        "SELECT taken_at, co2_ppm, temperature_c, humidity_pct, source FROM cabin_readings WHERE mission_id=?1 AND taken_at >= ?2 ORDER BY taken_at, id",
        params![mission_id, db::iso_ago(days)],
    )?;
    let p = db::Params::load(&conn)?;
    let freshness = environment_freshness(
        reading.as_ref(),
        p.get("context.environment_fresh_h"),
        chrono::Utc::now().timestamp(),
    );
    let layer = environment_layer(&readings, &freshness);
    Ok(Json(json!({
        "mission_id": mission_id,
        "reading": reading,
        "readings": readings,
        "window": { "days": days },
        "freshness": freshness,
        "layer": layer,
        "note": "Cabin context only. It does not change the health score."
    })))
}

pub async fn config(
    State(st): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let conn = lock(&st)?;
    let p = db::Params::load(&conn)?;
    let missions = query_rows(
        &conn,
        "SELECT * FROM missions ORDER BY display_order, id",
        &[],
    )?;
    let body_regions = query_rows(
        &conn,
        "SELECT * FROM body_regions ORDER BY display_order, id",
        &[],
    )?;
    let mut indicators = query_rows(
        &conn,
        "SELECT * FROM indicators ORDER BY display_order, id",
        &[],
    )?;
    let astronaut = q
        .get("astronaut_id")
        .and_then(|x| x.parse::<i64>().ok())
        .map(|id| crate::status::load_astronaut(&conn, id))
        .transpose()?;
    for ind in indicators.iter_mut() {
        if let Some(a) = &astronaut {
            let day = db::mission_day(&sval(a, "mission_start"), db::today());
            let r = crate::status::effective_range(
                &conn,
                ind,
                &sval(a, "mission_id"),
                day,
                Some(a),
                &p,
            )?;
            for (k, v) in [
                ("normal_low", r.nl),
                ("normal_high", r.nh),
                ("critical_low", r.cl),
                ("critical_high", r.ch),
            ] {
                ind.insert(k.to_string(), json!(v));
            }
        }
        let labels = text(ind, "scale_labels")
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or(Value::Null);
        ind.insert("scale_labels".to_string(), labels);
    }
    let bone_sites = query_rows(
        &conn,
        "SELECT * FROM bone_sites ORDER BY display_order, id",
        &[],
    )?;
    let sources = query_rows(&conn, "SELECT * FROM sources ORDER BY id", &[])?;
    let param_rows = query_rows(
        &conn,
        "SELECT key, value FROM model_params ORDER BY key",
        &[],
    )?;
    let mut pm = Map::new();
    for r in &param_rows {
        pm.insert(
            sval(r, "key"),
            r.get("value").cloned().unwrap_or(Value::Null),
        );
    }
    Ok(Json(json!({
        "missions": missions,
        "body_regions": body_regions,
        "indicators": indicators,
        "bone_sites": bone_sites,
        "sources": sources,
        "params": pm
    })))
}

pub async fn solar_events(
    State(st): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let days = qint(&q, "days", 30, 1, 3650);
    let conn = lock(&st)?;
    let rows = query_rows(
        &conn,
        "SELECT * FROM solar_events WHERE start_time >= ?1 ORDER BY start_time DESC",
        params![db::iso_ago(days)],
    )?;
    Ok(Json(Value::Array(
        rows.into_iter().map(Value::Object).collect(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(at: &str) -> Row {
        let mut row = Row::new();
        row.insert("taken_at".into(), json!(at));
        row
    }

    #[test]
    fn freshness_distinguishes_current_stale_and_missing() {
        let now = db::parse_ts("2026-11-14T12:00:00Z").unwrap();
        assert_eq!(
            environment_freshness(Some(&reading("2026-11-14T00:00:00Z")), 24.0, now)["status"],
            "current"
        );
        assert_eq!(
            environment_freshness(Some(&reading("2026-11-12T00:00:00Z")), 24.0, now)["status"],
            "stale"
        );
        assert_eq!(environment_freshness(None, 24.0, now)["status"], "missing");
    }
}
