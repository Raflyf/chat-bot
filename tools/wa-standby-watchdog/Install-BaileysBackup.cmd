@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-BaileysBackup.ps1" %*
echo.
pause
