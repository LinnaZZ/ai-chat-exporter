import os
import asyncio
import logging
import yt_dlp
from datetime import datetime
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, MessageHandler, filters
from pathlib import Path

from storage import save_video
from ai_handler import process_video_with_gemini
from html_builder import build_html

# Logging konfigurieren
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

load_dotenv()
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
BASE_DIR = Path(__file__).parent
TEMP_DIR = BASE_DIR / "temp"
TEMP_DIR.mkdir(exist_ok=True)

def download_audio(url):
    """Lädt die Tonspur eines YouTube-Videos herunter."""
    output_template = str(TEMP_DIR / "%(id)s.%(ext)s")

    # Pfad zu FFmpeg (kann angepasst werden, wenn FFmpeg im Projekt liegt)
    # Wenn ffmpeg.exe im Projektordner/bin liegt:
    ffmpeg_path = str(BASE_DIR / "bin" / "ffmpeg.exe") if os.name == 'nt' else "ffmpeg"

    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': output_template,
        'quiet': True,
        'no_warnings': True,
    }

    # Falls FFmpeg im bin-Ordner existiert, nutzen
    if Path(ffmpeg_path).exists() or os.name != 'nt':
        ydl_opts['ffmpeg_location'] = ffmpeg_path if Path(ffmpeg_path).exists() else None

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        audio_path = Path(ydl.prepare_filename(info)).with_suffix(".mp3")

        # Metadaten extrahieren
        duration_sec = info.get("duration", 0)
        h = duration_sec // 3600
        m = (duration_sec % 3600) // 60
        s = duration_sec % 60
        duration_str = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"

        metadata = {
            "title": info.get("title", "Unbekannter Titel"),
            "thumbnail": info.get("thumbnail"),
            "duration": duration_str,
            "url": url,
            "archived_at": datetime.now().strftime("%d.%m.%Y")
        }
        return audio_path, metadata

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if "youtube.com" in text or "youtu.be" in text:
        # Link extrahieren (simpel)
        url = text.strip()
        await update.message.reply_text("✨ YouTube-Link erkannt! Ich fange an zu arbeiten. Das kann einen Moment dauern...")

        try:
            # 1. Audio herunterladen
            await update.message.reply_text("📥 Lade Audio herunter...")
            audio_path, metadata = await asyncio.to_thread(download_audio, url)

            # 2. KI-Verarbeitung (Transkription, Zusammenfassung, Kategorie)
            await update.message.reply_text("🧠 Analysiere Video mit Gemini KI...")
            ai_result = await asyncio.to_thread(process_video_with_gemini, str(audio_path), metadata["title"])

            # Daten zusammenführen
            video_data = {**metadata, **ai_result}

            # 3. Speichern
            save_video(video_data)

            # 4. HTML aktualisieren
            build_html()

            # Aufräumen: Audiodatei löschen
            if audio_path.exists():
                audio_path.unlink()

            await update.message.reply_text(f"✅ Fertig! '{metadata['title']}' wurde zur Sammlung hinzugefügt und kategorisiert als '{ai_result['category']}'.")

        except Exception as e:
            logging.error(f"Fehler bei der Verarbeitung: {e}")
            await update.message.reply_text(f"❌ Hoppla, da ist was schiefgelaufen: {e}")
    else:
        await update.message.reply_text("Schick mir einfach einen YouTube-Link, und ich verarbeite ihn für dich!")

if __name__ == '__main__':
    if not TELEGRAM_TOKEN:
        print("Fehler: TELEGRAM_TOKEN nicht in der .env Datei gefunden!")
    else:
        application = ApplicationBuilder().token(TELEGRAM_TOKEN).build()

        message_handler = MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message)
        application.add_handler(message_handler)

        print("Bot gestartet... Warte auf Nachrichten.")
        application.run_polling()
