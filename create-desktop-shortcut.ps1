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

# Prefer the app's own icon; fall back to the Electron exe if it's missing
$icon = Join-Path $appDir "icon.ico"
if (-not (Test-Path $icon)) { $icon = Join-Path $appDir "node_modules\electron\dist\electron.exe" }
if (Test-Path $icon) { $sc.IconLocation = $icon }

$sc.Save()
Write-Host "Shortcut created at: $lnkPath"