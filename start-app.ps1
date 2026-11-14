# Starts the Astronaut Health Monitor. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File .\start-app.ps1 [-Offline] [-Fresh]
# -Offline  skip the live NASA data refresh (DONKI solar particle events, Fermi GBM flares)
# -Fresh    rebuild the database from data/seed before starting
# Then open the address it prints. Press Ctrl+C to stop.
param([switch]$Offline, [switch]$Fresh)

# Continue: PowerShell 5.1 turns any native stderr line into an error under 'Stop'; every step checks $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot   # the database and frontend paths are relative to this folder

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

# --- Python as a full path (the backend runs it via ASTRO_PYTHON): project venv, then py 3.12-3.10, then PATH
$python = Join-Path $env:USERPROFILE '.venvs\astro-health\Scripts\python.exe'
if (-not (Test-Path $python)) {
    $python = $null
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in '3.12', '3.11', '3.10') {
            $exe = & py "-$v" -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe) { $python = $exe.Trim(); break }
        }
    }
    if (-not $python -and (Get-Command python -ErrorAction SilentlyContinue)) { $python = (Get-Command python).Source }
    if (-not $python) { Write-Host "Python 3.10-3.12 not found. Install it, then run this again."; exit 1 }
}
Write-Host "Python: $python"

# --- Database
if ($Fresh -or -not (Test-Path 'db\astro.db')) {
    Step "Building the database from data/seed"
    & $python tools\seed.py --fresh
    if ($LASTEXITCODE -ne 0) { Write-Host "Seeding failed."; exit 1 }
    & $python -c "import tensorflow" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Step "Training the anomaly model (TensorFlow)"
        & $python ml\train.py
    } else {
        Step "TensorFlow not installed: scoring check-ins with the z-score fallback"
        & $python ml\score.py --db db\astro.db --all
    }
}

# --- Live NASA data (a failure only warns; the app uses the stored events)
if (-not $Offline) {
    Step "Refreshing NASA space weather (use -Offline to skip)"
    if (-not $env:NASA_API_KEY) {
        Write-Host "NASA_API_KEY is not set; DONKI will use the rate-limited DEMO_KEY." -ForegroundColor Yellow
    }
    & $python tools\fetch_donki.py --days 30
    if ($LASTEXITCODE -ne 0) { Write-Host "DONKI refresh skipped; using stored events." -ForegroundColor Yellow }
    & $python tools\fetch_gbm.py --days 30
    if ($LASTEXITCODE -ne 0) { Write-Host "GBM flare refresh skipped; using stored events." -ForegroundColor Yellow }
}

# --- Backend: prebuilt exe, else build with cargo, else the mock preview
$backend = Join-Path $env:USERPROFILE '.cargo-targets\astro-health\release\astro-health-backend.exe'
$local = 'backend\target\release\astro-health-backend.exe'
if (-not (Test-Path $backend)) {
    if (Test-Path $local) { $backend = $local }
    elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
        Step "Building the Rust backend (first run takes a few minutes)"
        & cargo build --manifest-path backend\Cargo.toml --release
        if ($LASTEXITCODE -ne 0) { Write-Host "Backend build failed."; exit 1 }
        $backend = $local
    } else { $backend = $null }
}

$env:ASTRO_PYTHON = $python
if ($backend) {
    Step "Open http://127.0.0.1:8080  (Ctrl+C to stop)"
    & $backend
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "`nRust (cargo) is not installed, so the real backend cannot run." -ForegroundColor Yellow
    Write-Host "Starting the frontend preview with MOCK data instead. Install Rust from https://rustup.rs for live data."
    Step "Open http://127.0.0.1:5173  (Ctrl+C to stop)"
    & node tools\dev-server.mjs
} else {
    Write-Host "Neither Rust (cargo) nor Node.js is installed. Install Rust from https://rustup.rs and run this again."
    exit 1
}
