@echo off
cd /d "%~dp0.."
wscript.exe //B //Nologo "%~dp0start-bot-hidden.vbs"
