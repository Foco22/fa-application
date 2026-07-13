' Launches Paper Learning without showing a console window.
' Espera el resultado: si la app no arranca, avisa en vez de no hacer nada —
' el modo silencioso hacia que un crash al iniciar se viera como "el acceso
' directo no funciona".
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

logPath = scriptDir & "\launch-error.log"
If fso.FileExists(logPath) Then fso.DeleteFile logPath

exitCode = WshShell.Run("""" & scriptDir & "\launch-app.bat""", 0, True)

If exitCode <> 0 Then
  detail = ""
  If fso.FileExists(logPath) Then
    Set logFile = fso.OpenTextFile(logPath, 1)
    detail = vbCrLf & vbCrLf & Left(logFile.ReadAll, 800)
    logFile.Close
  End If
  MsgBox "Paper Learning no pudo iniciar (codigo " & exitCode & ")." & detail, _
         vbExclamation, "Paper Learning"
End If
