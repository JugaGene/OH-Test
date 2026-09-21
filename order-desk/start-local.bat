@echo off
cd /d "%~dp0"
echo GreenPeas order desk — http://127.0.0.1:8765
echo Local only. Close this window to stop.
python -m http.server 8765 --bind 127.0.0.1
pause
