# Creates a Desktop shortcut for Ra that launches the app silently.
$appDir   = $PSScriptRoot
$vbs      = Join-Path $appDir "launch-app.vbs"
$desktop  = [Environment]::GetFolderPath("Desktop")
$lnkPath  = Join-Path $desktop "Ra.lnk"

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnkPath)
$sc.TargetPath       = "wscript.exe"
$sc.Arguments        = """$vbs"""
$sc.WorkingDirectory = $appDir
$sc.WindowStyle      = 1
$sc.Description       = "Ra"

# Use the Electron exe as the icon if present
$icon = Join-Path $appDir "node_modules\electron\dist\electron.exe"
if (Test-Path $icon) { $sc.IconLocation = $icon }

$sc.Save()
Write-Host "Shortcut created at: $lnkPath"