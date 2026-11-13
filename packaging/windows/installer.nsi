; ═══════════════════════════════════════════════════════════════
;  PACHECO SOLUTIONS — instalador para Windows 10/11 (64 bits)
;
;  Instalação POR USUÁRIO (sem UAC/administrador):
;    programa  → %LOCALAPPDATA%\Programs\PACHECO SOLUTIONS
;    dados     → %LOCALAPPDATA%\PACHECO SOLUTIONS
;    config    → %APPDATA%\PACHECO SOLUTIONS
;
;  Compilado com NSIS 3.x (makensis), inclusive no Linux.
;  Defines esperados:
;    OUTFILE, APPVERSION, APPVERSION4, APPICON, APPDIR
; ═══════════════════════════════════════════════════════════════

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true
BrandingText "PACHECO SOLUTIONS"
WindowIcon on

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

!define APP_NAME "PACHECO SOLUTIONS"
!define APP_PUBLISHER "PACHECO SOLUTIONS"
!define APP_URL "https://github.com/ricb86/pacheco-solutions"
!define APP_EXE "pacheco-server.exe"
!define APP_LAUNCHER "pacheco-launcher.vbs"
!define APP_ICON "pacheco.ico"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PACHECO SOLUTIONS"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\PACHECO SOLUTIONS"
InstallDirRegKey HKCU "Software\PACHECO SOLUTIONS" "InstallDir"
Icon "${APPICON}"
UninstallIcon "${APPICON}"

VIProductVersion "${APPVERSION4}"
VIAddVersionKey /LANG=0 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=0 "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey /LANG=0 "FileDescription" "${APP_NAME} - instalador"
VIAddVersionKey /LANG=0 "FileVersion" "${APPVERSION}"
VIAddVersionKey /LANG=0 "ProductVersion" "${APPVERSION}"
VIAddVersionKey /LANG=0 "LegalCopyright" "PACHECO SOLUTIONS"

; ── Interface ──────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ICON "${APPICON}"
!define MUI_UNICON "${APPICON}"
!define MUI_FINISHPAGE_RUN "$SYSDIR\wscript.exe"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchPacheco"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o PACHECO SOLUTIONS agora"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\LEIA-ME.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Abrir o LEIA-ME"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "PortugueseBR"

; ── Instalação ─────────────────────────────────────────────────
Section "Aplicativo (obrigatorio)" SEC_APP
  SectionIn RO
  SetShellVarContext current

  SetOutPath "$INSTDIR"
  File /r "${APPDIR}/*"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Pastas de dados/configuração (o .env é criado pelo próprio app)
  CreateDirectory "$LOCALAPPDATA\PACHECO SOLUTIONS"
  CreateDirectory "$APPDATA\PACHECO SOLUTIONS"

  ; Menu Iniciar
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\PACHECO SOLUTIONS.lnk" \
    "$SYSDIR\wscript.exe" '"$INSTDIR\${APP_LAUNCHER}"' "$INSTDIR\${APP_ICON}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Comandos (prompt).lnk" \
    "$SYSDIR\cmd.exe" '/k ""$INSTDIR\pacheco.cmd" ajuda"' "$INSTDIR\${APP_ICON}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Desinstalar.lnk" \
    "$INSTDIR\uninstall.exe" "" "$INSTDIR\${APP_ICON}" 0

  ; Registro (por usuário)
  WriteRegStr HKCU "Software\PACHECO SOLUTIONS" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\PACHECO SOLUTIONS" "Version" "${APPVERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_ICON}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "${APP_URL}"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Atalho na area de trabalho" SEC_DESKTOP
  SetShellVarContext current
  CreateShortCut "$DESKTOP\PACHECO SOLUTIONS.lnk" \
    "$SYSDIR\wscript.exe" '"$INSTDIR\${APP_LAUNCHER}"' "$INSTDIR\${APP_ICON}" 0
SectionEnd

Section /o "Iniciar com o Windows" SEC_STARTUP
  SetShellVarContext current
  CreateShortCut "$SMSTARTUP\PACHECO SOLUTIONS.lnk" \
    "$SYSDIR\wscript.exe" '"$INSTDIR\${APP_LAUNCHER}" --no-browser' "$INSTDIR\${APP_ICON}" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_APP} \
    "Aplicativo completo, interface web, atalhos e desinstalador."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} \
    "Cria um atalho do PACHECO SOLUTIONS na Area de Trabalho."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_STARTUP} \
    "Inicia o servidor automaticamente ao entrar no Windows (sem janela)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ── Inicialização ──────────────────────────────────────────────
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP \
      "Este aplicativo requer Windows 10 ou 11 de 64 bits."
    Abort
  ${EndIf}
  SetShellVarContext current
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

; Executado pela página final (com aspas corretas para o caminho)
Function LaunchPacheco
  Exec '"$SYSDIR\wscript.exe" "$INSTDIR\${APP_LAUNCHER}"'
FunctionEnd

; ── Desinstalação ──────────────────────────────────────────────
Section "Uninstall"
  SetShellVarContext current

  ; Encerra o servidor antes de remover os arquivos
  nsExec::Exec 'taskkill /F /IM pacheco-server.exe'
  Pop $0
  Sleep 500

  Delete "$SMSTARTUP\PACHECO SOLUTIONS.lnk"
  Delete "$DESKTOP\PACHECO SOLUTIONS.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\PACHECO SOLUTIONS.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Comandos (prompt).lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  DeleteRegKey HKCU "Software\PACHECO SOLUTIONS"
  DeleteRegKey HKCU "${UNINST_KEY}"

  ; Dados do usuário: só remove se confirmado (não remove em /S)
  IfSilent skipData
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Deseja remover tambem o banco de dados, os logs e as configuracoes?" \
    IDNO skipData
  RMDir /r "$LOCALAPPDATA\PACHECO SOLUTIONS"
  RMDir /r "$APPDATA\PACHECO SOLUTIONS"
  skipData:

  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR"
SectionEnd
