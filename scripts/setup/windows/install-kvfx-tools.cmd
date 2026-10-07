@echo off
rem KVFX Tools - installer for Windows
rem
rem What this does, for YOUR user account only (no administrator rights):
rem   1. Allows After Effects to load unsigned extensions (PlayerDebugMode).
rem      KVFX Tools is not code-signed yet, so this is required.
rem   2. Copies the com.kvfx.tools folder next to this file into
rem      %APPDATA%\Adobe\CEP\extensions\
rem Nothing else is changed. Run "Uninstall KVFX Tools (Windows).cmd" to remove it.

setlocal
set "SRC=%~dp0com.kvfx.tools"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.kvfx.tools"

echo.
echo  KVFX Tools - installing
echo  ------------------------
echo.

if not exist "%SRC%\CSXS\manifest.xml" (
  echo  The com.kvfx.tools folder was not found next to this installer.
  echo  Unzip the whole download first, then run this file from the unzipped folder.
  echo.
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq AfterFX.exe" 2>nul | find /I "AfterFX.exe" >nul
if not errorlevel 1 (
  echo  After Effects is running. Quit it first, then run this installer again.
  echo.
  pause
  exit /b 1
)

if exist "%DEST%\CSXS\manifest.xml" (
  echo  KVFX Tools is already installed. Your settings are kept either way.
  choice /C YN /M "  Replace it with this version"
  if errorlevel 2 (
    echo  Nothing was changed.
    pause
    exit /b 0
  )
  rmdir /S /Q "%DEST%"
)

reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo  [1/2] Allowed unsigned extensions for your account.

if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"
xcopy "%SRC%" "%DEST%" /E /I /H /Q /Y >nul
if errorlevel 1 (
  echo  Copying failed. Check that you can write to %APPDATA%\Adobe\CEP\extensions
  pause
  exit /b 1
)
echo  [2/2] Copied the panel to %DEST%

echo.
echo  Done. Open After Effects, then choose  Window ^> Extensions ^> KVFX Tools
echo.
pause
