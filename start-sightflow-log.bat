@echo off
cd /d C:\Users\Administrator\sightflow-desktop-agent
echo [%date% %time%] starting > C:\Users\Administrator\sightflow-desktop-agent\start-log.txt
call npm start >> C:\Users\Administrator\sightflow-desktop-agent\start-log.txt 2>&1
echo [%date% %time%] exited >> C:\Users\Administrator\sightflow-desktop-agent\start-log.txt
