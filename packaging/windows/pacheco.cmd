@echo off
rem ===============================================================
rem  PACHECO SOLUTIONS - comandos de controle (Windows 10/11)
rem
rem  Uso:
rem    pacheco.cmd              inicia e abre no navegador
rem    pacheco.cmd start        inicia o servidor (sem navegador)
rem    pacheco.cmd stop         encerra o servidor
rem    pacheco.cmd restart      reinicia
rem    pacheco.cmd status       mostra o estado
rem    pacheco.cmd logs         acompanha o log
rem    pacheco.cmd config       abre o .env no Notepad
rem    pacheco.cmd pasta        abre a pasta de dados
rem    pacheco.cmd uninstall    abre o desinstalador
rem ===============================================================
setlocal EnableExtensions
title PACHECO SOLUTIONS

set "APPDIR=%~dp0"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"

set "EXE=%APPDIR%\pacheco-server.exe"
set "VBS=%APPDIR%\pacheco-launcher.vbs"
set "CONFIG=%APPDATA%\PACHECO SOLUTIONS"
set "DATA=%LOCALAPPDATA%\PACHECO SOLUTIONS"
set "LOG=%DATA%\pacheco.log"
set "PORT=3001"

if exist "%CONFIG%\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%CONFIG%\.env") do (
    if /i "%%A"=="PORT" set "PORT=%%B"
  )
)
set "URL=http://localhost:%PORT%"

if /i "%~1"=="" goto abrir
if /i "%~1"=="start" goto iniciar
if /i "%~1"=="stop" goto parar
if /i "%~1"=="parar" goto parar
if /i "%~1"=="restart" goto reiniciar
if /i "%~1"=="reiniciar" goto reiniciar
if /i "%~1"=="status" goto status
if /i "%~1"=="logs" goto logs
if /i "%~1"=="config" goto config
if /i "%~1"=="pasta" goto pasta
if /i "%~1"=="uninstall" goto desinstalar
if /i "%~1"=="desinstalar" goto desinstalar
goto ajuda

:abrir
if not exist "%VBS%" (
  echo ERRO: inicializador nao encontrado: "%VBS%"
  exit /b 1
)
start "" wscript.exe "%VBS%"
exit /b 0

:iniciar
if not exist "%EXE%" (
  echo ERRO: executavel nao encontrado: "%EXE%"
  exit /b 1
)
wscript.exe "%VBS%" --no-browser
if errorlevel 1 (
  echo ERRO: nao foi possivel iniciar. Veja o log: "%LOG%"
  exit /b 1
)
echo Servidor iniciado em %URL%
exit /b 0

:parar
tasklist /FI "IMAGENAME eq pacheco-server.exe" /NH 2>nul | findstr /I /C:"pacheco-server.exe" >nul
if errorlevel 1 (
  echo O servidor ja esta parado.
  exit /b 0
)
taskkill /F /IM pacheco-server.exe >nul 2>&1
if errorlevel 1 (
  echo ERRO: nao foi possivel encerrar o servidor.
  exit /b 1
)
echo Servidor encerrado.
exit /b 0

:reiniciar
call :parar
timeout /t 1 /nobreak >nul
wscript.exe "%VBS%" --no-browser
if errorlevel 1 (
  echo ERRO: nao foi possivel reiniciar. Veja o log: "%LOG%"
  exit /b 1
)
echo Servidor reiniciado em %URL%
exit /b 0

:status
echo.
echo  PACHECO SOLUTIONS - status
echo  ------------------------------------------------------------
tasklist /FI "IMAGENAME eq pacheco-server.exe" /NH 2>nul | findstr /I /C:"pacheco-server.exe" >nul
if errorlevel 1 (
  echo  Processo : PARADO
) else (
  echo  Processo : EM EXECUCAO
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 '%URL%/health'; Write-Host ('  Servidor : ATIVO (HTTP ' + $r.StatusCode + ') em %URL%') } catch { Write-Host '  Servidor : sem resposta em %URL%' }"
echo  Porta    : %PORT%
echo  Dados    : %DATA%
echo  Config   : %CONFIG%
echo  Log      : %LOG%
echo.
exit /b 0

:logs
if not exist "%LOG%" (
  echo O log ainda nao existe. Inicie o aplicativo primeiro.
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-Content -Path '%LOG%' -Tail 80 -Wait"
exit /b 0

:config
if not exist "%CONFIG%\.env" (
  echo O arquivo de configuracao ainda nao existe.
  echo Inicie o aplicativo uma vez para cria-lo em:
  echo   %CONFIG%\.env
  exit /b 1
)
start "" notepad.exe "%CONFIG%\.env"
exit /b 0

:pasta
if not exist "%DATA%" mkdir "%DATA%" >nul 2>&1
start "" "%DATA%"
exit /b 0

:desinstalar
if not exist "%APPDIR%\uninstall.exe" (
  echo Desinstalador nao encontrado em "%APPDIR%".
  echo Use Configuracoes ^> Aplicativos ^> PACHECO SOLUTIONS.
  exit /b 1
)
start "" "%APPDIR%\uninstall.exe"
exit /b 0

:ajuda
echo.
echo  PACHECO SOLUTIONS - comandos
echo  ------------------------------------------------------------
echo   pacheco.cmd              inicia e abre no navegador
echo   pacheco.cmd start        inicia o servidor (sem navegador)
echo   pacheco.cmd stop         encerra o servidor
echo   pacheco.cmd restart      reinicia
echo   pacheco.cmd status       mostra o estado
echo   pacheco.cmd logs         acompanha o log
echo   pacheco.cmd config       abre o .env no Notepad
echo   pacheco.cmd pasta        abre a pasta de dados
echo   pacheco.cmd uninstall    abre o desinstalador
echo.
echo  Interface: %URL%
echo  Dados:     %DATA%
echo  Config:    %CONFIG%
echo.
exit /b 0
