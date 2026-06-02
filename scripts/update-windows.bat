@echo off
:: update-windows.bat — Force-update burnrate-copilot from GitHub on Windows.
::
:: Copilot CLI caches plugins in two locations and restores from the cache on
:: reinstall, so /plugin update and uninstall/reinstall do not pull new code.
:: This script bypasses that by pulling directly from GitHub into both locations.
::
:: Usage: double-click update-windows.bat, or run from cmd:
::   "%USERPROFILE%\.copilot\installed-plugins\_direct\https---github-com-upld-internal-burnrate-copilot-git\scripts\update-windows.bat"

setlocal

set SLUG=https---github-com-upld-internal-burnrate-copilot-git
set INSTALL_DIR=%USERPROFILE%\.copilot\installed-plugins\_direct\%SLUG%
set CACHE_DIR=%LOCALAPPDATA%\copilot\marketplaces\%SLUG%
set REPO_URL=https://github.com/upld-internal/burnrate-copilot.git
set TMPDIR=%TEMP%\burnrate-update-%RANDOM%

echo.
echo burnrate-copilot updater
echo ========================

:: Check git is available
where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git is not installed or not in PATH.
  echo Install Git for Windows from https://git-scm.com and try again.
  goto :fail
)

echo Cloning latest from GitHub...
git clone --depth 1 "%REPO_URL%" "%TMPDIR%"
if errorlevel 1 (
  echo ERROR: git clone failed. Check your internet connection and try again.
  goto :fail
)

echo Updating installed-plugins cache...
if exist "%INSTALL_DIR%" (
  xcopy /s /y /q "%TMPDIR%\*" "%INSTALL_DIR%\" >nul
  echo   Updated: %INSTALL_DIR%
) else (
  echo   WARNING: installed-plugins directory not found, skipping.
  echo   Expected: %INSTALL_DIR%
)

echo Updating marketplaces cache...
if exist "%CACHE_DIR%" (
  xcopy /s /y /q "%TMPDIR%\*" "%CACHE_DIR%\" >nul
  echo   Updated: %CACHE_DIR%
) else (
  echo   WARNING: marketplaces directory not found, skipping.
  echo   Expected: %CACHE_DIR%
)

echo Cleaning up...
rmdir /s /q "%TMPDIR%"

echo.
echo Done. Restart Copilot CLI to use the updated plugin.
goto :end

:fail
if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"
echo.
echo Update failed. See errors above.
pause
exit /b 1

:end
pause
