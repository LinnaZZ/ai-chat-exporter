@echo off
echo Starte YT-Archiv-Bot...
set BASE=%~dp0
cd /d %BASE%

if not exist venv (
    echo Erstelle virtuelle Umgebung...
    python -m venv venv
    call venv\Scripts\activate
    echo Installiere Abhaengigkeiten...
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate
)

echo Bot wird gestartet...
python bot.py
pause
