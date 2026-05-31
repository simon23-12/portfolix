@echo off
REM Portfolix starten – stellt sicher, dass Electron NICHT im Node-Modus laeuft
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
echo Starte Portfolix...
call npm start
if errorlevel 1 (
  echo.
  echo Fehler beim Start. Sind die Abhaengigkeiten installiert? Dann bitte einmal:  npm install
  pause
)
