import os
import time
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# Konfiguration der Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

def process_video_with_gemini(audio_path, video_title):
    """
    Sendet die Audiodatei an Gemini zur Transkription, Zusammenfassung und Kategorisierung.
    """
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY nicht in der .env Datei gefunden.")

    # Das Modell konfigurieren
    model = genai.GenerativeModel("gemini-1.5-flash")

    print(f"Lade Datei hoch: {audio_path}")
    audio_file = genai.upload_file(path=audio_path)
    print(f"Datei hochgeladen: {audio_file.name}")

    # Warten, bis die Datei verarbeitet wurde
    while audio_file.state.name == "PROCESSING":
        print("Warte auf Verarbeitung durch Gemini...")
        time.sleep(5)
        audio_file = genai.get_file(audio_file.name)

    if audio_file.state.name == "FAILED":
        raise Exception("Gemini Audio-Verarbeitung fehlgeschlagen.")

    prompt = f"""
    Hier ist eine Audiodatei eines YouTube-Videos mit dem Titel: "{video_title}".

    Bitte führe folgende Aufgaben aus:
    1. Erstelle eine vollständige Transkription des Inhalts (in der Originalsprache).
    2. Erstelle eine kurze, prägnante Zusammenfassung auf Deutsch (ca. 2-3 Sätze).
    3. Weise dem Video genau EINE der folgenden Kategorien zu: Technik, Musik, Lernen, Gesellschaft, Wissenschaft. Wenn absolut keine passt, wähle "Sonstiges".

    Antworte bitte STRENG im folgenden JSON-Format:
    {{
        "transcript": "...",
        "summary": "...",
        "category": "..."
    }}
    """

    print("Generiere Inhalt mit Gemini...")
    response = model.generate_content([prompt, audio_file])

    # Datei bei Google Cloud löschen, um Platz zu sparen (optional, Google löscht sie eh nach 48h)
    genai.delete_file(audio_file.name)

    # Versuche, das JSON aus der Antwort zu extrahieren
    text = response.text
    # Einfaches Cleanup, falls Gemini Markdown-Code-Blocks zurückgibt
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()

    import json
    try:
        return json.loads(text)
    except Exception as e:
        print(f"Fehler beim Parsen der Gemini-Antwort: {e}")
        print(f"Rohantwort: {text}")
        return {
            "transcript": "Transkription fehlgeschlagen.",
            "summary": "Zusammenfassung konnte nicht generiert werden.",
            "category": "Sonstiges"
        }
