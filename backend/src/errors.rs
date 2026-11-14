//! Error type for every handler. Responses look like {"error": "...", "field": "..."}.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub struct AppError {
    status: StatusCode,
    message: String,
    field: Option<String>,
}

impl AppError {
    pub fn bad(message: impl Into<String>) -> Self {
        AppError {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
            field: None,
        }
    }

    pub fn bad_field(message: impl Into<String>, field: &str) -> Self {
        AppError {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
            field: Some(field.to_string()),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        AppError {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
            field: None,
        }
    }

    pub fn unsupported_media(message: impl Into<String>) -> Self {
        AppError {
            status: StatusCode::UNSUPPORTED_MEDIA_TYPE,
            message: message.into(),
            field: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        AppError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
            field: None,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = match &self.field {
            Some(f) => json!({ "error": self.message, "field": f }),
            None => json!({ "error": self.message }),
        };
        (self.status, Json(body)).into_response()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        // The detail goes to the server log only; the client gets a plain sentence.
        eprintln!("database error: {}", e);
        AppError::internal("The database could not be read or written. See the server log.")
    }
}
