@echo off
setlocal
set "BENTO_ROOT=%~dp0"
for %%F in ("%LOCALAPPDATA%\Bento Workspace\mrmak-workspace.exe" "%LOCALAPPDATA%\Mr. Mak Workspace\mrmak-workspace.exe" "%BENTO_ROOT%src-tauri\target\release\mrmak-workspace.exe") do (
  if exist "%%~F" (
    start "" "%%~F" --repo "%BENTO_ROOT%." --show workspace
    exit /b 0
  )
)
echo Install Bento Workspace, or build it with Setup.ps1 -Mode Desktop.
pause
