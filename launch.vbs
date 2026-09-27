' Rastreador de Contrataciones - lanzador de escritorio
' Usa Electron si esta instalado (npm install); si no, abre la app
' en una ventana de navegador sin barras, que se comporta como una app.
Option Explicit

Dim fso, sh, base, page, url, electron, browsers, i, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
page = base & "\web\index.html"
url  = "file:///" & Replace(page, "\", "/")

If Not fso.FileExists(page) Then
  MsgBox "No se encontro la app en:" & vbCrLf & page, 16, "Rastreador de Contrataciones"
  WScript.Quit 1
End If

' 1. aplicacion de escritorio completa
electron = base & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electron) Then
  sh.CurrentDirectory = base
  sh.Run """" & electron & """ """ & base & """", 1, False
  WScript.Quit 0
End If

' 2. navegador en modo aplicacion: ventana propia, sin pestanas ni barra
browsers = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe") _
)

For i = 0 To UBound(browsers)
  exe = browsers(i)
  If fso.FileExists(exe) Then
    sh.Run """" & exe & """ --app=""" & url & """ --window-size=1680,1000", 1, False
    WScript.Quit 0
  End If
Next

' 3. ultimo recurso: el navegador predeterminado
sh.Run """" & page & """", 1, False
WScript.Quit 0
