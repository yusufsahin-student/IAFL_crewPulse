//! Gravity context and exposure calculations. Partial-gravity effects remain uncertain in humans;
//! the derived values are transparent model outputs, not clinical risk probabilities.

use std::collections::{BTreeMap, HashMap};

use axum::extract::{Query, State};
use axum::Json;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::db::{self, first_row, lock, num, qint, query_rows, sval, text, AppState, Row};
use crate::errors::AppError;

pub fn current_gravity_g(
    conn: &Connection,
    mission_id: &str,
    fallback: f64,
) -> Result<f64, AppError> {
    let latest = first_row(
        conn,
        "SELECT gravity_g FROM gravity_readings WHERE mission_id=?1 ORDER BY observed_at DESC, id DESC LIMIT 1",
        params![mission_id],
    )?;
    Ok(latest
        .as_ref()
        .and_then(|r| num(r, "gravity_g"))
        .unwrap_or(fallback)
        .clamp(0.0, 2.0))
}

pub fn gravity_by_mission_day(
    conn: &Connection,
    astronaut_id: i64,
) -> Result<BTreeMap<i64, f64>, AppError> {
    let rows = query_rows(
        conn,
        "SELECT CAST(julianday(substr(g.observed_at,1,10)) - julianday(a.mission_start) AS INTEGER) + 1 AS mission_day, g.gravity_g FROM gravity_readings g JOIN astronauts a ON a.mission_id=g.mission_id WHERE a.id=?1 ORDER BY g.observed_at, g.id",
        params![astronaut_id],
    )?;
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            Some((
                crate::db::int(&r, "mission_day")?,
                num(&r, "gravity_g")?.clamp(0.0, 2.0),
            ))
        })
        .collect())
}

fn assessment(readings: &[Row], fallback: f64) -> Value {
    let values: Vec<f64> = readings
        .iter()
        .filter_map(|r| num(r, "gravity_g"))
        .collect();
    let current = values.last().copied().unwrap_or(fallback).clamp(0.0, 2.0);
    let mut daily: BTreeMap<String, (f64, usize)> = BTreeMap::new();
    for reading in readings {
        if let (Some(at), Some(g)) = (text(reading, "observed_at"), num(reading, "gravity_g")) {
            let entry = daily
                .entry(at.chars().take(10).collect())
                .or_insert((0.0, 0));
            entry.0 += g;
            entry.1 += 1;
        }
    }
    let daily_values: Vec<f64> = daily
        .values()
        .map(|(sum, count)| sum / *count as f64)
        .collect();
    let transitions = daily_values
        .windows(2)
        .filter(|pair| (pair[1] - pair[0]).abs() >= 0.05)
        .count();
    let equivalent_days: f64 = daily_values.iter().map(|g| (1.0 - g).clamp(0.0, 1.0)).sum();
    let evidence = if current > 0.0 && current < 1.0 {
        "limited_human_evidence"
    } else {
        "mission_profile"
    };
    let interpretation = if current <= 0.01 {
        "Microgravity"
    } else if current < 0.4 {
        "Partial gravity below 0.4 g; long-term protection is uncertain"
    } else if current < 0.67 {
        "Partial gravity; human long-term evidence is limited"
    } else if current < 0.95 {
        "Reduced gravity"
    } else {
        "Near-Earth gravity"
    };
    let mut analysis_areas = Vec::new();
    if current < 0.67 {
        analysis_areas.extend([
            "bone_loading",
            "muscle_loading",
            "cardiovascular_conditioning",
        ]);
    }
    if transitions > 0 {
        analysis_areas.extend(["balance_coordination", "orthostatic_readiness"]);
    }
    json!({
        "current_g": current,
        "earth_load_pct": (current * 100.0 * 10.0).round() / 10.0,
        "load_deficit_pct": ((1.0 - current).clamp(0.0, 1.0) * 1000.0).round() / 10.0,
        "window_equivalent_microgravity_days": (equivalent_days * 10.0).round() / 10.0,
        "transition_count": transitions,
        "interpretation": interpretation,
        "evidence": evidence,
        "analysis_areas": analysis_areas,
        "calculation": "Equivalent microgravity days = sum of daily max(0, 1 - gravity_g)."
    })
}

pub async fn get_gravity(
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
    let mission = crate::status::load_mission(&conn, &mission_id)?;
    let fallback = num(&mission, "gravity_g").unwrap_or(0.0);
    let readings = query_rows(
        &conn,
        "SELECT observed_at, gravity_g, uncertainty_low_g, uncertainty_high_g, source FROM gravity_readings WHERE mission_id=?1 AND observed_at >= ?2 ORDER BY observed_at, id",
        params![mission_id, db::iso_ago(days)],
    )?;
    let latest = readings.last().cloned();
    let analysis = assessment(&readings, fallback);
    let samples: Vec<Value> = readings
        .iter()
        .filter_map(|r| {
            num(r, "gravity_g").map(|value| json!({
        "observed_at": text(r, "observed_at"), "value": value, "source": text(r, "source")
    }))
        })
        .collect();
    let deficit_samples: Vec<Value> = readings.iter().filter_map(|r| num(r, "gravity_g").map(|g| json!({
        "observed_at": text(r, "observed_at"), "value": ((1.0-g).clamp(0.0,1.0)*1000.0).round()/10.0,
        "source": "derived"
    }))).collect();
    let layer = json!({
        "schema_version": 1, "id": "gravity", "label": "Gravital tracking",
        "freshness": { "status": if latest.is_some() { "current" } else { "missing" }, "observed_at": latest.as_ref().and_then(|r| text(r,"observed_at")) },
        "metrics": [
            { "id": "gravity_g", "label": "Local gravity", "unit": "g", "samples": samples },
            { "id": "load_deficit_pct", "label": "Modeled load deficit", "unit": "%", "samples": deficit_samples }
        ]
    });
    Ok(Json(json!({
        "mission_id": mission_id, "reading": latest, "readings": readings,
        "window": {"days": days}, "assessment": analysis, "layer": layer,
        "note": "Decision-support model, not a clinical probability. Partial-gravity effects in humans remain uncertain."
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(g: f64, day: &str) -> Row {
        let mut r = Row::new();
        r.insert("gravity_g".into(), json!(g));
        r.insert("observed_at".into(), json!(format!("{day}T08:00:00Z")));
        r
    }

    #[test]
    fn assessment_exposes_deficit_transitions_and_uncertainty() {
        let result = assessment(
            &[
                row(0.0, "2026-11-12"),
                row(0.0, "2026-11-13"),
                row(0.38, "2026-11-14"),
            ],
            0.0,
        );
        assert_eq!(result["load_deficit_pct"], 62.0);
        assert_eq!(result["window_equivalent_microgravity_days"], 2.6);
        assert_eq!(result["transition_count"], 1);
        assert_eq!(result["evidence"], "limited_human_evidence");
    }

    #[test]
    fn multiple_samples_on_one_day_do_not_inflate_exposure_days() {
        let mut second = row(0.0, "2026-11-14");
        second.insert("observed_at".into(), json!("2026-11-14T18:00:00Z"));
        let result = assessment(&[row(0.0, "2026-11-14"), second], 0.0);
        assert_eq!(result["window_equivalent_microgravity_days"], 1.0);
    }
}
