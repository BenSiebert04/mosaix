# Tests und bekannte Einschränkungen

## Automatisierte Tests

| Ebene | Wo | Läuft in CI | Inhalt |
| --- | --- | --- | --- |
| Geometrie | `element-call/src/custom-layout/computePlacements.test.ts` | ja | alle Presets, 2 Screenshares nebeneinander, 70/30, 2×2, Seitenleiste, Ausblenden, Pinning, Maximieren, Fenstergrößen (1920×1080, halber Bildschirm 960×1040, klein), keine Überlappungen, freie Positionen skalieren |
| ViewModel/Speicherung | `CustomLayoutViewModel.test.ts` | ja | Ausblenden (Kamera/Screenshare getrennt, ganze Person), „Alle Kameras“, Teilnehmer geht/kommt, Drag-Tausch, Teiler/Resize, Standardansicht wiederherstellen, raumweise Speicherung + Raumwechsel, benannte Layouts, globaler Standard, defekte gespeicherte Daten |
| Komponenten | `CustomLayoutView.test.tsx` | ja | Rendering mit 2 Screenshares, 2×2, ohne Screenshare, Ausblenden per Kachel-Leiste, „Alle einblenden“, Drag & Drop (Tausch), Verschieben + Größenänderung freier Kacheln mit der Maus, Teiler ziehen (70/30), Doppelklick-Maximieren, Fenstergröße ändern, Teilnehmer kommt/geht; Panel: Liste, getrennt ausblenden, Presets, Speichern/Laden, Zurücksetzen |
| Integration | `element-call/src/room/InCallView.test.tsx` | ja | eigenes Layout ersetzt das Grid, **ausgeblendete Person bleibt hörbar** (Audio-Renderer unverändert), Panel aus der Fußleiste, Standardansicht vollständig wiederhergestellt |
| Upstream Element Call | alle übrigen Element-Call-Unit-Tests | ja | Regressionstest der unveränderten Anruf-Logik |
| Upstream Element Desktop | Unit-Tests von `apps/desktop` (v1.12.32) | ja | Regressionstest Desktop-Hauptprozess mit unserem Branding |
| End-to-End | `e2e/call-layout.e2e.mjs` | nein (lokal, Linux) | echter Anruf über LiveKit mit 3 Browsern und 2 Screenshares |
| Lautstärke/Ebenen | `MatrixAudioRenderer.test.tsx` (stumm wird nach jedem Neuaufbau der Audiokette erneut gesetzt), `volumeStorage.test.ts`, `CustomLayoutView.test.tsx`, `CustomLayoutViewModel.test.ts`, `computePlacements.test.ts` | ja | Speicherung pro Person (0–200 %, defekte Daten), Übernahme nach Tastatur-Eingabe, Begrenzung auf 100 % solange kein Web Audio, Ebenen vor „nach vorn holen“, Transparenz, Menüeinträge, Hinweis „n ausgeblendet“ nur 5 s nach Mausbewegung |
| App-Ton (Desktop) | `apps/desktop/src/screenShareAudio.test.ts` (Desktop-Patch) | ja | Ton nur unter Windows und nur auf Anforderung, Rückfall auf Systemton bei altem Windows, nichts bei abgebrochener Auswahl oder Mosaix-Fenster |
| App-Ton (Logik) | `desktop/app-audio/test/logic.test.mjs` | ja | Fenster → nur diese App, Bildschirm → alles außer Mosaix, Mosaix-Fenster → nichts; Jitter-Puffer des Players |
| App-Ton (Windows, echt) | `desktop/app-audio/test/native.test.mjs`, `electron.test.mjs` | ja (Windows-Runner mit virtueller Soundkarte) | zwei Apps spielen 440/880 Hz mit Pegel 0,5, die Test-App selbst 660 Hz (= Anruf): Fenster geteilt → nur 440 Hz; Bildschirm geteilt → 440 und 880 Hz, aber nicht 660 Hz; gemessen in 100-ms-Blöcken: Pegel ≥ 0,35, Stereo, Töne ≥ 90 % des Signals (kein Rauschen, kein Knacken), Jitter-Puffer ohne Aussetzer; Aufnahme endet mit der Freigabe; include/exclude auch für PlaySound-Prozesse |
| App-Ton (Player) | `desktop/app-audio/test/logic.test.mjs` | ja | 100 ms Vorlauf, Obergrenze 400 ms, Leerlaufen, Ausgleich schnellerer/langsamerer Aufnahme ohne Sprünge |
| Lautstärke über die Zeit | `e2e/volume-cycles.e2e.mjs` | nein (lokal) | gemessen am tatsächlich Abgespielten (Ausgang/Eingang): drei Runden 50 % → stumm → wieder an → 200 % → 100 %, dazwischen Layoutwechsel, Anna schaltet ihr Mikro aus/an während Ben sie stumm bzw. auf 200 % hat, anderes Ausgabegerät während stumm, Anna verlässt den Anruf und kommt zurück; im Browser und mit `BEN_CDP` in der echten Desktop-App |
| Lautstärke in der App | `e2e/element-web-volume.e2e.mjs` | nein (lokal) | eingebetteter Anruf in Element Web bzw. mit `BEN_CDP` in der echten Desktop-App: 200 %, leiser und „Für mich stumm“ ändern die Verstärkung von Annas Stimme (2 / < 2 / 0) |
| Freigabe-Ton beim Empfänger | `e2e/screenshare-audio.e2e.mjs` | nein (lokal) | Ton einer Freigabe kommt als eigene Spur an, 200 % und „Für mich stumm“ wirken nur darauf, nicht auf die Stimme |
| Bildschirmfreigabe-Modi | `screenShareMode.test.tsx` | ja | Freigabe-Ton ohne Sprachverarbeitung in Stereo angefordert und als Musik ohne DTX gesendet, Optionen je Modus, Wechsel während der Freigabe (Hinweis, Auflösung, Degradation, nur oberste Simulcast-Ebene), unbekannte gespeicherte Werte, Auswahlmenü |
| End-to-End | `e2e/screenshare-modes.e2e.mjs` | nein (lokal, Linux) | echte Freigabe: Highspeed sendet 60 fps mit `maintain-framerate`, Wechsel auf Lesbarkeit ohne neue Bildschirmauswahl ergibt volle Auflösung, `maintain-resolution`, 8 Mbit/s nur auf der großen Ebene |
| Pop-outs | `popout.test.ts`, `Popouts.test.tsx` | ja | Fensternamen (sicher, eindeutig), Position/Größe pro Person und Art, defekte Daten, Pop-out endet mit dem Stream, Fenster blockiert/geschlossen, Video im Pop-out, Anmeldung bei LiveKit als sichtbar/Bild-im-Bild, Knöpfe, „immer im Vordergrund“ per IPC |
| Pop-outs (Desktop) | `apps/desktop/src/popouts.test.ts`, `webcontents-handler.test.ts` (Desktop-Patch) | ja | nur leere `mosaix-popout-…`-Fenster erlaubt, keine Navigation/weiteren Fenster, Rückholung auf den Bildschirm, „immer im Vordergrund“ auch vor dem Erzeugen angefordert |
| Pop-outs (Electron, echt) | `desktop/electron-tests/popout.mjs` | ja (Windows-Runner) | wie in Element Desktop (Sandbox, Kontext-Isolation, Widget-iframe mit Element-Web-Sandbox-Flags): iframe öffnet und befüllt das Fenster selbst, Rückholung auf den Bildschirm, `isAlwaysOnTop` an/aus, andere Fenster/URLs blockiert, keine Navigation, Schließen |
| End-to-End | `e2e/popout.e2e.mjs` | nein (lokal, Linux) | echter Anruf: Pop-out spielt Annas Video, Größe gemerkt, Schließen über Knopf, Menü und Verlassen des Anrufs; Anruffenster im Hintergrund: ohne Pop-out kommt kein Video, mit Pop-out weiter Video an |
| End-to-End | `e2e/call-features.e2e.mjs` | nein (lokal, Linux) | echter Anruf: Rechtsklick in der Standardansicht, Transparenz 40 % und Ebene, Lautstärke 200 % mit gemessener Verstärkung 2,0, nach erneutem Beitritt wieder 200 %, Hinweis verschwindet nach 5 s |
| End-to-End | `e2e/element-web.e2e.mjs` | nein (lokal, Linux) | ausgelieferte Webapp (Element Web + unser Widget), verschlüsselter Raum, Nachricht, Anruf aus der Raum-Kopfzeile |
| Private Voice | `element-web/overlay/apps/web/src/mosaix/private-voice/*.test.ts(x)` | ja | Parser (fehlend, ungültig, neuere Version, falsche user_id, unbekannte Felder, Unicode, Kategorie `null`, Duplikate, Room-IDs ohne Doppelpunkt), Store (initial + live, gleiche Revision, Kontowechsel/Abmeldung, Offline-Cache als „stale“, Entfernen nach erfolgreichem Sync, Homeserver-Beschränkung), Raumliste (Kategorien, Reihenfolge, keine Duplikate, Favoriten/eigene Abschnitte bleiben), Kopfzeile (keine Anruf-Buttons im Textraum, DM unverändert, Brücken-Kennzeichnung) |
| Upstream Element Web | Tests der geänderten Bereiche (Raumliste v3, Raumlisten-ViewModels, RoomHeader, RoomViewStore, Call) | ja | Regressionstest plus zusätzliche `[mosaix]`-Tests |
| Jam-Kanal | `element-web/overlay/…/mosaix/jam/jam.test.tsx` | ja | nur Spotify-Jam-Links (keine fremden Domains, kein `javascript:`), Titel als Text, State-Key `jam/<MXID>` (Besitzer auslesen, eigene/fremde/alte Keys), Korrekturen nur vom Prüfdienst aus dem Policy-Event, `checked_ts`/`ended_reason` nie vom Client, beendete/ungültige Einträge und Nicht-Mitglieder ausgeblendet, Live-Aktualisierung, Teilen/Beenden, Zähler in der Raumliste |
| End-to-End | `e2e/private-voice.e2e.mjs` | nein (lokal, Linux) | gerenderte Element-Web-App: vier Kategorien live, Jam-Kanal (laufender Jam mit Beitreten-Link, eigenen Jam teilen und beenden, Eintrag unter fremdem Key ignoriert, Prüfdienst beendet einen Jam, „♪ n live“), Textraum ohne Anruf-Buttons mit Verlauf, Sprachraum-Lobby + Kamera + Bildschirmfreigabe, DM mit Anruf-Buttons, Entfernen |

Zusätzlich wurde der fertige Windows-Build aus CI heruntergeladen und geprüft:
`webapp.asar` enthält das angepasste Element Call, `config.json` hat kein
`update_base_url`, `app.asar` trägt Name/App-ID/Protokoll von Mosaix.
Unter Linux wurde ein Testbuild derselben Konfiguration gestartet (Login-
Bildschirm erscheint, Profil in einem eigenen Ordner).

### Ergebnisse (Stand dieses Commits)

- Element Call Unit-Tests: **100 Testdateien, 829 Tests bestanden** (9 von Upstream übersprungen), davon 70+ neue Tests für das Layout.
- Element Desktop Unit-Tests: **20 Dateien, 216 Tests bestanden**.
- Typecheck (tsc), oxlint, knip: ohne Befund.
- E2E `call-layout`: bestanden. Gemessen mit WebRTC-Statistiken: alles
  ausgeblendet → **0 kB/s Video**, Audio weiter ~12 kB/s.
- E2E `element-web`: bestanden (verschlüsselte Nachricht, Anruf über Element
  Web, zwei Screenshares groß im eingebetteten Widget).
- GitHub Actions: Windows-Installer und ZIP gebaut.

### Was nicht getestet werden konnte

- **Kein Test auf einem echten Windows-11-Rechner.** Der Installer wird auf
  `windows-2025` gebaut, aber nicht ausgeführt. Bitte Installation, Start,
  Login und einen Anruf selbst prüfen.
- **Kein Test gegen deinen Homeserver** oder mit der Discord-Bridge. Element
  Web und die Matrix-Logik sind unverändert; die Bridge ist für Anrufe nicht
  beteiligt.
- Echte Bildschirmaufnahme unter Windows (Electron-Auswahldialog) wurde nicht
  getestet; sie ist unverändertes Upstream-Verhalten.
- Firefox/Safari spielen für die Desktop-App keine Rolle und wurden nicht
  getestet.

## Bekannte Einschränkungen

- **Unsigniert:** SmartScreen-Warnung beim ersten Start (siehe INSTALL.md).
- **Nur Gruppenanrufe über Element Call.** Alte 1:1-Anrufe (legacy WebRTC,
  `m.call.*`) und Jitsi-Konferenzen nutzen eine eigene Oberfläche und haben
  das neue Layout nicht.
- **Lautstärke über 100 %** braucht die Wiedergabe über Web Audio, die dem
  gewählten Ausgabegerät folgen kann (Chromium, also die Desktop-App). Wo das
  nicht geht, ist bei 100 % Schluss; der eingestellte Wert bleibt gespeichert.
- **Ton beim Bildschirm-Teilen** gibt es nur in der Desktop-App unter Windows
  (ab 10 2004). Getestet auf dem Windows-CI-Runner mit virtueller Soundkarte,
  nicht auf einem echten PC. Apps, deren Fenster einem anderen Prozess gehört
  als ihr Ton (manche Store-/UWP-Apps), können beim Fenster-Teilen stumm
  bleiben; dann den Bildschirm teilen.
- **Bildschirmfreigabe-Modi** legen fest, was bei knapper Bandbreite oder
  Rechenleistung zuerst nachgibt. Mehr senden als die Verbindung hergibt
  können sie nicht. Sind in den Entwicklereinstellungen von Element Call
  eigene Freigabe-Werte aktiv, gelten diese statt des Modus.
- **Ein Screenshare pro Gerät:** Element Call/LiveKit erlaubt je Teilnehmer-
  Gerät nur eine Bildschirmfreigabe. Mehrere Screenshares gleichzeitig kommen
  also von verschiedenen Personen bzw. Geräten – dafür ohne Begrenzung.
- **Bild-im-Bild/PiP:** Wird der Anruf in Element Web minimiert (kleines
  Fenster), zeigt Element Call weiterhin seine eigene PiP-Ansicht.
- **Ressourcen:** Ausgeblendete und durch Maximieren verdeckte Videos werden
  nicht empfangen (LiveKit adaptive stream). Viele große, gleichzeitig
  sichtbare Videos brauchen entsprechend Bandbreite und Dekodierleistung –
  das ist gewollt, aber zu beachten.
- **Ausgeblendet = lokal:** Die Einstellung gilt nur für dieses Gerät/Profil;
  sie wird nicht zwischen Geräten synchronisiert.
- **Teilnehmer-Schlüssel:** Ausblenden/Positionen werden pro Gerät des
  Teilnehmers gespeichert (`@nutzer:server:GERÄT`). Tritt jemand mit einem
  neuen Gerät bei, erscheint er zunächst wieder sichtbar.
- **Sprache:** Die neuen Texte gibt es auf Deutsch und Englisch; andere
  Sprachen zeigen Englisch.
- **Element-Branding in der Oberfläche:** Element Web selbst ist unverändert,
  daher erscheinen im Login-Bildschirm weiterhin Element-Logos/-Texte.
- **Lokale Entwicklung in der Cloud-Sandbox:** Hier war `codeload.github.com`
  gesperrt; `matrix-js-sdk` musste lokal gebaut und eingehängt werden. In
  GitHub Actions und auf normalen Rechnern ist das nicht nötig.
