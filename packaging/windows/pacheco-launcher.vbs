' ═══════════════════════════════════════════════════════════════
'  PACHECO SOLUTIONS — inicializador para Windows 10/11
'
'  Inicia o servidor local SEM janela de console e abre o
'  navegador. Se o servidor já estiver ativo, apenas abre a
'  interface.
'
'  Uso:
'    wscript.exe pacheco-launcher.vbs
'    wscript.exe pacheco-launcher.vbs --no-browser
' ═══════════════════════════════════════════════════════════════
Option Explicit

Dim fso, sh, scriptDir, exePath, configDir, dataDir, envFile, logFile
Dim port, url, noBrowser, ok, i, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = fso.BuildPath(scriptDir, "pacheco-server.exe")

' Mesmos diretórios usados pelo aplicativo no Windows:
'   configuração/.env → %APPDATA%\PACHECO SOLUTIONS
'   banco/log         → %LOCALAPPDATA%\PACHECO SOLUTIONS
configDir = fso.BuildPath(sh.ExpandEnvironmentStrings("%APPDATA%"), "PACHECO SOLUTIONS")
dataDir = fso.BuildPath(sh.ExpandEnvironmentStrings("%LOCALAPPDATA%"), "PACHECO SOLUTIONS")
envFile = fso.BuildPath(configDir, ".env")
logFile = fso.BuildPath(dataDir, "pacheco.log")

EnsureFolder configDir
EnsureFolder dataDir

port = ReadPort(envFile)
url = "http://localhost:" & port

' Aceita "--no-browser" ou "start" para iniciar sem abrir o navegador
noBrowser = False
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "--no-browser" Or LCase(WScript.Arguments(0)) = "start" Then
    noBrowser = True
  End If
End If

If Not IsServerUp(url & "/health") Then
  If Not fso.FileExists(exePath) Then
    MsgBox "Executável não encontrado:" & vbCrLf & exePath, vbCritical, "PACHECO SOLUTIONS"
    WScript.Quit 1
  End If

  ' O cmd.exe é usado apenas para redirecionar a saída para o log.
  cmd = "cmd.exe /c """ & exePath & """ >> """ & logFile & """ 2>&1"
  On Error Resume Next
  sh.Run cmd, 0, False
  If Err.Number <> 0 Then
    MsgBox "Não foi possível iniciar o servidor." & vbCrLf & Err.Description, vbCritical, "PACHECO SOLUTIONS"
    WScript.Quit 1
  End If
  On Error GoTo 0

  ' Aguarda até 30 segundos pela resposta do /health
  ok = False
  For i = 1 To 60
    WScript.Sleep 500
    If IsServerUp(url & "/health") Then
      ok = True
      Exit For
    End If
  Next

  If Not ok Then
    MsgBox "O servidor não respondeu a tempo." & vbCrLf & vbCrLf & _
      "Veja o log em:" & vbCrLf & logFile & vbCrLf & vbCrLf & _
      "Se a porta " & port & " estiver ocupada, edite PORT= no arquivo:" & vbCrLf & envFile, _
      vbExclamation, "PACHECO SOLUTIONS"
    WScript.Quit 1
  End If
End If

If Not noBrowser Then
  On Error Resume Next
  sh.Run url, 1, False
  If Err.Number <> 0 Then
    MsgBox "O servidor está ativo, mas não foi possível abrir o navegador." & vbCrLf & _
      "Abra manualmente: " & url, vbInformation, "PACHECO SOLUTIONS"
  End If
  On Error GoTo 0
End If

WScript.Quit 0

' ── Rotinas auxiliares ─────────────────────────────────────────

Sub EnsureFolder(path)
  If Not fso.FolderExists(path) Then
    On Error Resume Next
    fso.CreateFolder path
    On Error GoTo 0
  End If
End Sub

Function ReadPort(path)
  ReadPort = "3001"
  If Not fso.FileExists(path) Then Exit Function

  Dim content, lines, line, eq, key, value
  content = fso.OpenTextFile(path, 1).ReadAll
  lines = Split(content, vbCrLf)
  If UBound(lines) = 0 Then lines = Split(content, vbLf)

  For Each line In lines
    line = Trim(line)
    If Len(line) > 0 And Left(line, 1) <> "#" Then
      eq = InStr(line, "=")
      If eq > 0 Then
        key = Trim(Left(line, eq - 1))
        value = Trim(Mid(line, eq + 1))
        If UCase(key) = "PORT" And IsNumeric(value) Then
          If CLng(value) > 0 And CLng(value) < 65536 Then
            ReadPort = CStr(CLng(value))
            Exit Function
          End If
        End If
      End If
    End If
  Next
End Function

Function IsServerUp(healthUrl)
  IsServerUp = False
  On Error Resume Next

  Dim http
  Set http = CreateObject("MSXML2.XMLHTTP.6.0")
  If Err.Number <> 0 Then
    Err.Clear
    Set http = CreateObject("MSXML2.XMLHTTP")
  End If
  If Err.Number <> 0 Then
    Err.Clear
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  End If
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If

  http.Open "GET", healthUrl, False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then IsServerUp = True
  End If

  Err.Clear
  On Error GoTo 0
End Function
