# Portfolix

Ein Windows-Desktop-Programm (Electron), das deine **Portfolio-Performance-Daten**
(`MyInvestments.xml`) auswertet: Bestände, Trades, Käufe, Konten, Performance –
inklusive **Echtzeitkursen von Yahoo Finance** und **automatischer Einspeisung
fälliger Sparpläne**.

![Ansicht: Dashboard, Wertpapiere, Transaktionen, Sparpläne, Konten]

## Starten

Doppelklick auf **`start.bat`** – oder im Terminal:

```bat
npm install        REM nur beim ersten Mal
npm start
```

> Falls beim Start der Fehler „Cannot read properties of undefined (reading 'getPath')"
> erscheint, ist in deiner Umgebung die Variable `ELECTRON_RUN_AS_NODE` gesetzt.
> `start.bat` löscht sie automatisch; im Terminal: `set ELECTRON_RUN_AS_NODE=` vor `npm start`.

## An Freunde verteilen – mit automatischen Updates

Portfolix wird als **Windows-Installer (.exe)** über **GitHub Releases**
verteilt. Installierte Apps prüfen beim Start automatisch auf neue Versionen,
laden sie im Hintergrund und installieren sie beim nächsten Schließen
(electron-updater). Deine Freunde müssen die Website also nur **einmal** besuchen.

### Einmalige Einrichtung

1. Lege auf GitHub ein Repository **`portfolix`** unter deinem Account
   `simon23-12` an (öffentlich oder privat – für öffentlichen Auto-Update-Download
   am einfachsten **öffentlich**).
2. Lade dieses Projekt hoch (deine persönliche `MyInvestments.xml` ist durch
   `.gitignore` ausgeschlossen und wird **nicht** mitgeladen):
   ```bat
   git init
   git add .
   git commit -m "Portfolix"
   git branch -M main
   git remote add origin https://github.com/simon23-12/portfolix.git
   git push -u origin main
   ```

### Eine neue Version veröffentlichen

Zwei Wege – beide laden Installer **und** Update-Infos (`latest.yml`) automatisch hoch:

**A) Automatisch über GitHub Actions (empfohlen)** – nichts lokal bauen:
```bat
REM 1) Versionsnummer erhöhen (schreibt package.json + erstellt Git-Tag v1.0.1)
npm version patch
REM 2) Code + Tag pushen -> GitHub baut Windows und veröffentlicht das Release
git push --follow-tags
```
Der Workflow `.github/workflows/release.yml` baut auf `windows-latest` und
veröffentlicht das Release. (Nutzt den automatischen `GITHUB_TOKEN`, kein
zusätzlicher Schlüssel nötig.)

**B) Lokal von deinem Windows-PC:**
```bat
set GH_TOKEN=dein_github_personal_access_token   REM Token mit "repo"-Recht
npm version patch
npm run release
```

> Wichtig: Die Version in `package.json` und der Git-Tag müssen übereinstimmen –
> `npm version patch` erledigt beides automatisch.

### Download-Website (GitHub Pages)

Im Ordner **`docs/`** liegt eine fertige, professionelle Landingpage
(`docs/index.html`) mit App-Vorschau und Download-Button – genau das, was du
deinen Freunden schickst.

**Aktivieren:** Repo → *Settings* → *Pages* → *Build and deployment* →
*Source: Deploy from a branch* → Branch **`main`**, Ordner **`/docs`** → *Save*.
Nach ein paar Minuten ist sie erreichbar unter:

```
https://simon23-12.github.io/portfolix/
```

Der Download-Button zeigt auf den **festen** Dateinamen, der immer die neueste
Version lädt (deshalb ist `nsis.artifactName` in `package.json` auf
`Portfolix-Setup.exe` gesetzt):

```
https://github.com/simon23-12/portfolix/releases/latest/download/Portfolix-Setup.exe
```

Die Seite zeigt außerdem automatisch die aktuelle Versionsnummer an (per
GitHub-API) und enthält bereits den SmartScreen-Hinweis für unerfahrene Nutzer.
Nach der ersten Installation aktualisiert sich die App ohnehin selbst.

### Nur lokal bauen (ohne Veröffentlichen)

```bat
npm run dist
```
Erzeugt den Installer unter `dist/` zum manuellen Weitergeben.

### Hinweise

- **SmartScreen:** Ohne Code-Signatur-Zertifikat zeigt Windows beim ersten Start
  „Unbekannter Herausgeber" → *Weitere Informationen* → *Trotzdem ausführen*.
  Updates funktionieren trotzdem. Ein Zertifikat (~150–300 €/Jahr) entfernt die Warnung.
- **Kein Admin nötig:** Der Installer ist als Per-User-Installation konfiguriert.
- **App-Icon:** Aktuell wird das Standard-Electron-Icon genutzt. Lege optional eine
  `build/icon.ico` (256×256) an und ergänze in `package.json` unter `build.win`
  die Zeile `"icon": "build/icon.ico"`.

## Zwei Wege zu starten

Beim **ersten Start** wählst du:

1. **Neues Portfolio anlegen** – komplett bei Null. Du wählst deine Anlageklassen
   (Aktien, ETFs, Krypto inкл. NFTs, Tagesgeld, Immobilien) und ab wann du investierst,
   und trägst dann deine Käufe/Verkäufe/Dividenden manuell oder per Sparplan ein.
   Für handelbare Assets lädt Portfolix die Kurshistorie automatisch von Yahoo.
2. **Portfolio-Performance importieren** – bestehende `.xml` einlesen (read-only).

Das eigene Portfolio wird lokal in `portfolix-portfolio.json` (im Nutzerdatenordner)
gespeichert. Über **„+ Hinzufügen"** (oben rechts) lassen sich jederzeit Assets,
Buchungen, Sparpläne und Konten ergänzen.

### Datenmodell bei „Neues Portfolio"

- Ein **Kauf** bucht standardmäßig zusätzlich eine **Einzahlung** in gleicher Höhe
  (= frisches Kapital), damit „Eingezahlt" und „Gesamtvermögen" stimmen. Wer Erlöse
  reinvestiert, entfernt den Haken „Betrag frisch eingezahlt".
- **Manuelle Assets** (Immobilie, NFT, Sonstiges) werden ohne Live-Kurs geführt;
  ihren aktuellen Wert pflegst du über die Buchung **„Wertanpassung"**.

## Funktionen

- **Dashboard** – Gesamtvermögen, Gewinn/Verlust, eingezahltes Kapital, Dividenden,
  Liquidität; historische Wertkurve (Depotwert vs. eingezahlt) und Aufteilungs-Donut.
- **Wertpapiere** – alle Positionen mit Live-Kurs, Tagesveränderung, Wert,
  Ø-Kaufkurs, Buchgewinn und Portfolioanteil; dazu geschlossene Positionen mit
  realisiertem Gewinn/Verlust.
- **Transaktionen** – alle Käufe, Verkäufe, Dividenden, Ein-/Auszahlungen und
  Überträge mit Volltextsuche und Filtern.
- **Sparpläne** – erkennt fällige Ausführungen und **bucht sie automatisch** als
  Käufe (siehe unten).
- **Konten** – Salden aller Konten (DKB Cash, Trade Republic, Bsdex, Kraken …) und Depots.
- **Privatsphäre-Modus** – Button „Zahlen verbergen" in der Kopfzeile (oder **Strg+H**)
  maskiert für Screenshots alle €-Beträge und Stückzahlen (inkl. Chart-Achse). Sichtbar
  bleiben nur Prozentwerte und börsliche Kurse pro Stück (öffentliche Marktdaten). Der
  Zustand wird gespeichert.

## Echtzeitkurse (Yahoo Finance)

Beim Start und über **„Kurse aktualisieren"** werden Live-Kurse geladen
(kein API-Key nötig). Nicht jedes in der XML hinterlegte Kürzel ist ein gültiges
Yahoo-Symbol. Unter **Wertpapiere → Kursquellen** kannst du das Yahoo-Symbol je
Wertpapier anpassen (z. B. `VWCE.DE`, `TSLA`, `BTC-EUR`, `ANIC.L`). Ohne gültiges
Symbol nutzt Portfolix den **letzten in der XML gespeicherten Kurs** – der Wert
wird also immer angezeigt, nur eben nicht „live".

Fremdwährungen werden automatisch nach EUR umgerechnet (Yahoo-FX-Kurse), inkl.
korrekter Behandlung von **GBp/GBX** (britische Pence, z. B. Agronomics).

## Automatische Sparpläne

Für jeden Sparplan mit `autoGenerate=true` ermittelt Portfolix die seit der
**letzten echten Ausführung** fällig gewordenen Termine (Intervall × Betrag),
holt den passenden Kurs und legt automatisch eine **Kauf-Buchung** an
(Stückzahl = (Sparrate − Gebühr) ÷ Kurs).

- Diese Buchungen sind in Transaktionen mit dem Tag **`auto`** markiert.
- Sie werden lokal gespeichert (`portfolio-store.json` im Nutzerdatenordner) und
  fließen in Bestände, Cash-Salden und Charts ein.
- **Deine Original-`MyInvestments.xml` wird nicht verändert.** So bleibt die
  Quelle unangetastet und Portfolio Performance funktioniert weiter normal.

## Datenhinweise / Grenzen

- **Aktiensplits** (z. B. Tesla) und **Reverse-Splits** (Penny-Stocks wie Cult Food)
  werden nicht nachträglich auf alte Buchungen angewendet – die Stückzahlen stammen
  direkt aus den Transaktionen der XML. In der Regel sind sie dort bereits korrekt;
  bei einzelnen Titeln kann die Stückzahl abweichen.
- Die historische Wertkurve nutzt die in der XML gespeicherten Kurse (monatliche
  Stützstellen) und heutige FX-Raten.

## Projektstruktur

| Datei | Zweck |
|-------|-------|
| `main.js` | Electron-Hauptprozess: Fenster, Datei-IO, Yahoo-Abruf (umgeht CORS), Auto-Update |
| `docs/index.html` | Download-Landingpage für GitHub Pages |
| `.github/workflows/release.yml` | Baut & veröffentlicht Windows-Release bei `v*`-Tag |
| `start.bat` | Startet die App lokal (umgeht `ELECTRON_RUN_AS_NODE`) |
| `preload.js` | sichere Bridge (contextIsolation) |
| `src/ppparser.js` | Portfolio-Performance-XML-Parser (löst XStream-`reference`-Verweise via XPath auf) |
| `src/model.js` | Berechnungen: Bestände, G/V, Cash, Wertkurve, FX, Yahoo-Symbol-Mapping |
| `src/savingsplan.js` | Sparplan-Engine (Fälligkeit, Auto-Buchung) |
| `src/builder.js` | Erstellt/bearbeitet ein natives Portfolio (ohne PP-XML) |
| `src/app.js` | UI-Steuerung & Rendering |
| `src/index.html`, `src/styles.css` | Oberfläche |
| `test/verify.js`, `test/integration.js` | Headless-Prüfung der Parser-/Rechenlogik (`node test/integration.js`) |
```
