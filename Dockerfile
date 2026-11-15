# CrewPulse: Rust API + static frontend, with Python tools for seeding, scoring and NASA data.
# Build: docker build -t crewpulse .   Run: docker run -p 8080:8080 -e NASA_API_KEY=... crewpulse

FROM rust:1-bookworm AS build
WORKDIR /src
COPY backend/Cargo.toml backend/Cargo.lock backend/
COPY backend/src backend/src
COPY db/schema.sql db/schema.sql
RUN cargo build --release --manifest-path backend/Cargo.toml

FROM python:3.12-slim
WORKDIR /app
COPY --from=build /src/backend/target/release/astro-health-backend /usr/local/bin/crewpulse
COPY frontend frontend
COPY data data
COPY db/schema.sql db/schema.sql
COPY ml ml
COPY tools tools
COPY docker-start.sh docker-start.sh
# The scorer runs without TensorFlow (z-score fallback); TensorFlow does not fit a small free instance.
ENV ASTRO_HOST=0.0.0.0 \
    ASTRO_DB=/app/db/astro.db \
    ASTRO_PYTHON=python \
    PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["sh", "docker-start.sh"]
