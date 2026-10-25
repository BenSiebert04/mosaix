# End-to-End-Test des Call-Layouts

Echter Anruf mit drei Teilnehmern (headless Chromium mit Fake-Kamera,
-Mikrofon und -Bildschirm) gegen ein lokales MatrixRTC-Backend:

- **Synapse** (pip, `localhost:8448`, Registrierung offen, nur lokal)
- **LiveKit SFU** und **lk-jwt-service** (feste Release-Versionen, Checksummen geprüft)
- **Element Call** dieses Repositorys als Standalone-Build

Kein Teil davon berührt einen echten Homeserver; alle Daten liegen in
`e2e/.work` (Wegwerf-Umgebung, nur Linux x64).

```sh
cd element-call && pnpm install --frozen-lockfile && cd ..
e2e/setup.sh      # einmalig: Downloads, Synapse-Konfiguration, Element-Call-Build
e2e/start.sh      # Backend starten
node e2e/call-layout.e2e.mjs   # Test 1: Element Call standalone (Screenshots in e2e/results/)
node e2e/call-features.e2e.mjs # Test 1b: Transparenz, Ebenen, Lautstärke 200 %, Hinweis
node e2e/screenshare-modes.e2e.mjs # Test 1c: Bildschirmfreigabe Lesbarkeit / Highspeed
node e2e/popout.e2e.mjs        # Test 1d: Pop-outs (eigenes Fenster, läuft im Hintergrund weiter)
node scripts/prepare-webapp.mjs --from <Element-Web-Build>  # Webapp wie in der Desktop-App (docs/UPDATING.md)
node e2e/element-web.e2e.mjs   # Test 2: echte Element-Web-App mit unserem Widget
node e2e/private-voice.e2e.mjs # Test 3: Private Voice in der echten Element-Web-App
node e2e/volume-cycles.e2e.mjs # Test 4: Lautstärke/stumm über die Zeit, gemessen am Abgespielten
e2e/stop.sh
```

Geprüft wird aus Sicht der dritten Teilnehmerin, während zwei Personen
gleichzeitig ihren Bildschirm teilen:

1. Beide Screenshares sind gleichzeitig groß nebeneinander sichtbar und
   spielen Video, die Kameras klein darunter.
2. Kamera und Screenshare derselben Person lassen sich getrennt ausblenden.
3. Ist alles ausgeblendet, kommt **kein Video** mehr an (WebRTC-Statistik
   `inbound-rtp`), **Audio** wird weiter empfangen und abgespielt.
4. Preset „Zwei Streams“, Kameras aus, Trennlinie per Maus auf 70/30.
5. Ein Teilnehmer verlässt den Anruf; der verbleibende Stream übernimmt die Fläche.
6. „Auf Standardansicht zurücksetzen“ stellt Element Calls Ansicht wieder her.

Test 2 nutzt die ausgelieferte Webapp (offizielles Element Web + unser
Widget, genau wie in `webapp.asar`): drei Nutzer melden sich über Element Web
an, tauschen in einem **verschlüsselten** Raum eine Nachricht aus, starten
über die Raum-Kopfzeile einen Gruppenanruf und zwei teilen den Bildschirm.
Geprüft werden Nachrichtenzustellung, zwei große Screenshares, Position der
Bedienleiste und die raumbezogene Speicherung im Profil.

Hinweis: Synapse läuft hier mit Raumversion 10 als Standard, weil die
Raumerstellung im Standalone-Modus von Element Call 0.26 mit Raumversion 12
nicht kompatibel ist. In der Desktop-App erstellt Element Web den Raum, dort
betrifft das nicht.

## Test 3: Private Voice

`private-voice-setup.py` legt auf dem lokalen Synapse einen Space mit vier
Kategorie-Unterspaces, verwalteten Text- und Sprachräumen, einem
unverwalteten Raum und einem Direktchat an (synthetische Daten). Der Test
meldet sich über Element Web an, schreibt die Konfiguration dann – wie die
Serverseite – in die Account-Daten und prüft die gerenderte Oberfläche:

1. Ohne Konfiguration: normale Ansicht, Anruf-Buttons vorhanden.
2. Konfiguration kommt live an: vier Kategorien in Manifest-Reihenfolge,
   jeder Raum genau einmal mit konfiguriertem Namen.
3. Verwalteter Textraum: keine (auch keine ausgegrauten) Anruf-Buttons,
   Verlauf von vorher sichtbar, Nachrichten senden geht, „Discord: Text“.
4. Verwalteter Sprachraum: Lobby, kein automatischer Beitritt; nach Beitritt
   laufen Kamera und Bildschirmfreigabe.
5. Unverwalteter Direktchat: Sprach- und Videoanruf-Buttons aktiv.
6. Konfiguration entfernt: normale Ansicht zurück, Verlauf erhalten.

Screenshots: `e2e/results/private-voice-*.png`.

### Mit der echten Desktop-App

`element-web-volume.e2e.mjs` und `volume-cycles.e2e.mjs` können Ben in der
echten Mosaix-Desktop-App laufen lassen (Element-Desktop-Checkout mit
`node scripts/prepare-desktop.mjs`, gebaut mit `tsc`, Web-App unter
`apps/desktop/webapp`, `config.json` auf `http://localhost:8008`). Die App
als normaler Benutzer (nicht root, wegen der Sandbox) starten:

```sh
electron . --profile-dir /tmp/mosaix-ben --remote-debugging-port=9333 \
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
  --password-store=basic --storage-mode=force-plaintext
BEN_CDP=http://localhost:9333 node e2e/volume-cycles.e2e.mjs
```
