//! Astronaut health monitor backend: JSON API under /api and the frontend as static files.
#![recursion_limit = "256"]

mod anomaly;
mod bone;
mod checkin;
mod db;
mod errors;
mod gravity;
mod history;
mod radiation;
mod reference;
mod status;

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, OnceLock};

use axum::extract::Request;
use axum::http::{header::HOST, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::db::AppState;

fn env_or(key: &str, default: &str) -> String {
    match std::env::var(key) {
        Ok(v) if !v.trim().is_empty() => v,
        _ => default.to_string(),
    }
}

/// Public host names allowed besides loopback, from ASTRO_PUBLIC_HOST (comma-separated)
/// or, on Render, the RENDER_EXTERNAL_HOSTNAME it sets. Empty means localhost only.
static PUBLIC_HOSTS: OnceLock<Vec<String>> = OnceLock::new();

fn public_hosts_from_env() -> Vec<String> {
    let raw = env_or(
        "ASTRO_PUBLIC_HOST",
        &std::env::var("RENDER_EXTERNAL_HOSTNAME").unwrap_or_default(),
    );
    raw.split(',')
        .map(|h| h.trim().to_ascii_lowercase())
        .filter(|h| !h.is_empty())
        .collect()
}

fn host_name(host: &str) -> String {
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    name.to_ascii_lowercase()
}

fn host_allowed(host: &str, public: &[String]) -> bool {
    let name = host_name(host);
    matches!(name.as_str(), "127.0.0.1" | "localhost" | "::1") || public.iter().any(|p| *p == name)
}

async fn protect_local_request(req: Request, next: Next) -> Response {
    let public = PUBLIC_HOSTS.get_or_init(public_hosts_from_env);
    let valid = req
        .headers()
        .get(HOST)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|h| host_allowed(h, public));
    if !valid {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Unknown host. Set ASTRO_PUBLIC_HOST to the public host name." })),
        )
            .into_response();
    }
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert("cache-control", HeaderValue::from_static("no-cache"));
    headers.insert("content-security-policy", HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("geolocation=(), microphone=(), camera=(self)"),
    );
    response
}

#[tokio::main]
async fn main() {
    let db_path = env_or("ASTRO_DB", "db/astro.db");
    // Hosting platforms such as Render pass the port in PORT.
    let port_text = env_or("ASTRO_PORT", &env_or("PORT", "8080"));
    let host_text = env_or("ASTRO_HOST", "127.0.0.1");
    let frontend = env_or("ASTRO_FRONTEND", "frontend");
    let python = env_or("ASTRO_PYTHON", "python");
    let bind_ip: IpAddr = match host_text.parse() {
        Ok(ip) => ip,
        Err(_) => {
            eprintln!("ASTRO_HOST must be an IP address such as 127.0.0.1 or 0.0.0.0, not {}.", host_text);
            std::process::exit(1);
        }
    };

    if !std::path::Path::new(&db_path).is_file() {
        eprintln!(
            "Database not found at {}. Run: python tools/seed.py",
            db_path
        );
        std::process::exit(1);
    }
    let port: u16 = match port_text.parse::<u16>() {
        Ok(p) => p,
        Err(_) => {
            eprintln!(
                "ASTRO_PORT must be a number from 1 to 65535, not {}.",
                port_text
            );
            std::process::exit(1);
        }
    };
    let conn = match db::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Could not open the database at {}: {}", db_path, e);
            std::process::exit(1);
        }
    };

    let model: String = if std::path::Path::new("ml/model/meta.json").is_file() {
        "tf_autoencoder".to_string()
    } else {
        "zscore_fallback".to_string()
    };

    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        db_path: db_path.clone(),
        model,
        python,
    };

    let app = Router::new()
        .route("/api/health", get(reference::health))
        .route("/api/config", get(reference::config))
        .route("/api/environment", get(reference::environment))
        .route("/api/gravity", get(gravity::get_gravity))
        .route("/api/solar-events", get(reference::solar_events))
        .route("/api/astronauts", get(status::list_astronauts))
        .route("/api/astronauts/:id/status", get(status::get_status))
        .route("/api/astronauts/:id/history", get(history::get_history))
        .route("/api/astronauts/:id/bone", get(bone::get_bone))
        .route("/api/checkins", post(checkin::post_checkin))
        .route("/api/radiation", get(radiation::get_radiation))
        .fallback_service(ServeDir::new(&frontend).append_index_html_on_directories(true))
        .layer(CorsLayer::new())
        .layer(middleware::from_fn(protect_local_request))
        .with_state(state);

    let addr = SocketAddr::new(bind_ip, port);
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Could not listen on {}: {}", addr, e);
            std::process::exit(1);
        }
    };
    let public = PUBLIC_HOSTS.get_or_init(public_hosts_from_env);
    println!("CrewPulse running at http://{} (public hosts: {:?})", addr, public);
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Server stopped: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::host_allowed;

    #[test]
    fn host_filter_accepts_loopback_only() {
        assert!(host_allowed("127.0.0.1:8080", &[]));
        assert!(host_allowed("localhost:8080", &[]));
        assert!(host_allowed("[::1]:8080", &[]));
        assert!(!host_allowed("attacker.invalid", &[]));
    }

    #[test]
    fn host_filter_accepts_configured_public_host() {
        let public = vec!["crewpulse.onrender.com".to_string()];
        assert!(host_allowed("CrewPulse.onrender.com", &public));
        assert!(host_allowed("crewpulse.onrender.com:443", &public));
        assert!(!host_allowed("evil.onrender.com", &public));
        assert!(host_allowed("localhost:8080", &public));
    }
}
