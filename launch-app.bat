@echo off
REM Launcher for Ra (runs from source, picks up code changes on next launch)
cd /d "%~dp0"

REM better-sqlite3 es nativo y solo puede estar compilado para UN runtime a la vez:
REM `npm test` lo deja en el ABI de Node y Electron ya no puede cargarlo (la app moria
REM en silencio al abrir desde el acceso directo). En vez de recompilar siempre —tarda
REM 1-2 min— se le pregunta al propio Electron si puede cargarlo, y solo si no, se
REM recompila. Ojo: un `require()` no sirve como chequeo, el .node se carga recien al
REM instanciar la base (ver scripts/check-native-abi.js).
set ELECTRON_RUN_AS_NODE=1
call node_modules\.bin\electron.cmd scripts\check-native-abi.js >nul 2>&1
set ABI_OK=%errorlevel%
set ELECTRON_RUN_AS_NODE=

if not "%ABI_OK%"=="0" (
  REM Un electron.exe colgado de un arranque fallido mantiene el .node abierto y el
  REM rebuild muere con "permiso denegado". Se cierran los de ESTE proyecto primero.
  powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '%~dp0node_modules*' } | Stop-Process -Force" >nul 2>&1

  REM Ventana visible a proposito: un launcher mudo durante 2 minutos es
  REM indistinguible de una app rota, que es justo el problema que se arregla aca.
  start "Ra - preparando" /wait cmd /c "echo Recompilando better-sqlite3 para Electron (1-2 min, solo esta vez)... && node_modules\.bin\electron-rebuild.cmd -f -w better-sqlite3 || pause"
)

call node_modules\.bin\electron.cmd . 2>> "%~dp0launch-error.log"
if not "%errorlevel%"=="0" exit /b %errorlevel%
