//! Anomaly results per check-in: reads ml_scores, or computes the z-score fallback (contract 4.2).

use std::collections::HashMap;

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::db::{self, first_row, int, num, query_rows, round_to, sval, text, Params, Row};
use crate::errors::AppError;
use crate::status::{baseline_ids, baseline_values, mean};

pub struct Anomaly {
    pub score: f64,
    pub is_anomaly: bool,
    pub method: String,
    pub contributors: Value,
}

impl Anomaly {
    fn insufficient() -> Anomaly {
        Anomaly {
            score: 0.0,
            is_anomaly: false,
            method: "insufficient_history".to_string(),
            contributors: json!([]),
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "anomaly_score": round_to(self.score, 3),
            "is_anomaly": self.is_anomaly,
            "method": self.method,
            "contributors": self.contributors
        })
    }
}

fn from_row(r: &Row) -> Anomaly {
    Anomaly {
        score: num(r, "anomaly_score").unwrap_or(0.0),
        is_anomaly: int(r, "is_anomaly").unwrap_or(0) != 0,
        method: sval(r, "method"),
        contributors: text(r, "contributors")
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or_else(|| json!([])),
    }
}

/// The stored ml_scores row for a check-in, if any.
pub fn stored(conn: &Connection, checkin_id: i64) -> Result<Option<Anomaly>, AppError> {
    let row = first_row(
        conn,
        "SELECT anomaly_score, is_anomaly, method, contributors FROM ml_scores WHERE checkin_id = ?1",
        params![checkin_id],
    )?;
    Ok(row.as_ref().map(from_row))
}

/// Z-score anomaly for one check-in against its previous baseline_n check-ins (contract 4.2).
pub fn zscore(
    conn: &Connection,
    p: &Params,
    astro_id: i64,
    checkin_id: i64,
    taken_at: &str,
    values: &HashMap<String, f64>,
) -> Result<Anomaly, AppError> {
    let n = p.get("ml.baseline_n") as i64;
    let min_history = p.get("ml.min_history") as i64;
    let ids = baseline_ids(conn, astro_id, taken_at, checkin_id, n)?;
    if (ids.len() as i64) < min_history {
        return Ok(Anomaly::insufficient());
    }
    let base = baseline_values(conn, &ids)?;
    let floor = p.get("ml.sd_floor_frac");
    let z_alert = p.get("ml.z_alert");

    let features = query_rows(conn, "SELECT id FROM indicators WHERE ml_feature = 1", &[])?;
    // (indicator id, z, value, baseline mean, baseline sd)
    let mut zs: Vec<(String, f64, f64, f64, f64)> = Vec::new();
    for f in &features {
        let id = sval(f, "id");
        let v = match values.get(&id) {
            Some(v) => *v,
            None => continue,
        };
        let xs = match base.get(&id) {
            Some(xs) if xs.len() >= 3 => xs,
            _ => continue,
        };
        let m = mean(xs);
        let var = xs.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / xs.len() as f64;
        let sd = var.sqrt().max(floor * m.abs()).max(1e-6);
        zs.push((id, (v - m) / sd, v, m, sd));
    }

    if zs.is_empty() {
        return Ok(Anomaly::insufficient());
    }
    let max_abs = zs.iter().fold(0.0_f64, |acc, z| acc.max(z.1.abs()));
    let score = if 2.0 * z_alert > 0.0 {
        (max_abs / (2.0 * z_alert)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    zs.sort_by(|a, b| {
        b.1.abs()
            .partial_cmp(&a.1.abs())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let contributors: Vec<Value> = zs
        .iter()
        .filter(|z| z.1.abs() >= 1.0)
        .take(3)
        .map(|z| {
            json!({
                "indicator_id": z.0,
                "z": round_to(z.1, 3),
                "value": round_to(z.2, 3),
                "baseline_mean": round_to(z.3, 3),
                "baseline_sd": round_to(z.4, 3)
            })
        })
        .collect();

    Ok(Anomaly {
        score,
        is_anomaly: score > 0.5,
        method: "zscore_fallback".to_string(),
        contributors: Value::Array(contributors),
    })
}

/// Writes one ml_scores row (replaces an existing one for the same check-in).
pub fn save(
    conn: &Connection,
    checkin_id: i64,
    a: &Anomaly,
    model_version: Option<&str>,
) -> Result<(), AppError> {
    let flag: i64 = if a.is_anomaly { 1 } else { 0 };
    let contributors = a.contributors.to_string();
    let scored_at = db::now_iso();
    conn.execute(
        "INSERT OR REPLACE INTO ml_scores (checkin_id, anomaly_score, is_anomaly, method, model_version, contributors, scored_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![checkin_id, a.score, flag, a.method, model_version, contributors, scored_at],
    )?;
    Ok(())
}
