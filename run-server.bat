@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title DeepSeek Bridge

set "CFG=%USERPROFILE%\.ds_bridge_path.txt"
rem Servidor local tem prioridade; cai para a instalacao antiga se nao existir.
set "SERVER=%~dp0server.py"
if not exist "%SERVER%" set "SERVER=%USERPROFILE%\.ds_bridge\server.py"

set "LAST="
if exist "%CFG%" set /p LAST=<"%CFG%"

if defined LAST (
    echo Ultima pasta: !LAST!
    set /p "DIR=Digite a pasta (Enter = mesma): "
    if "!DIR!"=="" set "DIR=!LAST!"
) else (
    set /p "DIR=Digite a pasta do projeto: "
)

if not exist "!DIR!" (
    echo ERRO: pasta nao existe: !DIR!
    pause
    exit /b 1
)

pushd "!DIR!"
set "DIR=%CD%"
popd

>"%CFG%" echo !DIR!

if not exist "%SERVER%" (
    echo ERRO: server.py nao existe em %SERVER%
    pause
    exit /b 1
)

echo.
echo Projeto: !DIR!
echo Servidor: %SERVER%
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul

set "BRIDGE_PROJECT=!DIR!"
python "%SERVER%"
pause