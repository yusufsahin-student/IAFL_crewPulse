# Backend (Rust)

Axum server for the astronaut health monitor. Run it from the repository root after seeding the database.

Build and run (stable Rust):

    python tools/seed.py
    cargo run --manifest-path backend/Cargo.toml --release

Environment variables (all optional):

- `ASTRO_DB`: SQLite file, default `db/astro.db`
- `ASTRO_HOST`: IP address to listen on, default `127.0.0.1` (the container uses `0.0.0.0`)
- `ASTRO_PORT` (or `PORT`): port, default `8080`
- `ASTRO_PUBLIC_HOST`: public host name(s), comma-separated; on Render read from `RENDER_EXTERNAL_HOSTNAME`. Other host names are refused.
- `ASTRO_FRONTEND`: folder served at `/`, default `frontend`
- `ASTRO_PYTHON`: interpreter for `ml/score.py`, default `python` (20 s timeout per check-in)

Endpoints (JSON, UTF-8): `GET /api/health`, `GET /api/config`, `GET /api/environment`, `GET /api/astronauts`,
`GET /api/astronauts/{id}/status?mission=`, `POST /api/checkins`, `GET /api/astronauts/{id}/history?days=`,
`GET /api/astronauts/{id}/bone?days_ahead=`, `GET /api/radiation?astronaut_id=&mission=`, `GET /api/solar-events?days=`.
Shapes and formulas: `docs/CONTRACT.md` (sections 3, 4 and 5).

Check-in validation errors return 400 with `{"error","field"}`; `field` is the indicator id for reading errors.
Unknown astronaut returns 404.
