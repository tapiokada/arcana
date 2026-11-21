@echo off
cd /d %~dp0
if not exist node_modules ( call npm install )
node server\relay.js 7700
pause
