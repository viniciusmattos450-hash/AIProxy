@echo off
chcp 65001 >nul
title DeepSeek CLI
cd /d "%~dp0"
python "%~dp0ds_cli.py"
if errorlevel 1 pause
