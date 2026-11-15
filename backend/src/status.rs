//! Status object (contract 5.1) and the shared pieces it is built from: ranges, readings, baselines,
//! the health score, triage and body regions. Also GET /api/astronauts and GET /api/astronauts/{id}/status.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::Datelike;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::anomaly::{self, Anomaly};
use crate::bone;
use crate::db::{
    self, first_row, fmt_num, int, lock, num, query_rows, round_to, sval, text, AppState, Params,
    Row,
};
use crate::errors::AppError;
use crate::radiation;

/// Effective normal and critical bounds of one indicator for one astronaut today.
pub struct Range {
    pub nl: Option<f64>,
    pub nh: Option<f64>,
    pub cl: Option<f64>,
    pub ch: Option<f64>,
    pub adjusted: bool,
    pub note: Option<String>,
}

/// Status of one reading, the bound that triggered it, and its direction.
pub struct Eval {
    pub status: &'static str,
    pub direction: Option<&'static str>,
    pub limit: Option<f64>,
    pub limit_kind: &'static str,
}

/// One indicator with the latest check-in value and its evaluation.
pub struct Reading {
    pub id: String,
    pub name: String,
    pub unit: String,
    pub decimals: i64,
    pub region: String,
    pub weight: f64,
    pub value: Option<f64>,
    pub range: Range,
    pub eval: Eval,
    pub baseline_mean: Option<f64>,
}

impl Eval {
    fn new(
        status: &'static str,
        direction: Option<&'static str>,
        limit: Option<f64>,
        limit_kind: &'static str,
    ) -> Eval {
        Eval {
            status,
            direction,
            limit,
            limit_kind,
        }
    }

    fn missing() -> Eval {
        Eval::new("missing", None, None, "")
    }
}

pub fn mean(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        0.0
    } else {
        xs.iter().sum::<f64>() / xs.len() as f64
    }
}

pub fn parse_astronaut_id(raw: &str) -> Result<i64, AppError> {
    raw.parse::<i64>()
        .map_err(|_| AppError::bad_field("Astronaut id must be an integer.", "astronaut_id"))
}

pub fn load_astronaut(conn: &Connection, id: i64) -> Result<Row, AppError> {
    match first_row(conn, "SELECT * FROM astronauts WHERE id = ?1", params![id])? {
        Some(r) => Ok(r),
        None => Err(AppError::not_found("Unknown astronaut.")),
    }
}

pub fn load_mission(conn: &Connection, id: &str) -> Result<Row, AppError> {
    match first_row(conn, "SELECT * FROM missions WHERE id = ?1", params![id])? {
        Some(r) => Ok(r),
        None => Err(AppError::not_found("Unknown mission.")),
    }
}

pub fn load_indicators(conn: &Connection) -> Result<Vec<Row>, AppError> {
    query_rows(
        conn,
        "SELECT * FROM indicators ORDER BY display_order, id",
        &[],
    )
}

pub fn latest_checkin(conn: &Connection, astro_id: i64) -> Result<Option<Row>, AppError> {
    first_row(
        conn,
        "SELECT id, taken_at, mission_day FROM checkins WHERE astronaut_id = ?1 ORDER BY taken_at DESC, id DESC LIMIT 1",
        params![astro_id],
    )
}

/// Indicator values of one check-in.
pub fn checkin_values(
    conn: &Connection,
    checkin_id: i64,
) -> Result<HashMap<String, f64>, AppError> {
    let rows = query_rows(
        conn,
        "SELECT indicator_id, value FROM readings WHERE checkin_id = ?1",
        params![checkin_id],
    )?;
    let mut m = HashMap::new();
    for r in &rows {
        if let (Some(k), Some(v)) = (text(r, "indicator_id"), num(r, "value")) {
            m.insert(k, v);
        }
    }
    Ok(m)
}

/// Ids of the up to n check-ins of this astronaut taken before the given one, newest first.
pub fn baseline_ids(
    conn: &Connection,
    astro_id: i64,
    taken_at: &str,
    checkin_id: i64,
    n: i64,
) -> Result<Vec<i64>, AppError> {
    let rows = query_rows(
        conn,
        "SELECT id FROM checkins WHERE astronaut_id = ?1 AND (taken_at < ?2 OR (taken_at = ?2 AND id < ?3)) ORDER BY taken_at DESC, id DESC LIMIT ?4",
        params![astro_id, taken_at, checkin_id, n],
    )?;
    Ok(rows.iter().filter_map(|r| int(r, "id")).collect())
}

/// Values per indicator over the given check-ins.
pub fn baseline_values(
    conn: &Connection,
    ids: &[i64],
) -> Result<HashMap<String, Vec<f64>>, AppError> {
    let mut m: HashMap<String, Vec<f64>> = HashMap::new();
    for id in ids {
        for (k, v) in checkin_values(conn, *id)? {
            m.entry(k).or_default().push(v);
        }
    }
    Ok(m)
}

pub fn current_utc_year() -> i32 {
    db::today().year()
}

/// Personalized lower normal bound for kcal_intake (NASA-STD-3001 EER) and grip_strength (EWGSOP2 sex cut-offs).
pub fn personal_normal_low(
    ind: &Row,
    astro: Option<&Row>,
    p: &Params,
    current_year: i32,
) -> Option<f64> {
    let id = sval(ind, "id");
    let fallback = num(ind, "normal_low");
    let Some(a) = astro else {
        return fallback;
    };
    let sex = text(a, "sex").unwrap_or_default();
    if id == "kcal_intake" {
        let (Some(by), Some(h_cm), Some(m_kg)) = (
            int(a, "birth_year"),
            num(a, "height_cm"),
            num(a, "preflight_mass_kg"),
        ) else {
            return fallback;
        };
        if by <= 1900 || by >= current_year as i64 || h_cm <= 0.0 || m_kg <= 0.0 {
            return fallback;
        }
        let age = (current_year as i64 - by) as f64;
        let h_m = h_cm / 100.0;
        let act = p.get("kcal.activity_factor");
        let eer = match sex.as_str() {
            "M" => {
                p.get("kcal.eer_m_const") - p.get("kcal.eer_m_age") * age
                    + act * (p.get("kcal.eer_m_mass") * m_kg + p.get("kcal.eer_m_height") * h_m)
            }
            "F" => {
                p.get("kcal.eer_f_const") - p.get("kcal.eer_f_age") * age
                    + act * (p.get("kcal.eer_f_mass") * m_kg + p.get("kcal.eer_f_height") * h_m)
            }
            _ => return fallback,
        };
        return Some((eer / 10.0).round() * 10.0);
    }
    if id == "grip_strength" {
        return match sex.as_str() {
            "M" => Some(p.get("grip.normal_low_m")),
            "F" => Some(p.get("grip.normal_low_f")),
            _ => fallback,
        };
    }
    fallback
}

/// Effective range (contract section 3): one adjustment row, matching mission first, then latest day_from.
pub fn effective_range(
    conn: &Connection,
    ind: &Row,
    mission_id: &str,
    mission_day: i64,
    astro: Option<&Row>,
    p: &Params,
) -> Result<Range, AppError> {
    let mut r = Range {
        nl: personal_normal_low(ind, astro, p, current_utc_year()),
        nh: num(ind, "normal_high"),
        cl: num(ind, "critical_low"),
        ch: num(ind, "critical_high"),
        adjusted: false,
        note: None,
    };
    let id = sval(ind, "id");
    let adj = first_row(
        conn,
        "SELECT * FROM indicator_adjustments WHERE indicator_id = ?1 AND (mission_id = ?2 OR mission_id IS NULL) AND day_from <= ?3 AND (day_to IS NULL OR day_to >= ?3) ORDER BY CASE WHEN mission_id = ?2 THEN 0 ELSE 1 END, day_from DESC, id DESC LIMIT 1",
        params![id, mission_id, mission_day],
    )?;
    if let Some(a) = adj {
        if let Some(v) = num(&a, "normal_low") {
            r.nl = Some(v);
        }
        if let Some(v) = num(&a, "normal_high") {
            r.nh = Some(v);
        }
        if let Some(v) = num(&a, "critical_low") {
            r.cl = Some(v);
        }
        if let Some(v) = num(&a, "critical_high") {
            r.ch = Some(v);
        }
        r.adjusted = true;
        r.note = text(&a, "note");
    }
    Ok(r)
}

/// Reading status (contract section 3): critical bounds first, then normal bounds.
pub fn classify(v: f64, r: &Range) -> Eval {
    if let Some(c) = r.cl {
        if v < c {
            return Eval::new("alert", Some("low"), Some(c), "critical");
        }
    }
    if let Some(c) = r.ch {
        if v > c {
            return Eval::new("alert", Some("high"), Some(c), "critical");
        }
    }
    if let Some(n) = r.nl {
        if v < n {
            return Eval::new("watch", Some("low"), Some(n), "watch");
        }
    }
    if let Some(n) = r.nh {
        if v > n {
            return Eval::new("watch", Some("high"), Some(n), "watch");
        }
    }
    Eval::new("normal", None, None, "")
}

/// Evaluates every indicator against the values of one check-in.
pub fn evaluate(
    conn: &Connection,
    mission_id: &str,
    mission_day: i64,
    inds: &[Row],
    values: &HashMap<String, f64>,
    astro: Option<&Row>,
    p: &Params,
) -> Result<Vec<Reading>, AppError> {
    let mut out = Vec::new();
    for ind in inds {
        let id = sval(ind, "id");
        let range = effective_range(conn, ind, mission_id, mission_day, astro, p)?;
        let value = values.get(&id).copied();
        let eval = match value {
            Some(v) => classify(v, &range),
            None => Eval::missing(),
        };
        out.push(Reading {
            id,
            name: sval(ind, "name"),
            unit: sval(ind, "unit"),
            decimals: int(ind, "decimals").unwrap_or(0),
            region: sval(ind, "body_region_id"),
            weight: num(ind, "weight").unwrap_or(1.0),
            value,
            range,
            eval,
            baseline_mean: None,
        });
    }
    Ok(out)
}

fn points_for(status: &str, p: &Params) -> f64 {
    match status {
        "normal" => p.get("score.normal_points"),
        "watch" => p.get("score.watch_points"),
        "alert" => p.get("score.alert_points"),
        _ => 0.0,
    }
}

/// Weighted mean of reading points (contract 4.1 vitals). None when there are no values.
pub fn vitals_of(readings: &[Reading], p: &Params) -> Option<f64> {
    let mut any = false;
    let mut wsum = 0.0;
    let mut ssum = 0.0;
    for r in readings {
        if r.value.is_some() {
            any = true;
            wsum += r.weight;
            ssum += r.weight * points_for(r.eval.status, p);
        }
    }
    if !any {
        None
    } else if wsum > 0.0 {
        Some(ssum / wsum)
    } else {
        Some(100.0)
    }
}

fn split_lines(s: &str) -> Vec<String> {
    s.split('\n')
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

fn with_unit(v: &str, unit: &str) -> String {
    if unit.is_empty() {
        v.to_string()
    } else {
        format!("{} {}", v, unit)
    }
}

fn reading_sentence(r: &Reading) -> String {
    let v = r.value.unwrap_or(0.0);
    let lim = r.eval.limit.unwrap_or(0.0);
    let dir = if r.eval.direction == Some("low") {
        "below"
    } else {
        "above"
    };
    // User-facing words follow the caution/warning terms (CONTRACT section 10), not the internal status ids.
    let kind = if r.eval.limit_kind == "critical" {
        "safe"
    } else {
        "usual"
    };
    format!(
        "{} {} is {} the {} limit ({}).",
        r.name,
        with_unit(&fmt_num(v, r.decimals), &r.unit),
        dir,
        kind,
        fmt_num(lim, r.decimals)
    )
}

fn rank(s: &str) -> u8 {
    match s {
        "alert" => 3,
        "watch" => 2,
        "normal" => 1,
        _ => 0,
    }
}

/// Worst status of a list; missing entries are ignored; all missing gives "missing".
fn worst_status(statuses: &[&str]) -> String {
    let mut best: &str = "missing";
    for &s in statuses {
        if rank(s) > rank(best) {
            best = s;
        }
    }
    best.to_string()
}

fn find_guidance(
    conn: &Connection,
    indicator: &str,
    direction: &str,
    severity: &str,
) -> Result<Option<Row>, AppError> {
    first_row(
        conn,
        "SELECT * FROM guidance WHERE indicator_id = ?1 AND (direction = ?2 OR direction = 'any') AND severity = ?3 ORDER BY CASE WHEN direction = ?2 THEN 0 ELSE 1 END, id LIMIT 1",
        params![indicator, direction, severity],
    )
}

/// Builds the full status object for one astronaut (contract 5.1).
/// `mission_override` changes only the `mission` and `triage` parts (the distance what-if).
pub fn build_status(
    conn: &Connection,
    astro_id: i64,
    mission_override: Option<&str>,
) -> Result<Value, AppError> {
    build_status_for(conn, astro_id, mission_override, None)
}

/// Same as `build_status`, but describes the given check-in instead of the latest one, so a
/// POST /api/checkins answer always matches its own `checkin_id`, even when two saves race.
pub fn build_status_for(
    conn: &Connection,
    astro_id: i64,
    mission_override: Option<&str>,
    checkin_id: Option<i64>,
) -> Result<Value, AppError> {
    let p = Params::load(conn)?;
    let astro = load_astronaut(conn, astro_id)?;
    let mission_id = sval(&astro, "mission_id");
    let start = sval(&astro, "mission_start");
    let mday = db::mission_day(&start, db::today());
    let mission = load_mission(conn, &mission_id)?;
    let tri_mission = match mission_override {
        Some(m) => load_mission(conn, m)?,
        None => mission.clone(),
    };

    let inds = load_indicators(conn)?;
    let checkin = match checkin_id {
        Some(id) => first_row(
            conn,
            "SELECT id, taken_at, mission_day FROM checkins WHERE id = ?1 AND astronaut_id = ?2",
            params![id, astro_id],
        )?,
        None => latest_checkin(conn, astro_id)?,
    };
    let (cid, taken) = match &checkin {
        Some(c) => (int(c, "id").unwrap_or(0), sval(c, "taken_at")),
        None => (0, String::new()),
    };
    let values = match &checkin {
        Some(_) => checkin_values(conn, cid)?,
        None => HashMap::new(),
    };
    let reading_day = checkin
        .as_ref()
        .and_then(|c| int(c, "mission_day"))
        .unwrap_or(mday);
    let mut readings = evaluate(
        conn,
        &mission_id,
        reading_day,
        &inds,
        &values,
        Some(&astro),
        &p,
    )?;
    let age_hours =
        db::parse_ts(&taken).map(|t| (chrono::Utc::now().timestamp() - t).max(0) as f64 / 3600.0);
    let fresh = age_hours
        .map(|h| h <= p.get("routine.checkin_interval_h").max(1.0))
        .unwrap_or(false);

    let mut anomaly: Option<Anomaly> = None;
    if checkin.is_some() {
        let ids = baseline_ids(conn, astro_id, &taken, cid, p.get("ml.baseline_n") as i64)?;
        let base = baseline_values(conn, &ids)?;
        for r in readings.iter_mut() {
            if let Some(xs) = base.get(&r.id) {
                if xs.len() >= 3 {
                    r.baseline_mean = Some(mean(xs));
                }
            }
        }
        anomaly = Some(match anomaly::stored(conn, cid)? {
            Some(a) => a,
            None => anomaly::zscore(conn, &p, astro_id, cid, &taken, &values)?,
        });
    }
    let checkin_json = match &checkin {
        Some(c) => json!({ "id": cid, "taken_at": taken, "mission_day": int(c, "mission_day") }),
        None => Value::Null,
    };

    let bone = bone::compute(
        conn,
        &p,
        astro_id,
        mday,
        crate::gravity::current_gravity_g(
            conn,
            &mission_id,
            num(&mission, "gravity_g").unwrap_or(0.0),
        )?,
        0,
    )?;
    let rad = radiation::compute(conn, &p, &mission, Some((astro_id, start.clone())))?;

    let worst = bone.worst();
    let bone_loss = worst.map(|s| s.loss).unwrap_or(0.0);
    let bone_status: &str = worst.map(|s| s.status).unwrap_or("normal");
    let bone_not_normal = bone.sites.iter().any(|s| s.status != "normal");

    // Score (contract 4.1).
    let any_alert = readings.iter().any(|r| r.eval.status == "alert");
    let n_alert = readings.iter().filter(|r| r.eval.status == "alert").count();
    let any_watch = readings.iter().any(|r| r.eval.status == "watch");
    let vit = vitals_of(&readings, &p);
    let anomaly_part: Option<f64> = anomaly
        .as_ref()
        .filter(|a| a.method != "insufficient_history")
        .map(|a| 100.0 * (1.0 - a.score));
    let bone_part = (100.0 - bone_loss * p.get("score.bone_penalty_per_pct")).clamp(0.0, 100.0);
    let storm = if rad.active.is_some() {
        p.get("score.storm_penalty")
    } else {
        0.0
    };
    let rad_part = ((100.0 - rad.pct).clamp(0.0, 100.0) - storm).clamp(0.0, 100.0);
    let value: Option<i64> = vit.filter(|_| fresh).map(|v| {
        let weight = p.get("score.w_vitals")
            + p.get("score.w_bone")
            + p.get("score.w_radiation")
            + if anomaly_part.is_some() {
                p.get("score.w_anomaly")
            } else {
                0.0
            };
        let total = (v * p.get("score.w_vitals")
            + anomaly_part.unwrap_or(0.0) * p.get("score.w_anomaly")
            + bone_part * p.get("score.w_bone")
            + rad_part * p.get("score.w_radiation"))
            / weight.max(0.001);
        let capped = if any_alert { total.min(49.0) } else { total };
        capped.clamp(0.0, 100.0).round() as i64
    });
    let band: Option<&str> = value.map(|v| {
        if v >= 75 {
            "good"
        } else if v >= 50 {
            "watch"
        } else {
            "alert"
        }
    });

    // Reasons, most severe first, max 5.
    let is_anomaly = anomaly.as_ref().map(|a| a.is_anomaly).unwrap_or(false);
    let mut anomaly_reasons: Vec<String> = Vec::new();
    if let Some(a) = &anomaly {
        if a.is_anomaly {
            anomaly_reasons.push("Today's check-in is unusual for you.".to_string());
            if let Some(top) = a.contributors.as_array().and_then(|arr| arr.first()) {
                let id = top["indicator_id"].as_str().unwrap_or("").to_string();
                if let (Some(v), Some(m)) = (top["value"].as_f64(), top["baseline_mean"].as_f64()) {
                    if m != 0.0 {
                        let pct = 100.0 * (v - m) / m.abs();
                        let name = readings
                            .iter()
                            .find(|r| r.id == id)
                            .map(|r| r.name.clone())
                            .unwrap_or_else(|| id.clone());
                        let word = if pct >= 0.0 { "above" } else { "below" };
                        anomaly_reasons.push(format!(
                            "{} is {}% {} your usual level.",
                            name,
                            fmt_num(pct.abs(), 0),
                            word
                        ));
                    }
                }
            }
        }
    }
    let mut rad_reasons: Vec<String> = Vec::new();
    if rad.active.is_some() {
        let zone_name = match &rad.recommended {
            Some(zid) => rad
                .zones
                .iter()
                .find(|z| sval(z, "id") == *zid)
                .map(|z| sval(z, "name"))
                .unwrap_or_default(),
            None => String::new(),
        };
        if zone_name.is_empty() {
            rad_reasons.push("Solar particle event in progress: take shelter now.".to_string());
        } else {
            rad_reasons.push(format!(
                "Solar particle event in progress: move to {}.",
                zone_name
            ));
        }
    }
    let mut bone_reasons: Vec<String> = Vec::new();
    for s in bone.sites.iter().filter(|s| s.status != "normal") {
        bone_reasons.push(format!(
            "Projected bone loss at the {} is {}%.",
            s.name,
            fmt_num(s.loss, 1)
        ));
    }
    let mut reasons: Vec<String> = Vec::new();
    for r in readings.iter().filter(|r| r.eval.status == "alert") {
        reasons.push(reading_sentence(r));
    }
    reasons.extend(rad_reasons);
    for r in readings.iter().filter(|r| r.eval.status == "watch") {
        reasons.push(reading_sentence(r));
    }
    reasons.extend(anomaly_reasons);
    reasons.extend(bone_reasons);
    if checkin.is_none() {
        reasons.insert(
            0,
            "No check-in yet. Do a check-in to see your score.".to_string(),
        );
    }
    if !fresh && checkin.is_some() {
        reasons.insert(0, "Current assessment unavailable: take a new check-in. Earlier readings are last known values.".to_string());
    }
    reasons.truncate(5);

    // Triage (contract 4.5).
    let value_low = value.map(|v| v < 50).unwrap_or(false);
    let level: i64 = if n_alert >= 2 {
        3
    } else if n_alert >= 1 || value_low || rad.active.is_some() {
        2
    } else if any_watch || is_anomaly || bone_not_normal || !fresh {
        1
    } else {
        0
    };
    let consult = sval(&tri_mission, "consult_mode");
    let delay_s = num(&tri_mission, "comms_delay_s").unwrap_or(0.0);
    let reply = round_to(2.0 * delay_s / 60.0, 1);
    let delay_text = if delay_s >= 60.0 {
        format!("{} min", (delay_s / 60.0).round() as i64)
    } else {
        format!("{:.1} s", delay_s)
    };
    let mission_name = sval(&tri_mission, "name");
    let action = first_row(
        conn,
        "SELECT * FROM triage_actions WHERE level = ?1 AND consult_mode = ?2",
        params![level, consult],
    )?;
    let fill = |s: String| -> String {
        s.replace("{mission}", &mission_name)
            .replace("{delay}", &delay_text)
            .replace("{reply_minutes}", &reply.to_string())
    };
    let (mut headline, contact, mut instructions) = match &action {
        Some(a) => (
            fill(sval(a, "headline")),
            fill(sval(a, "contact")),
            split_lines(&fill(sval(a, "instructions"))),
        ),
        None => (String::new(), String::new(), Vec::new()),
    };
    // An old critical reading keeps its level (it was never cleared), but the crew must see that
    // it is old and re-measure before acting on it.
    if !fresh && n_alert >= 1 {
        let hours = age_hours.map(|h| fmt_num(h, 0)).unwrap_or_else(|| "?".to_string());
        headline = format!("Last reading ({} h ago) was critical: re-measure now. {}", hours, headline);
        instructions.insert(
            0,
            format!("Re-measure now: the last reading is {} hours old. If it is still outside the safe limit, follow the steps below.", hours),
        );
    }

    // Guidance for each out-of-range reading, alerts first.
    let mut flagged: Vec<&Reading> = readings
        .iter()
        .filter(|r| r.eval.status == "alert" || r.eval.status == "watch")
        .collect();
    flagged.sort_by_key(|r| if r.eval.status == "alert" { 0 } else { 1 });
    let mut guidance: Vec<Value> = Vec::new();
    for r in flagged {
        let dir = r.eval.direction.unwrap_or("any");
        let want = if r.eval.status == "alert" {
            "alert"
        } else {
            "watch"
        };
        let mut g = find_guidance(conn, &r.id, dir, want)?;
        if g.is_none() && r.eval.status == "alert" {
            g = find_guidance(conn, &r.id, dir, "watch")?;
        }
        if let Some(g) = g {
            let protocol: Option<Vec<String>> = if consult == "crew_led" || consult == "shared" {
                text(&g, "protocol").map(|t| split_lines(&t))
            } else {
                None
            };
            guidance.push(json!({
                "indicator_id": r.id,
                "severity": sval(&g, "severity"),
                "direction": r.eval.direction,
                "summary": sval(&g, "summary"),
                "self_care": split_lines(&sval(&g, "self_care")),
                "protocol": protocol
            }));
        }
    }

    // Body regions: worst status of their indicators and bone sites.
    let region_rows = query_rows(
        conn,
        "SELECT * FROM body_regions ORDER BY display_order, id",
        &[],
    )?;
    let mut regions: Vec<Value> = Vec::new();
    for reg in &region_rows {
        let rid = sval(reg, "id");
        let mut statuses: Vec<&str> = Vec::new();
        let mut ids: Vec<String> = Vec::new();
        for r in readings.iter().filter(|r| r.region == rid) {
            ids.push(r.id.clone());
            statuses.push(r.eval.status);
        }
        for s in bone.sites.iter().filter(|s| s.region == rid) {
            statuses.push(s.status);
        }
        regions.push(json!({
            "body_region_id": rid,
            "name": sval(reg, "name"),
            "status": worst_status(&statuses),
            "indicator_ids": ids
        }));
    }

    let indicators: Vec<Value> = readings
        .iter()
        .map(|r| {
            let delta = match (r.value, r.baseline_mean) {
                (Some(v), Some(m)) if m != 0.0 => Some(round_to(100.0 * (v - m) / m.abs(), 1)),
                _ => None,
            };
            json!({
                "indicator_id": r.id,
                "name": r.name,
                "unit": r.unit,
                "decimals": r.decimals,
                "body_region_id": r.region,
                "value": r.value,
                "status": r.eval.status,
                "direction": r.eval.direction,
                "range": {
                    "normal_low": r.range.nl,
                    "normal_high": r.range.nh,
                    "critical_low": r.range.cl,
                    "critical_high": r.range.ch,
                    "adjusted": r.range.adjusted,
                    "note": r.range.note
                },
                "baseline_mean": r.baseline_mean.map(|m| round_to(m, 2)),
                "delta_pct": delta
            })
        })
        .collect();

    Ok(json!({
        "astronaut": {
            "id": astro_id,
            "name": sval(&astro, "name"),
            "role": text(&astro, "role"),
            "sex": text(&astro, "sex"),
            "birth_year": int(&astro, "birth_year"),
            "height_cm": num(&astro, "height_cm"),
            "preflight_mass_kg": num(&astro, "preflight_mass_kg"),
            "mission_id": mission_id,
            "mission_start": start,
            "mission_day": mday,
            "avatar_color": text(&astro, "avatar_color")
        },
        "mission": Value::Object(tri_mission.clone()),
        "checkin": checkin_json,
        "freshness": {"state": if fresh { "current" } else { "stale" }, "age_hours": age_hours},
        "score": {
            "value": value,
            "band": band,
            "parts": {
                "vitals": vit.map(|v| round_to(v, 1)),
                "anomaly": anomaly_part.map(|v| round_to(v, 1)),
                "bone": round_to(bone_part, 1),
                "radiation": round_to(rad_part, 1)
            },
            "reasons": reasons
        },
        "indicators": indicators,
        "regions": regions,
        "anomaly": anomaly.as_ref().map(|a| a.to_json()).unwrap_or(Value::Null),
        "bone": {
            "worst_site_id": worst.map(|s| s.id.clone()),
            "worst_loss_pct": round_to(bone_loss, 1),
            "status": bone_status
        },
        "radiation": {
            "mission_dose_msv": round_to(rad.mission_dose, 2),
            "today_msv": round_to(rad.today, 2),
            "pct_of_limit": round_to(rad.pct, 1),
            "active_event": rad.active,
            "recommended_zone_id": rad.recommended
        },
        "triage": {
            "level": level,
            "consult_mode": consult,
            "comms_delay_s": delay_s,
            "reply_minutes": reply,
            "headline": headline,
            "contact": contact,
            "instructions": instructions,
            "guidance": guidance
        }
    }))
}

pub async fn list_astronauts(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    let conn = lock(&st)?;
    let rows = query_rows(&conn, "SELECT * FROM astronauts ORDER BY id", &[])?;
    let today = db::today();
    let mut out: Vec<Value> = Vec::new();
    for a in &rows {
        let id = int(a, "id").unwrap_or(0);
        let status = build_status(&conn, id, None)?;
        let start = sval(a, "mission_start");
        out.push(json!({
            "id": id,
            "name": sval(a, "name"),
            "role": text(a, "role"),
            "sex": text(a, "sex"),
            "birth_year": int(a, "birth_year"),
            "height_cm": num(a, "height_cm"),
            "preflight_mass_kg": num(a, "preflight_mass_kg"),
            "mission_id": sval(a, "mission_id"),
            "mission_start": start,
            "mission_day": db::mission_day(&start, today),
            "avatar_color": text(a, "avatar_color"),
            "latest_score": status["score"]["value"],
            "latest_band": status["score"]["band"]
        }));
    }
    Ok(Json(Value::Array(out)))
}

pub async fn get_status(
    State(st): State<AppState>,
    Path(raw_id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let id = parse_astronaut_id(&raw_id)?;
    let mission = q
        .get("mission")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let conn = lock(&st)?;
    let v = build_status(&conn, id, mission.as_deref())?;
    Ok(Json(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pairs: &[(&str, Value)]) -> Row {
        let mut m = Row::new();
        for (k, v) in pairs {
            m.insert((*k).to_string(), v.clone());
        }
        m
    }

    #[test]
    fn critical_reading_names_the_safe_limit() {
        let range = Range {
            nl: Some(50.0),
            nh: Some(100.0),
            cl: Some(40.0),
            ch: Some(130.0),
            adjusted: false,
            note: None,
        };
        let reading = Reading {
            id: "heart_rate".into(),
            name: "Heart rate".into(),
            unit: "bpm".into(),
            decimals: 0,
            region: "heart".into(),
            weight: 1.0,
            value: Some(140.0),
            eval: classify(140.0, &range),
            range,
            baseline_mean: None,
        };
        assert_eq!(
            reading_sentence(&reading),
            "Heart rate 140 bpm is above the safe limit (130)."
        );
    }

    #[test]
    fn invalid_astronaut_id_is_a_json_app_error() {
        assert!(parse_astronaut_id("abc").is_err());
    }

    #[test]
    fn personalized_kcal_and_grip_bounds() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../db/schema.sql"))
            .unwrap();
        let p = Params::load(&conn).unwrap();
        let year = 2026;
        let kcal_ind = row(&[("id", json!("kcal_intake")), ("normal_low", json!(2300.0))]);
        let grip_ind = row(&[("id", json!("grip_strength")), ("normal_low", json!(16.0))]);

        // Female, 40y, 60 kg, 165 cm (1.65 m) -> 2280 kcal, 16 kg
        let female = row(&[
            ("sex", json!("F")),
            ("birth_year", json!(year - 40)),
            ("height_cm", json!(165.0)),
            ("preflight_mass_kg", json!(60.0)),
        ]);
        assert_eq!(
            personal_normal_low(&kcal_ind, Some(&female), &p, year),
            Some(2280.0)
        );
        assert_eq!(
            personal_normal_low(&grip_ind, Some(&female), &p, year),
            Some(16.0)
        );

        // Male, 40y, 70 kg, 175 cm (1.75 m) -> 2810 kcal, 27 kg
        let male = row(&[
            ("sex", json!("M")),
            ("birth_year", json!(year - 40)),
            ("height_cm", json!(175.0)),
            ("preflight_mass_kg", json!(70.0)),
        ]);
        assert_eq!(
            personal_normal_low(&kcal_ind, Some(&male), &p, year),
            Some(2810.0)
        );
        assert_eq!(
            personal_normal_low(&grip_ind, Some(&male), &p, year),
            Some(27.0)
        );

        // Missing or invalid inputs -> fallback 2300 kcal, 16 kg
        let unknown_sex = row(&[
            ("sex", json!("X")),
            ("birth_year", json!(year - 40)),
            ("height_cm", json!(175.0)),
            ("preflight_mass_kg", json!(70.0)),
        ]);
        let missing_height = row(&[
            ("sex", json!("M")),
            ("birth_year", json!(year - 40)),
            ("preflight_mass_kg", json!(70.0)),
        ]);
        assert_eq!(personal_normal_low(&kcal_ind, None, &p, year), Some(2300.0));
        assert_eq!(personal_normal_low(&grip_ind, None, &p, year), Some(16.0));
        assert_eq!(
            personal_normal_low(&kcal_ind, Some(&unknown_sex), &p, year),
            Some(2300.0)
        );
        assert_eq!(
            personal_normal_low(&grip_ind, Some(&unknown_sex), &p, year),
            Some(16.0)
        );
        assert_eq!(
            personal_normal_low(&kcal_ind, Some(&missing_height), &p, year),
            Some(2300.0)
        );
        assert_eq!(
            personal_normal_low(&grip_ind, Some(&missing_height), &p, year),
            Some(27.0)
        );
    }
}
