import os
from jinja2 import Environment, FileSystemLoader
from datetime import datetime
from storage import load_videos
from pathlib import Path

# Basisverzeichnis
BASE_DIR = Path(__file__).parent
TEMPLATE_DIR = BASE_DIR / "templates"
OUTPUT_FILE = BASE_DIR / "index.html"

def build_html():
    """Generiert die index.html basierend auf den gespeicherten Video-Daten."""
    videos = load_videos()

    # Jinja2 Umgebung einrichten
    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))
    template = env.get_template("index.html.j2")

    # Aktuelles Datum für die "Letzte Aktualisierung"
    last_updated = datetime.now().strftime("%d. %B %Y")
    # Deutsches Datum (simpel)
    months = {
        "January": "Januar", "February": "Februar", "March": "März",
        "April": "April", "May": "Mai", "June": "Juni",
        "July": "Juli", "August": "August", "September": "September",
        "October": "Oktober", "November": "November", "December": "Dezember"
    }
    for eng, deu in months.items():
        last_updated = last_updated.replace(eng, deu)

    # HTML rendern
    html_content = template.render(
        videos=videos,
        last_updated=last_updated
    )

    # In Datei schreiben
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"HTML-Sammlung aktualisiert: {OUTPUT_FILE}")
    return OUTPUT_FILE

if __name__ == "__main__":
    build_html()
