@echo off
rem KVFX Tools - uninstaller for Windows
rem Removes the panel from %APPDATA%\Adobe\CEP\extensions\com.kvfx.tools.
rem Your KVFX settings (%APPDATA%\KVFXTools) and your projects are not touched.

setlocal
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.kvfx.tools"

if not exist "%DEST%" (
  echo  KVFX Tools is not installed for this user.
  pause
  exit /b 0
)

choice /C YN /M "  Remove KVFX Tools"
if errorlevel 2 exit /b 0
rmdir /S /Q "%DEST%"
echo  Removed. Restart After Effects.
echo.
echo  Unsigned extensions are still allowed. To turn that off as well, run
echo  disable-cep-debug.reg from the KVFX Tools source, or:
echo    reg delete HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /f
echo.
pause
