//! Bone loss projection (contract 4.3). A projection from published rates, not a measurement.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::Json;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::db::{self, lock, num, qint, query_rows, round_to, sval, text, AppState, Params};
use crate::errors::AppError;
use crate::status::{load_astronaut, load_mission};

/// The indicator whose check-in values give the average daily exercise minutes.
pub const EXERCISE_INDICATOR: &str = "exercise_minutes";

pub struct Site {
    pub id: String,
    pub name: String,
    pub region: String,
    pub rate: f64,
    pub baseline: Option<f64>,
    pub current: Option<f64>,
    pub loss: f64,
    pub status: &'static str,
    pub projected: Vec<Value>,
}

pub struct BoneCalc {
    pub mission_day: i64,
    pub months: f64,
    pub gravity_factor: f64,
    pub exercise_avg: f64,
    pub exercise_factor: f64,
    pub sites: Vec<Site>,
}

impl BoneCalc {
    /// The site with the largest projected loss today.
    pub fn worst(&self) -> Option<&Site> {
        self.sites.iter().max_by(|a, b| {
            a.loss
                .partial_cmp(&b.loss)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    }

    pub fn to_json(&self) -> Value {
        let sites: Vec<Value> = self
            .sites
            .iter()
            .map(|s| {
                json!({
                    "bone_site_id": s.id,
                    "name": s.name,
                    "body_region_id": s.region,
                    "loss_pct_per_month": s.rate,
                    "baseline_bmd": s.baseline.map(|b| round_to(b, 3)),
                    "current_bmd": s.current.map(|b| round_to(b, 3)),
                    "loss_pct": round_to(s.loss, 1),
                    "status": s.status,
                    "projected": s.projected
                })
            })
            .collect();
        json!({
            "mission_day": self.mission_day,
            "months": round_to(self.months, 3),
            "gravity_factor": round_to(self.gravity_factor, 3),
            "exercise_avg_min": round_to(self.exercise_avg, 1),
            "exercise_factor": round_to(self.exercise_factor, 3),
            "note": "Projection from published loss rates, not a scan.",
            "sites": sites
        })
    }
}

/// Bone loss per site today and projected every 7 mission days up to mission_day + days_ahead.
pub fn compute(
    conn: &Connection,
    p: &Params,
    astro_id: i64,
    mission_day: i64,
    gravity_g: f64,
    days_ahead: i64,
) -> Result<BoneCalc, AppError> {
    let md = mission_day.max(1);
    let months = (md - 1) as f64 / 30.44;
    let gravity_factor = (1.0 - gravity_g).clamp(0.0, 1.0);
    let daily_gravity = crate::gravity::gravity_by_mission_day(conn, astro_id)?;
    let first_gravity = daily_gravity.values().next().copied().unwrap_or(gravity_g);
    let gravity_on = |day: i64| {
        daily_gravity
            .range(..=day)
            .next_back()
            .map(|(_, value)| *value)
            .unwrap_or(first_gravity)
    };

    let window = (p.get("bone.exercise_window_days") as i64).clamp(0, 3650);
    let ex = query_rows(
        conn,
        "SELECT AVG(r.value) AS avg_value FROM readings r JOIN checkins c ON c.id = r.checkin_id WHERE c.astronaut_id = ?1 AND r.indicator_id = ?2 AND c.taken_at >= ?3",
        params![astro_id, EXERCISE_INDICATOR, db::iso_ago(window)],
    )?;
    let exercise_avg = ex.first().and_then(|r| num(r, "avg_value")).unwrap_or(0.0);
    let target = p.get("bone.exercise_target_min");
    let fraction = if target > 0.0 {
        (exercise_avg / target).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let exercise_factor = 1.0 - p.get("bone.exercise_max_reduction") * fraction;

    // Integrate each recorded day's exercise once; recent exercise never rewrites earlier loss.
    let exercise_days = query_rows(conn, "SELECT c.mission_day, AVG(r.value) AS minutes FROM checkins c JOIN readings r ON r.checkin_id=c.id WHERE c.astronaut_id=?1 AND r.indicator_id=?2 GROUP BY c.mission_day", params![astro_id, EXERCISE_INDICATOR])?;
    let daily_ex: HashMap<i64, f64> = exercise_days
        .iter()
        .filter_map(|r| Some((crate::db::int(r, "mission_day")?, num(r, "minutes")?)))
        .collect();
    let accumulated = |day: i64| -> f64 {
        (1..day)
            .map(|d| {
                let minutes = if d < md {
                    daily_ex.get(&d).copied().unwrap_or(0.0)
                } else {
                    exercise_avg
                };
                let fraction = if target > 0.0 {
                    (minutes / target).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let unloading = (1.0 - gravity_on(d)).clamp(0.0, 1.0);
                unloading * (1.0 - p.get("bone.exercise_max_reduction") * fraction).max(0.0) / 30.44
            })
            .sum()
    };
    let base_rows = query_rows(
        conn,
        "SELECT bone_site_id, bmd_g_cm2 FROM bone_baselines WHERE astronaut_id = ?1",
        params![astro_id],
    )?;
    let mut base: HashMap<String, f64> = HashMap::new();
    for b in &base_rows {
        if let (Some(k), Some(v)) = (text(b, "bone_site_id"), num(b, "bmd_g_cm2")) {
            base.insert(k, v);
        }
    }

    let site_rows = query_rows(
        conn,
        "SELECT * FROM bone_sites ORDER BY display_order, id",
        &[],
    )?;
    let alert_pct = p.get("bone.alert_pct");
    let watch_pct = p.get("bone.watch_pct");
    let end = md + days_ahead.clamp(0, 3650);

    let mut sites = Vec::new();
    for s in &site_rows {
        let id = sval(s, "id");
        let rate = num(s, "loss_pct_per_month").unwrap_or(0.0);
        let baseline = base.get(&id).copied();
        let loss = (rate * accumulated(md)).min(100.0);
        let status: &'static str = if loss >= alert_pct {
            "alert"
        } else if loss >= watch_pct {
            "watch"
        } else {
            "normal"
        };

        let mut projected = Vec::new();
        let mut d: i64 = 1;
        while d <= end {
            let l = (rate * accumulated(d)).min(100.0);
            projected.push(json!({
                "mission_day": d,
                "bmd": baseline.map(|b| round_to(b * (1.0 - l / 100.0), 3)),
                "loss_pct": round_to(l, 1)
            }));
            d += 7;
        }

        sites.push(Site {
            name: sval(s, "name"),
            region: sval(s, "body_region_id"),
            rate,
            baseline,
            current: baseline.map(|b| b * (1.0 - loss / 100.0)),
            loss,
            status,
            projected,
            id,
        });
    }

    Ok(BoneCalc {
        mission_day,
        months,
        gravity_factor,
        exercise_avg,
        exercise_factor,
        sites,
    })
}

pub async fn get_bone(
    State(st): State<AppState>,
    Path(raw_id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let id = crate::status::parse_astronaut_id(&raw_id)?;
    let days_ahead = qint(&q, "days_ahead", 180, 0, 3650);
    let conn = lock(&st)?;
    let astro = load_astronaut(&conn, id)?;
    let mission = load_mission(&conn, &sval(&astro, "mission_id"))?;
    let mission_id = sval(&mission, "id");
    let p = Params::load(&conn)?;
    let mday = db::mission_day(&sval(&astro, "mission_start"), db::today());
    let calc = compute(
        &conn,
        &p,
        id,
        mday,
        crate::gravity::current_gravity_g(
            &conn,
            &mission_id,
            num(&mission, "gravity_g").unwrap_or(0.0),
        )?,
        days_ahead,
    )?;
    Ok(Json(calc.to_json()))
}
