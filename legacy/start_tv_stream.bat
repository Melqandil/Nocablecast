@echo off
setlocal

rem Always run from the folder this .bat file lives in, so double-clicking
rem it works no matter where it's launched from.
cd /d "%~dp0"

set PYTHON_CMD=

where python >nul 2>nul
if not errorlevel 1 set PYTHON_CMD=python

if not defined PYTHON_CMD (
    where py >nul 2>nul
    if not errorlevel 1 set PYTHON_CMD=py
)

if not defined PYTHON_CMD (
    echo Could not find Python on this PC.
    echo Install it from https://www.python.org/downloads/
    echo and make sure to check "Add python.exe to PATH" during setup.
    echo.
    pause
    exit /b 1
)

if not exist "tv_stream_gui.py" (
    echo Could not find tv_stream_gui.py in this folder:
    echo   %cd%
    echo Make sure start_tv_stream.bat is in the same folder as tv_stream_gui.py.
    echo.
    pause
    exit /b 1
)

echo Starting Desktop -^> TV Streamer...
%PYTHON_CMD% tv_stream_gui.py

if errorlevel 1 (
    echo.
    echo The app closed with an error - see the messages above for details.
    pause
)

endlocal
