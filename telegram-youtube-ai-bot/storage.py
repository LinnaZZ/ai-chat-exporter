import json
import os
from pathlib import Path

# Definieren des Basisverzeichnisses relativ zu dieser Datei
BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "data" / "videos.json"

def load_videos():
    """Lädt die Video-Daten aus der JSON-Datei."""
    if not DATA_FILE.exists():
        return []

    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Fehler beim Laden der Daten: {e}")
        return []

def save_video(video_data):
    """Speichert ein neues Video in der JSON-Datei."""
    videos = load_videos()

    # Prüfen, ob das Video bereits existiert (anhand der URL oder ID)
    for i, v in enumerate(videos):
        if v.get('url') == video_data.get('url'):
            videos[i] = video_data
            break
    else:
        videos.append(video_data)

    try:
        # Sicherstellen, dass das Datenverzeichnis existiert
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(videos, f, ensure_ascii=False, indent=4)
        return True
    except Exception as e:
        print(f"Fehler beim Speichern der Daten: {e}")
        return False
