// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Electron test of lib/index.cjs on Windows, wired up like Element Desktop's
// display media handler (with every renderer sandboxed, as there): two separate applications play 440 Hz and 880 Hz,
// this app itself plays 660 Hz (standing for the call). Shares a window, then
// the screen, and prints what the screen share's sound contained.

"use strict";

const electron = require("electron");
const { app, BrowserWindow, desktopCapturer, session } = electron;
const { spawn } = require("node:child_process");
const path = require("node:path");

const appAudio = require("../../lib/index.cjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// As in Element Desktop: every renderer is sandboxed, the player included
app.enableSandbox();

let choose = null;

/** Measures a share, and how the player's jitter buffer did meanwhile. */
async function measure(win) {
    const result = win.webContents.executeJavaScript("measureShare()");
    await sleep(4500);
    const player = await appAudio.stats();
    return { ...(await result), player };
}

async function stoppedAfterShare() {
    for (let i = 0; i < 12; i++) {
        if (!appAudio.isActive()) return true;
        await sleep(500);
    }
    return false;
}

app.whenReady().then(async () => {
    const tones = [440, 880].map((f) =>
        spawn(process.execPath, [path.join(__dirname, "tone.cjs"), String(f)], { stdio: "ignore" }),
    );
    const results = { supported: appAudio.isSupported() };
    try {
        session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
            const sources = await desktopCapturer.getSources({ types: ["window", "screen"] });
            const source = choose(sources);
            results.sources = results.sources ?? sources.map((s) => s.name);
            const audio = request.audioRequested
                ? await appAudio.start({ electron, sourceId: source.id, ownPid: process.pid, requestFrame: request.frame })
                : null;
            callback(audio ? { video: source, audio } : { video: source });
        });
        const win = new BrowserWindow({
            width: 640,
            height: 400,
            webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
        });
        await win.loadFile(path.join(__dirname, "harness.html"));
        await sleep(5000); // tone apps up and playing
        await win.webContents.executeJavaScript("startOwnTone(660)");

        choose = (sources) => sources.find((s) => s.name === "Mosaix Tone 440");
        results.window = await measure(win);
        results.windowCaptureStopped = await stoppedAfterShare();

        choose = (sources) => sources.find((s) => s.id.startsWith("screen:"));
        results.screen = await measure(win);
        results.screenCaptureStopped = await stoppedAfterShare();
    } catch (e) {
        results.error = String(e?.stack ?? e);
    } finally {
        appAudio.stop();
        for (const t of tones) t.kill();
        console.log("RESULT " + JSON.stringify(results));
        app.exit(0);
    }
});
