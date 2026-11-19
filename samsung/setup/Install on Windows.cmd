@echo off
rem couch-tv for Samsung: double-click this on Windows. It runs install-windows.ps1 from this folder.
rem Read "START HERE.txt" first: Developer mode has to be on on the TV.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
if errorlevel 1 pause
