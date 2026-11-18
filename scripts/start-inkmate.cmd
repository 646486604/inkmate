@echo off
setlocal
cd /d "%~dp0.."
if not exist "data" mkdir "data"
echo [%date% %time%] starting InkMate >> "data\inkmate.log"
call npm start >> "data\inkmate.log" 2>&1
