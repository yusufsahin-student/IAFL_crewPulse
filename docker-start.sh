#!/bin/sh
# Container start: fresh demo data on every start (so one visitor's test readings do not stay for the next),
# then the latest NASA space weather, then the server. A failed NASA fetch only warns; stored events are used.
set -e
python tools/seed.py --fresh
python ml/score.py --db "$ASTRO_DB" --all
python tools/fetch_donki.py --days 30 || echo "NASA DONKI fetch failed; using stored events."
python tools/fetch_gbm.py --days 30 || echo "Fermi GBM fetch failed; using stored events."
exec crewpulse
