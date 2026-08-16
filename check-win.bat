@echo off
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object Id,MainWindowTitle | Out-File -Encoding utf8 C:\Users\Administrator\sightflow-desktop-agent\win-check.txt"
