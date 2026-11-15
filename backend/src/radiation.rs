//! Radiation estimate from the simplified zone model (contract 4.4) and the /api/radiation endpoint.

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::Json;
use chrono::{NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::db::{
    self, day_start_secs, int, lock, num, parse_ts, query_rows, round_to, sval, text, AppState,
    Params, Row,
};
use crate::errors::AppError;
use crate::status::{load_astronaut, load_mission};

/// One dose-relevant solar event with its window in Unix seconds.
struct Win {
    row: Row,
    start: i64,
    end: i64,
    sev: f64,
}

/// Per-zone numbers used by the daily dose sum.
struct ZoneRate {
    id: String,
    background: f64,
    sep_factor: f64,
    default_hours: f64,
}

pub struct Rad {
    /// Zone rows plus background_msv_per_day and event_msv_per_h.
    pub zones: Vec<Row>,
    pub active: Option<Row>,
    pub recommended: Option<String>,
    pub mission_dose: f64,
    pub today: f64,
    pub limit: f64,
    pub pct: f64,
    /// Last 30 days of the mission, oldest first: (day, msv).
    pub daily: Vec<(String, f64)>,
}

/// Computes zone rates, the active event and the mission dose. `who` is (astronaut id, mission start);
/// without it no doses are computed.
pub fn compute(
    conn: &Connection,
    p: &Params,
    mission: &Row,
    who: Option<(i64, String)>,
) -> Result<Rad, AppError> {
    let mission_id = sval(mission, "id");
    let gcr = num(mission, "gcr_msv_per_day").unwrap_or(0.0);
    let sep_mission = num(mission, "sep_exposure_factor").unwrap_or(1.0);
    let ref_shield = p.get("rad.ref_shield_g_cm2");
    let gcr_atten = p.get("rad.gcr_atten_g_cm2");
    let sep_peak = p.get("rad.sep_peak_msv_per_h");
    let sep_atten = p.get("rad.sep_atten_g_cm2");
    let dur_s = p.get("rad.sep_default_duration_h") * 3600.0;
    let limit = p.get("rad.career_limit_msv");

    let now = Utc::now();
    let now_s = now.timestamp();
    let today = now.date_naive();

    let zone_rows = query_rows(
        conn,
        "SELECT * FROM habitat_zones WHERE mission_id = ?1 ORDER BY display_order, id",
        params![mission_id],
    )?;

    let from = match &who {
        Some((_, start)) => format!("{}T00:00:00Z", start),
        None => db::iso_ago(30),
    };
    let ev_rows = query_rows(
        conn,
        "SELECT * FROM solar_events WHERE dose_relevant = 1 AND (end_time >= ?1 OR start_time >= ?1) ORDER BY start_time",
        params![from],
    )?;
    let mut wins: Vec<Win> = Vec::new();
    for e in ev_rows {
        let start = match text(&e, "start_time").and_then(|s| parse_ts(&s)) {
            Some(s) => s,
            None => continue,
        };
        let end = match text(&e, "end_time").and_then(|s| parse_ts(&s)) {
            Some(t) => t,
            None => start + dur_s as i64,
        };
        let sev = num(&e, "severity").unwrap_or(0.0);
        wins.push(Win {
            row: e,
            start,
            end,
            sev,
        });
    }

    // Active event: window contains now; if several, the most recently started one.
    let active_idx = wins
        .iter()
        .enumerate()
        .filter(|(_, w)| w.start <= now_s && now_s <= w.end)
        .max_by_key(|(_, w)| w.start)
        .map(|(i, _)| i);
    let active_sev = active_idx.map(|i| wins[i].sev).unwrap_or(0.0);
    let active_row: Option<Row> = active_idx.map(|i| wins[i].row.clone());

    let mut zones: Vec<Row> = Vec::new();
    let mut zrates: Vec<ZoneRate> = Vec::new();
    for z in zone_rows {
        let shield = num(&z, "shielding_g_cm2").unwrap_or(0.0);
        let background = gcr * (-(shield - ref_shield) / gcr_atten).exp();
        let sep_factor = sep_peak * sep_mission * (-shield / sep_atten).exp();
        let event_rate = if active_idx.is_some() {
            sep_factor * active_sev
        } else {
            0.0
        };
        let mut z2 = z.clone();
        z2.insert(
            "background_msv_per_day".to_string(),
            json!(round_to(background, 3)),
        );
        z2.insert(
            "event_msv_per_h".to_string(),
            json!(round_to(event_rate, 3)),
        );
        zrates.push(ZoneRate {
            id: sval(&z, "id"),
            background,
            sep_factor,
            default_hours: num(&z, "default_hours").unwrap_or(0.0),
        });
        zones.push(z2);
    }

    let recommended = best_zone(&zones, true).or_else(|| best_zone(&zones, false));

    let mut total = 0.0;
    let mut today_msv = 0.0;
    let mut daily: Vec<(String, f64)> = Vec::new();
    if let Some((aid, start)) = &who {
        let mut log: HashMap<String, HashMap<String, f64>> = HashMap::new();
        let rows = query_rows(
            conn,
            "SELECT day, zone_id, hours FROM exposure_log WHERE astronaut_id = ?1 AND day >= ?2",
            params![*aid, start],
        )?;
        for r in rows {
            let day = sval(&r, "day");
            let zone = sval(&r, "zone_id");
            let h = num(&r, "hours").unwrap_or(0.0);
            log.entry(day).or_default().insert(zone, h);
        }

        if let Ok(mstart) = NaiveDate::parse_from_str(start, "%Y-%m-%d") {
            let window_start = today - chrono::Duration::days(29);
            let mut d = mstart;
            let mut guard: u32 = 0;
            while d <= today && guard < 200_000 {
                let v = day_dose(d, &zrates, &wins, &log);
                total += v;
                if d >= window_start {
                    daily.push((d.to_string(), round_to(v, 2)));
                }
                if d == today {
                    today_msv = v;
                }
                d += chrono::Duration::days(1);
                guard += 1;
            }
        }
    }

    let pct = if limit > 0.0 {
        100.0 * total / limit
    } else {
        0.0
    };

    Ok(Rad {
        zones,
        active: active_row,
        recommended,
        mission_dose: total,
        today: today_msv,
        limit,
        pct,
        daily,
    })
}

fn best_zone(zones: &[Row], shelter_only: bool) -> Option<String> {
    let mut best: Option<(f64, String)> = None;
    for z in zones {
        if shelter_only && int(z, "is_shelter").unwrap_or(0) != 1 {
            continue;
        }
        let sh = num(z, "shielding_g_cm2").unwrap_or(0.0);
        let better = match &best {
            Some((b, _)) => sh > *b,
            None => true,
        };
        if better {
            best = Some((sh, sval(z, "id")));
        }
    }
    best.map(|(_, id)| id)
}

/// Dose for one astronaut on one day: background from hours in each zone, plus event dose from overlap.
fn day_dose(
    day: NaiveDate,
    zones: &[ZoneRate],
    wins: &[Win],
    log: &HashMap<String, HashMap<String, f64>>,
) -> f64 {
    let ds = match day_start_secs(day) {
        Some(s) => s,
        None => return 0.0,
    };
    let de = (ds + 86_400).min(Utc::now().timestamp());
    let elapsed = ((de - ds).max(0) as f64 / 86_400.0).min(1.0);
    let key = day.to_string();
    let mut dose = 0.0;
    for z in zones {
        let h = match log.get(&key) {
            Some(m) => m.get(&z.id).copied().unwrap_or(0.0),
            None => z.default_hours,
        };
        dose += (h / 24.0) * z.background * elapsed;
        for w in wins {
            let overlap_s = (w.end.min(de) - w.start.max(ds)).max(0);
            let overlap_h = overlap_s as f64 / 3600.0;
            if overlap_h > 0.0 {
                dose += (h / 24.0) * overlap_h * z.sep_factor * w.sev;
            }
        }
    }
    dose
}

pub async fn get_radiation(
    State(st): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let conn = lock(&st)?;
    let astro_id = q
        .get("astronaut_id")
        .and_then(|s| s.trim().parse::<i64>().ok());
    let mission_q = q
        .get("mission")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let astro = match astro_id {
        Some(id) => Some(load_astronaut(&conn, id)?),
        None => None,
    };
    let mission_id = match (&mission_q, &astro) {
        (Some(m), _) => m.clone(),
        (None, Some(a)) => sval(a, "mission_id"),
        (None, None) => {
            return Err(AppError::bad_field(
                "Give a mission or an astronaut_id.",
                "mission",
            ))
        }
    };
    let mission = load_mission(&conn, &mission_id)?;
    // Personal dose only for the astronaut's own mission: their zone hours belong to that habitat,
    // so mixing them with another mission's zones gives a wrong number.
    let astro = astro.filter(|a| sval(a, "mission_id") == mission_id);
    let who = astro
        .as_ref()
        .map(|a| (int(a, "id").unwrap_or(0), sval(a, "mission_start")));
    let p = Params::load(&conn)?;
    let rad = compute(&conn, &p, &mission, who)?;

    let events = query_rows(
        &conn,
        "SELECT * FROM solar_events WHERE start_time >= ?1 ORDER BY start_time DESC",
        params![db::iso_ago(30)],
    )?;

    let astronaut_json = if astro.is_some() {
        let daily: Vec<Value> = rad
            .daily
            .iter()
            .map(|(d, v)| json!({ "day": d, "msv": v }))
            .collect();
        json!({
            "mission_dose_msv": round_to(rad.mission_dose, 2),
            "today_msv": round_to(rad.today, 2),
            "limit_msv": rad.limit,
            "pct_of_limit": round_to(rad.pct, 1),
            "daily": daily
        })
    } else {
        Value::Null
    };

    Ok(Json(json!({
        "mission_id": mission_id,
        "zones": rad.zones,
        "active_event": rad.active,
        "events": events,
        "astronaut": astronaut_json,
        "recommended_zone_id": rad.recommended,
        "note": "Estimate from a simplified shielding model."
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integrates_event_overlapping_midnight() {
        let day = NaiveDate::from_ymd_opt(2020, 1, 2).unwrap();
        let start = day_start_secs(day).unwrap();
        let zones = vec![ZoneRate {
            id: "test".into(),
            background: 1.0,
            sep_factor: 2.0,
            default_hours: 24.0,
        }];
        let wins = vec![Win {
            row: Row::new(),
            start: start - 3600,
            end: start + 3600,
            sev: 0.5,
        }];
        assert!((day_dose(day, &zones, &wins, &HashMap::new()) - 2.0).abs() < 1e-9);
    }
}
