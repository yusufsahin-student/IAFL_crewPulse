//! Health, config and solar-event endpoints.

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::Json;
use rusqlite::params;
use serde_json::{json, Map, Value};

use crate::db::{self, first_row, lock, qint, query_rows, sval, text, AppState};
use crate::errors::AppError;

pub async fn health(State(st): State<AppState>) -> Json<Value> {
    Json(json!({ "ok": true, "model": st.model }))
}

pub async fn environment(
    State(st): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let conn = lock(&st)?;
    let astronaut_id = q.get("astronaut_id").and_then(|v| v.parse::<i64>().ok());
    let mission_id = if let Some(id) = astronaut_id {
        sval(&crate::status::load_astronaut(&conn, id)?, "mission_id")
    } else {
        q.get("mission").cloned().filter(|v| !v.trim().is_empty())
            .ok_or_else(|| AppError::bad_field("Give a mission or astronaut_id.", "mission"))?
    };
    crate::status::load_mission(&conn, &mission_id)?;
    let reading = first_row(
        &conn,
        "SELECT taken_at, co2_ppm, temperature_c, humidity_pct, source FROM cabin_readings WHERE mission_id=?1 ORDER BY taken_at DESC, id DESC LIMIT 1",
        params![mission_id],
    )?;
    Ok(Json(json!({
        "mission_id": mission_id,
        "reading": reading,
        "note": "Cabin context only. It does not change the health score."
    })))
}

pub async fn config(State(st): State<AppState>, Query(q): Query<HashMap<String, String>>) -> Result<Json<Value>, AppError> {
    let conn = lock(&st)?;
    let p = db::Params::load(&conn)?;
    let missions = query_rows(&conn, "SELECT * FROM missions ORDER BY display_order, id", &[])?;
    let body_regions = query_rows(&conn, "SELECT * FROM body_regions ORDER BY display_order, id", &[])?;
    let mut indicators = query_rows(&conn, "SELECT * FROM indicators ORDER BY display_order, id", &[])?;
    let astronaut = q.get("astronaut_id").and_then(|x| x.parse::<i64>().ok()).map(|id| crate::status::load_astronaut(&conn, id)).transpose()?;
    for ind in indicators.iter_mut() {
        if let Some(a) = &astronaut {
            let day = db::mission_day(&sval(a, "mission_start"), db::today());
            let r = crate::status::effective_range(&conn, ind, &sval(a, "mission_id"), day, Some(a), &p)?;
            for (k,v) in [("normal_low",r.nl),("normal_high",r.nh),("critical_low",r.cl),("critical_high",r.ch)] { ind.insert(k.to_string(), json!(v)); }
        }
        let labels = text(ind, "scale_labels")
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or(Value::Null);
        ind.insert("scale_labels".to_string(), labels);
    }
    let bone_sites = query_rows(&conn, "SELECT * FROM bone_sites ORDER BY display_order, id", &[])?;
    let sources = query_rows(&conn, "SELECT * FROM sources ORDER BY id", &[])?;
    let param_rows = query_rows(&conn, "SELECT key, value FROM model_params ORDER BY key", &[])?;
    let mut pm = Map::new();
    for r in &param_rows {
        pm.insert(sval(r, "key"), r.get("value").cloned().unwrap_or(Value::Null));
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
    Ok(Json(Value::Array(rows.into_iter().map(Value::Object).collect())))
}
