# KIsruptiv VoiceBot

Ein KI-Voice-Bot, der stellvertretend an **Google-Meet- und Microsoft-Teams-Terminen** teilnimmt – wie eine intelligente Mailbox, nur für Meetings.

Du gibst dem Bot eine Meeting-URL, einen Namen, eine **Rolle** und ein Ziel. Der Bot tritt dem Meeting als Teilnehmer bei, führt das Gespräch per Sprache, stellt deine vordefinierten Fragen/Agenda-Punkte und gibt nur freigegebene Antworten. Nach dem Meeting bekommst du einen strukturierten Bericht.

**Rollen:**

| Rolle | Verhalten | Bericht |
| --- | --- | --- |
| **Stellvertreter & Filter** (Standard) | Nimmt statt dir teil, qualifiziert das Anliegen und verlässt das Meeting selbstständig | Zusammenfassung, Kernpunkte, **Score 1–10 + Kontakt-Empfehlung** |
| Wissensmedium / Experte | Beantwortet Fragen aus Wissen & Dokumenten, während du dabei bist | Zusammenfassung, Kernpunkte, Fazit |
| Moderator | Führt durch die Agenda, achtet auf Zeit & Beteiligung, fasst zusammen | Ergebnisse pro Agenda-Punkt, nächste Schritte |
| Schlichter | Neutraler Vermittler: deeskaliert, arbeitet Gemeinsamkeiten heraus | Positionen, Annäherungen, Fazit |
| Provokateur / Sparringspartner | Advocatus Diaboli: hinterfragt Annahmen pointiert, aber respektvoll | Stärkste Einwände und Antworten darauf |
| Eigene Rolle | Frei beschreibbares Verhalten | Rollenbezogenes Fazit |

In allen Rollen gilt: Der Bot legt zu Gesprächsbeginn offen, dass er eine KI ist und protokolliert.

## Wie es funktioniert

```
Dashboard (du)                    Google Meet                     OpenAI
     │                                 │                             │
     │ 1. Meeting-URL, Bot-Name,       │                             │
     │    Ziel, Fragen, Kriterien      │                             │
     ▼                                 │                             │
Netlify Functions ──2. Bot anlegen──▶ Recall.ai-Bot tritt bei        │
     ▲                                 │                             │
     │                          3. Bot rendert die Agent-Seite       │
     │                             (public/agent.html)               │
     │                                 │◀── Meeting-Audio ──┐        │
     │ 5. Transkript, Erkenntnisse,    │                    ├─WebRTC─▶ gpt-realtime
     │    Bewertung                    │◀── KI-Stimme ──────┘        │  (spricht & hört)
     │                                 │                             │
     ▼                                 │                             │
6. Abschlussbericht (Score, Empfehlung, Zusammenfassung) via Report-Modell
```

- **[Recall.ai](https://www.recall.ai)** stellt die Meeting-Bot-Infrastruktur: Der Bot tritt per URL jedem Google Meet oder Microsoft-Teams-Meeting bei (Name frei wählbar) und streamt über die *Output-Media*-API eine Webseite als Kamera/Audio ins Meeting.
- Diese Webseite (`public/agent.html`) verbindet sich per WebRTC mit der **OpenAI Realtime API** (`gpt-realtime`): Meeting-Audio geht an die KI, die KI-Stimme zurück ins Meeting.
- Die KI bekommt dein Ziel, deine Fragen, dein freigegebenes Wissen und deine Bewertungskriterien als Instruktionen und protokolliert alles über das Backend (Netlify Functions + Netlify Blobs).
- Nach dem Meeting erstellt ein Report-Modell (Standard: `gpt-5-mini`) den Abschlussbericht.

## Voraussetzungen

| Was | Wofür | Kosten (Größenordnung) |
| --- | --- | --- |
| [Recall.ai](https://www.recall.ai)-Account + API-Key | Bot-Teilnahme am Meeting | Pay-as-you-go, ca. 1 $/Stunde Bot-Zeit (Variante `web_4_core` +0,60 $/h) |
| [OpenAI](https://platform.openai.com)-API-Key | Sprach-KI + Bericht | Realtime-Audio nach Nutzung, grob wenige $ pro Meeting-Stunde |
| [Netlify](https://netlify.com)-Account | Hosting (Functions, Blobs, statische Seiten) | Free-Tier reicht zum Start |

Wichtig: Der Recall.ai-API-Key ist **regionsgebunden**. `RECALL_REGION` (Standard: `eu-central-1`) muss zur Region passen, in der du den Key erstellt hast.

## Setup & Deployment

```bash
npm install

# Bei Netlify anmelden und Site anlegen
npx netlify login
npx netlify init

# Umgebungsvariablen setzen (siehe .env.example)
npx netlify env:set RECALL_API_KEY "..."
npx netlify env:set OPENAI_API_KEY "sk-..."
npx netlify env:set RECALL_REGION "eu-central-1"
npx netlify env:set DASHBOARD_PASSWORD "ein-sicheres-passwort"

# Produktiv deployen
npx netlify deploy --prod
```

Danach das Dashboard unter der Netlify-URL öffnen, Meeting-URL einfügen, Ziel und Fragen definieren, **„Bot ins Meeting schicken“** – und im Meeting den Bot aus dem Wartebereich einlassen (wie jeden Gast).

> **`DASHBOARD_PASSWORD` unbedingt setzen**, sobald die Site öffentlich erreichbar ist – jeder Bot-Start kostet Geld.

### Lokale Entwicklung

```bash
cp .env.example .env   # Keys eintragen
npm install
npm run dev            # Dashboard: http://localhost:8888
```

Das Dashboard läuft dann auf `http://localhost:8888`. **Aber:** Der Recall-Bot muss die Agent-Seite aus dem Internet laden können. Für lokale Tests brauchst du daher einen Tunnel (z. B. [ngrok](https://ngrok.com)):

```bash
ngrok http 8888
# dann in .env: PUBLIC_BASE_URL=https://<deine-subdomain>.ngrok-free.app
```

Am einfachsten testet man direkt gegen ein Netlify-Deployment (`npx netlify deploy --prod`).

## Bedienung

1. **Meeting-URL** – der Google-Meet- oder Teams-Link, den du erhalten hast (`meet.google.com`, `teams.microsoft.com` oder `teams.live.com`).
2. **Bot-Name** – so erscheint der Bot in der Teilnehmerliste (z. B. „Alex (Assistenz Tobias)“).
3. **Ziel** – was der Bot herausfinden soll.
4. **Vordefinierte Fragen** – eine pro Zeile; der Bot arbeitet sie gesprächsnatürlich ab.
5. **Wissen & erlaubte Antworten** – nur das darf der Bot über dich preisgeben. Alles andere blockt er höflich ab („Das klärt Tobias gerne persönlich“).
6. **Wertigkeits-Kriterien** – danach entscheidet der Bot, ob er ein Follow-up empfiehlt.

Der Bot verabschiedet sich selbstständig und verlässt das Meeting, sobald seine Fragen beantwortet sind (oder nach spätestens 90 Minuten). Anschließend erscheint der Bericht im Dashboard: Score 1–10, Empfehlung (**Follow-up / ablehnen / unklar**), Zusammenfassung, Angebotsbeschreibung, nächste Schritte, offene Fragen und das komplette Transkript.

## Projektstruktur

```
public/
  index.html, app.js, styles.css   # Dashboard (deutsch)
  agent.html, agent.js             # Agent-Seite, die der Bot im Meeting rendert
netlify/functions/
  sessions.mts                     # Dashboard-API: anlegen, Liste, Details, leave, Bericht
  agent.mts                        # Agent-API: Realtime-Token, Transkript-Events, leave
  report-background.mts            # Berichtserstellung als Background Function
netlify/lib/
  prompt.mts                       # System-Prompt & Tool-Definitionen für die Sprach-KI
  recall.mts                       # Recall.ai-Client (Bot anlegen, Status, verlassen)
  report.mts                       # Abschlussbericht via OpenAI (Structured Output)
  store.mts                        # Persistenz via Netlify Blobs
  http.mts, types.mts              # Auth, Helpers, Typen
```

## Konfiguration

**Dev-Tab:** API-Keys müssen nicht zwingend in die Server-Umgebung. Im Dashboard gibt es den Tab **Dev**, in dem Recall.ai-Key, Region und OpenAI-Key session-basiert hinterlegt werden können (localStorage des Browsers). Sie werden bei jedem API-Aufruf als Header mitgeschickt und beim Meeting-Start serverseitig für die jeweilige Session gespeichert (nötig für die Agent-Seite und den Bericht). Browser-Keys haben Vorrang vor Umgebungsvariablen. Für den Produktivbetrieb sind Netlify-Umgebungsvariablen die sicherere Wahl.

Alle Variablen in [`.env.example`](.env.example). Die wichtigsten:

| Variable | Standard | Beschreibung |
| --- | --- | --- |
| `RECALL_API_KEY` | – | Pflicht. Recall.ai-API-Key |
| `OPENAI_API_KEY` | – | Pflicht. OpenAI-API-Key |
| `RECALL_REGION` | `eu-central-1` | Region des Recall-Keys |
| `RECALL_BOT_VARIANT` | `web_4_core` | `web` ist billiger, kann aber ruckeln |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | Sprachmodell im Meeting |
| `OPENAI_REPORT_MODEL` | `gpt-5-mini` | Modell für den Abschlussbericht |
| `DASHBOARD_PASSWORD` | – | Schützt das Dashboard (dringend empfohlen) |

## Rechtliches & Transparenz

- Der Bot ist bewusst so instruiert, dass er sich zu Beginn **als KI-Assistent vorstellt** und sagt, dass das Gespräch protokolliert wird. Wenn er gefragt wird, ob er eine KI ist, bestätigt er das ehrlich.
- In Deutschland (und vielen anderen Ländern) ist das heimliche Mitschneiden von Gesprächen strafbar (§ 201 StGB). Die Offenlegung ist also nicht nur fair, sondern notwendig. Bitte nicht entfernen.
- Der Bot trifft keine Zusagen, Käufe oder Terminvereinbarungen in deinem Namen.

## Bekannte Grenzen (MVP)

- Google Meet und Microsoft Teams (Recall.ai unterstützt auch Zoom/Webex – die `createBot`-Konfiguration in `netlify/lib/recall.mts` wäre dafür leicht erweiterbar).
- Der Gastgeber muss den Bot aus dem Wartebereich/der Lobby einlassen (normales Gast-Verhalten bei Meet und Teams).
- Persistenz über Netlify Blobs (einfache JSON-Dokumente). Für viele parallele Meetings/Team-Nutzung wäre Netlify Database (Postgres) der nächste Schritt.
- Keine Kalender-Integration – Meetings werden manuell per URL gestartet.
