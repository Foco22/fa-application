@echo off
REM Launcher for Paper Learning (runs from source, picks up code changes on next launch)
cd /d "%~dp0"
call node_modules\.bin\electron.cmd .
