@echo off
rem Double-click to start the Astronaut Health Monitor, then open the address it prints.
rem Optional switches: start-app.bat -Offline (skip NASA data refresh)  -Fresh (rebuild the database)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-app.ps1" %*
pause
