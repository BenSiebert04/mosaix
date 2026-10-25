# Architektur von Mosaix

## Ausgangslage: Wo werden Anrufe gerendert?

Element Desktop (Electron, `apps/desktop` im Monorepo
[element-hq/element-web](https://github.com/element-hq/element-web)) lädt
Element Web als `webapp.asar`. Element Web wiederum rendert **Gruppenanrufe
nicht selbst**: Sie laufen in **Element Call**, das als Widget (iframe) unter
`widgets/element-call/` mitgeliefert wird. Diese Kopie stammt aus dem npm-Paket
`@element-hq/element-call-embedded` (bei Element Web v1.12.32: Version 0.26.0)
und wird beim Build von Element Web in die Webapp kopiert
(`apps/web/webpack.config.ts`, CopyWebpackPlugin).

Die gesamte Anrufoberfläche – Kacheln, Spotlight/Grid, Screenshares,
Teilnehmerliste – ist also Element-Call-Code:

| Bereich                         | Datei (Element Call)                                   |
| ------------------------------- | ------------------------------------------------------ |
| Anrufansicht, Header, Footer    | `src/room/InCallView.tsx`                              |
| Zustand, Medienlisten, Layouts  | `src/state/CallViewModel/CallViewModel.ts`             |
| Layout-Typen (grid, spotlight…) | `src/state/layout-types.ts`, `src/grid/*`              |
| Kacheln                         | `src/tile/GridTile.tsx`, `SpotlightTile.tsx`, `MediaView.tsx` |
| Medien-ViewModels               | `src/state/media/*` (User-Media, Screenshare)          |
| Audio                           | `src/livekit/MatrixAudioRenderer.tsx` (getrennt von den Kacheln!) |

Im Standard-Element-Call landen **alle Screenshares im einen Spotlight-Bereich**
und werden dort als Karussell nacheinander gezeigt – deshalb kann man zwei
Screenshares nicht nebeneinander sehen.

Seit kurzem gibt es zusätzlich ein Labs-Flag `feature_element_call_react`, mit
dem Element Web Element Call als React-Komponente einbindet. Standard ist aber
weiterhin das iframe-Widget, und dieses passen wir an.

## Entscheidung: Wo wird geändert?

- **Call-Layout:** vollständig in Element Call (git subtree, siehe unten).
- **Private Voice** (Raumliste, Kopfzeile, Lobby; siehe
  [PRIVATE_VOICE.md](PRIVATE_VOICE.md)): in Element Web. Die Modul-API von
  Element Web reicht dafür nicht (keine Raumlisten-Abschnitte, keine
  Anruf-Buttons pro Raum). Element Web wird deshalb **aus dem Quellcode** des
  Tags in `upstream.json` gebaut, mit unseren Änderungen (siehe
  [Element Web](#element-web)). Der Ordner `widgets/element-call/` wird
  danach durch unseren Element-Call-Build ersetzt und eine eigene
  `config.json` hinzugefügt.
- **Element Desktop** wird aus dem offiziellen Tag gebaut, mit einer kleinen
  Änderung (`element-web/patches-desktop/`, von `scripts/prepare-desktop.mjs`
  angewendet): Fordert der Anruf beim Bildschirm-Teilen Ton an, fügt Mosaix
  unter Windows den passenden Ton hinzu (siehe unten, App-Ton).

## App-Ton beim Bildschirm-Teilen (Windows)

Electron kann einer Bildschirmfreigabe nur den kompletten Systemton
(`loopback`) oder den Ton eines eigenen WebContents hinzufügen. Daher
`desktop/app-audio/`:

- **Natives Modul** (`src/app_audio.cc`, N-API): nimmt per Windows *Process
  Loopback* (ab Windows 10 2004) den Ton eines Prozessbaums auf –
  `include` (nur diese Anwendung) oder `exclude` (alles außer ihr).
- **`lib/index.cjs`**: Fenster geteilt → `include` mit dem Prozess des
  Fensters; Bildschirm geteilt → `exclude` mit Mosaix selbst; Mosaix-Fenster
  → kein Ton. Die Aufnahme wird in einem unsichtbaren Player-Fenster
  abgespielt (AudioWorklet), und genau dieses Fenster gibt Electron als
  Tonquelle der Freigabe an (`audio: webFrameMain`). Während es aufgenommen
  wird, ist es lokal stumm.
- **Sandbox:** Element Desktop sandboxt jeden Renderer (`app.enableSandbox()`),
  auch das Player-Fenster. Dessen Preload darf daher keine Dateien lesen; den
  Code des Worklets schickt der Hauptprozess zusammen mit dem MessagePort.
  Der Windows-Test läuft ebenfalls mit Sandbox.
- **Jitter-Puffer** (`lib/player-worklet.js`): Die Aufnahme kommt über den
  Hauptprozess, dessen Ereignisschleife kurz hängen kann, und ihr Takt ist
  nicht der des Players. Start nach 100 ms Puffer; über 160 ms wird pro
  128 Samples eines ausgelassen, unter 60 ms eines doppelt gespielt
  (unhörbar statt Knacken); nur im Notfall Stille bzw. Verwerfen über 400 ms.
- **Ton wie er ist:** Element Call fordert den Freigabe-Ton ohne
  Sprachverarbeitung an (`echoCancellation`, `noiseSuppression`,
  `autoGainControl` aus, Stereo). Sonst behandelt Chromium ihn wie ein
  Mikrofon: Mono, Rauschunterdrückung und Pegelautomatik machen aus Musik
  und Spielton pumpendes Rauschen. Gesendet wird er als Musik
  (`musicHighQualityStereo`, 128 kbit/s Stereo, ohne DTX, das Pausen durch
  Komfortrauschen ersetzt).
- **Ende:** Element Call meldet das Ende der Freigabe über die IPC-Brücke von
  Element Web (`mosaixScreenShareStopped`); zusätzlich endet die Aufnahme,
  sobald das Player-Fenster nicht mehr aufgenommen wird oder der Anruf weg
  ist.
- Ohne Process Loopback (älteres Windows) bleibt der komplette Systemton.
- Ausgeliefert als `resources/app-audio` (außerhalb von `app.asar`).
  Branding (Name, App-ID, Protokoll, Icon) erfolgt über den vorgesehenen
  Mechanismus „Variant“ (`VARIANT_PATH`) und zusätzliche Dateien. Die
  Windows-Paketierung überschreibt nur die `win`/`nsis`-Einstellungen in einer
  eigenen electron-builder-Konfiguration, die die Upstream-Konfiguration
  importiert.

## Element Web

Unsere Änderungen an Element Web liegen nicht als Fork, sondern als

- `element-web/overlay/` – neue Dateien (`apps/web/src/mosaix/…`), werden
  unverändert in den Checkout kopiert, und
- `element-web/patches/mosaix.patch` – kleine Eingriffe in bestehende Dateien,
  jeweils mit `[mosaix]` markiert.

`node scripts/element-web.mjs apply <checkout>` wendet beides auf einen
frischen Checkout des Tags an; `… export <checkout>` schreibt Änderungen aus
einem Entwicklungs-Checkout zurück (Paketdateien und Lockfile nie).

| Datei (in `apps/web/src`)                                   | Änderung |
| ----------------------------------------------------------- | -------- |
| `stores/room-list-v3/section.ts`                            | Kategorien des aktiven Spaces als Abschnitte einfügen |
| `stores/room-list-v3/skip-list/filters/SectionFilter.ts`    | Raum → Kategorie-Abschnitt (persönliche Tags haben Vorrang) |
| `stores/room-list-v3/RoomListStoreV3.ts`                    | bei Konfigurations- oder Space-Wechsel Abschnitte neu aufbauen |
| `viewmodels/room-list/RoomListViewModel.ts`                 | Abschnittsnamen aus der Konfiguration |
| `viewmodels/room-list/RoomListSectionHeaderViewModel.ts`    | verwaltete Abschnitte ohne Menü / Drag-Ziel |
| `viewmodels/room-list/RoomListItemViewModel.ts`             | Raumname aus der Konfiguration (live), nicht „Verschieben nach“ verwaltete Abschnitte |
| `components/views/rooms/RoomHeader/RoomHeader.tsx`          | Name, Kennzeichnungen, keine Anruf-Buttons in verwalteten Texträumen |
| `stores/RoomViewStore.tsx`                                  | verwaltete Sprachräume öffnen die Anrufansicht |
| `models/Call.ts`                                            | dort Lobby statt Direktbeitritt, Audio-Absicht |
| `i18n/strings/en_EN.json`, `de_DE.json`                     | Texte unter `mosaix.private_voice` |
| `models/Call.test.ts`, `stores/RoomViewStore.test.ts`, `viewmodels/room-list/RoomListItemViewModel.test.ts` | zusätzliche Tests |

## Repository-Aufbau

```
element-desktop-custom/
├── element-call/               Element Call v0.26.1 als git subtree (+ unsere Commits)
│   └── src/custom-layout/      ← neuer Code des erweiterten Call-Layouts
├── element-web/                unsere Änderungen an Element Web (overlay/ + patches/)
├── branding/                   variant.json, config.json, Icons
├── desktop/electron-builder.custom.ts   Windows-Installer (NSIS + Zip)
├── scripts/                    element-web.mjs, prepare-webapp.mjs, prepare-desktop.mjs, generate-icons.py
├── upstream.json               gepinnte Upstream-Versionen
└── .github/workflows/build-windows.yml
```

Warum **git subtree** für Element Call statt Fork/Submodule?

- Der angepasste Code liegt direkt im Repository und ist lesbar/reviewbar.
- Upstream-Updates werden mit `git subtree pull` als normaler Merge
  eingespielt (3-Wege-Merge, Konflikte werden wie gewohnt gelöst).
- Kein zweites Repository nötig, keine Submodule-Fallstricke im CI.

### Eingriffe in bestehende Element-Call-Dateien

Bewusst minimal gehalten (jeweils mit `[element-custom]` markiert):

| Datei                                       | Änderung |
| ------------------------------------------- | -------- |
| `src/state/CallViewModel/CallViewModel.ts`  | stellt `customLayoutUserMedia$` und `customLayoutScreenShares$` bereit (2 Felder) |
| `src/room/InCallView.tsx`                   | erzeugt das Layout-ViewModel, rendert `CustomLayoutView` statt des Grids, Button im Footer, Panel |
| `src/room/InCallView.module.css`            | eine Klasse |
| `src/tile/GridTile.tsx`                     | optionale Prop `extraMenuItems` (zusätzliche Menüeinträge) |
| `locales/en/app.json`, `locales/de/app.json`| neue Texte unter `custom_layout` |

Alles andere ist neu in `element-call/src/custom-layout/`.

## Aufbau des Call-Layouts

```
CallViewModel ──(alle Kameras, alle Screenshares)──▶ CustomLayoutViewModel
                                                        │  config$ (Preset, ausgeblendet,
                                                        │  angeheftet, Reihenfolge, Ratios,
                                                        │  freie Positionen)
                                                        ▼
                         computeLayout() (reine Geometrie) ──▶ CustomLayoutView
                                                                 ├─ GridTile (Kamera, Upstream)
                                                                 ├─ ScreenShareTile (MediaView)
                                                                 └─ Drag/Resize/Divider
                                    LayoutPanel ("Layout anpassen"), CustomLayoutButton
                                    LayoutStorage (localStorage: Raum / global / benannt)
```

- **`layoutConfig.ts`** – Datenmodell, Validierung gespeicherter Daten,
  Sichtbarkeit und Sortierung.
- **`computePlacements.ts`** – reine Funktion: Konfiguration + Streams +
  Flächengröße → Positionen aller Kacheln und Teiler. Kein DOM, daher
  umfassend testbar.
- **`CustomLayoutViewModel.ts`** – RxJS-ViewModel nach Element-Call-Konvention
  (Factory mit `ObservableScope`), alle Aktionen, automatische Speicherung.
- **`layoutStorage.ts`** – lokale Speicherung im Profil der App.
- **`CustomLayoutView.tsx`** – rendert Kacheln absolut positioniert, Pointer-
  Events für Verschieben, Größenänderung (8 Griffe) und Teiler.
- **`LayoutPanel.tsx`** – Seitenpanel mit Presets, Stream-Übersicht,
  gespeicherten Layouts, globalem Standard und Zurücksetzen.

### Rein lokale Anzeige, keine Eingriffe in den Anruf

- Ausblenden entfernt nur die Kachel aus der eigenen Ansicht. Es werden
  keine Matrix-Events gesendet, keine LiveKit-Abonnements gekündigt und keine
  Teilnehmer stummgeschaltet oder entfernt.
- **Audio** wird in Element Call unabhängig von den Kacheln über
  `LivekitRoomAudioRenderer` für alle Teilnehmer abgespielt. Ausgeblendete
  Teilnehmer bleiben daher hörbar (durch einen Test abgesichert).
- **Ressourcen:** Element Call verbindet LiveKit mit `adaptiveStream: true`
  und `dynacast: true`. Eine ausgeblendete Kachel hat kein `<video>`-Element
  mehr; LiveKit pausiert dadurch automatisch den Videoempfang dieses Tracks
  (die Verbindung und Audio bleiben bestehen). Kleine Kacheln bekommen
  automatisch eine niedrigere Simulcast-Ebene. Ein maximierter Stream
  blendet die übrigen Videos aus, solange er maximiert ist.
- E2EE, MatrixRTC-Mitgliedschaft und Geräteauswahl bleiben unverändert der
  Upstream-Code.

### Pop-outs

- **`popout.ts`** – welche Streams als eigenes Fenster offen sind (endet mit
  dem Stream), gemerkte Position/Größe pro Matrix-ID und Art, Einstellung
  „immer im Vordergrund“ (lokal im Profil).
- **`Popouts.tsx`** – öffnet pro Pop-out `window.open("", "mosaix-popout-…")`
  und rendert per React-Portal in dieses Fenster. Inhalt und Tracks bleiben im
  Element-Call-Dokument; das Fenster zeigt dieselben LiveKit-Tracks
  (`MediaStream` mit dem `MediaStreamTrack`), es gibt keine zweite
  Verbindung.
- **Hintergrund:** LiveKit pausiert bei `adaptiveStream` alle Videos, sobald
  das Dokument verborgen ist (Fenster minimiert). Ein Pop-out meldet sich bei
  LiveKit deshalb über `observeElementInfo` als sichtbares
  Bild-im-Bild-Element in seiner echten Größe; dann läuft genau dieses Video
  weiter (im E2E-Test gemessen: ohne Pop-out 0 Bytes, mit Pop-out ca.
  100 KB/s).
- **Desktop-App** (`apps/desktop/src/popouts.ts` im Desktop-Patch): erlaubt
  nur leere Fenster (`about:blank`) mit dem Namen `mosaix-popout-…`; sie
  können weder navigieren noch weitere Fenster öffnen. Ein Pop-out außerhalb
  aller Bildschirme (Monitor abgesteckt) wird auf den Hauptbildschirm geholt.
  „Immer im Vordergrund“ kommt per IPC `mosaixPopoutAlwaysOnTop` und setzt
  `setAlwaysOnTop(…, "screen-saver")`. Im Browser gibt es diese Option nicht.

### Standardansicht

Das Preset „Standardansicht (Element)“ schaltet das eigene Layout komplett ab;
dann läuft exakt der unveränderte Element-Call-Code (Grid/Spotlight inkl.
dessen Umschalter). „Auf Standardansicht zurücksetzen“ verwirft zusätzlich
alle Anpassungen des Raums.

## Windows-App

| Eigenschaft            | Mosaix                                  | Offizielles Element |
| ---------------------- | ----------------------------------------------- | ------------------- |
| Produktname            | Mosaix                                  | Element             |
| App-ID                 | `io.github.bensiebert04.mosaix`          | `im.riot.app`       |
| Profil                 | `%APPDATA%\Mosaix`                      | `%APPDATA%\Element` |
| Installationsort       | `%LOCALAPPDATA%\Programs\mosaix` (änderbar) | Squirrel `%LOCALAPPDATA%\element-desktop` |
| Protokoll (SSO/OIDC)   | `io.github.bensiebert04.mosaix://`       | `io.element.desktop://`, `element://` |
| Auto-Update            | **aus** (kein `update_base_url`)                | an                  |
| Analytics / Rageshake  | aus                                             | PostHog / Rageshake |

Beide Apps können parallel installiert sein und laufen.
