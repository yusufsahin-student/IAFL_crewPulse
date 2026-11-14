//! GET /api/astronauts/{id}/history: one point per check-in, oldest first.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::Json;
use rusqlite::params;
use serde_json::{json, Map, Value};

use crate::anomaly;
use crate::db::{self, int, lock, qint, query_rows, round_to, sval, AppState, Params};
use crate::errors::AppError;
use crate::status::{
    checkin_values, evaluate, load_astronaut, load_indicators, parse_astronaut_id, vitals_of,
};

pub async fn get_history(
    State(st): State<AppState>,
    Path(raw_id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let id = parse_astronaut_id(&raw_id)?;
    let days = qint(&q, "days", 60, 1, 3650);
    let conn = lock(&st)?;
    let astro = load_astronaut(&conn, id)?;
    let mission_id = sval(&astro, "mission_id");
    let p = Params::load(&conn)?;
    let inds = load_indicators(&conn)?;
    let ind_ids: Vec<String> = inds.iter().map(|r| sval(r, "id")).collect();

    let rows = query_rows(
        &conn,
        "SELECT id, taken_at, mission_day FROM checkins WHERE astronaut_id = ?1 AND taken_at >= ?2 ORDER BY taken_at, id",
        params![id, db::iso_ago(days)],
    )?;

    let mut points: Vec<Value> = Vec::new();
    for c in &rows {
        let cid = int(c, "id").unwrap_or(0);
        let mday = int(c, "mission_day").unwrap_or(1);
        let values = checkin_values(&conn, cid)?;
        // Vitals only, using the effective ranges of the day the check-in was taken.
        let readings = evaluate(&conn, &mission_id, mday, &inds, &values, Some(&astro), &p)?;
        let score = vitals_of(&readings, &p).map(|v| v.round() as i64);
        let (anomaly_score, is_anomaly) = anomaly::stored(&conn, cid)?
            .map(|a| (a.score, a.is_anomaly))
            .unwrap_or((0.0, false));
        let vals: Map<String, Value> = values.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
        points.push(json!({
            "checkin_id": cid,
            "taken_at": sval(c, "taken_at"),
            "mission_day": mday,
            "values": vals,
            "anomaly_score": round_to(anomaly_score, 3),
            "is_anomaly": is_anomaly,
            "score": score
        }));
    }

    Ok(Json(json!({ "indicators": ind_ids, "points": points })))
}
