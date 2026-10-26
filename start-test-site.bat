@echo off
rem Starts the Junction test site on this computer and shares it through a free
rem Cloudflare Quick Tunnel. Instructions: TEST-SITE.md
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-test-site.ps1"
echo.
pause
