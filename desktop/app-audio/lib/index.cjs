// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Sound for screen sharing in Mosaix on Windows, used by Element Desktop's
// display media handler (main process):
//
//  - sharing a window: only the sound of that application (process tree)
//  - sharing a screen: the whole system's sound except Mosaix itself, so the
//    others don't hear the call (and themselves) twice
//
// Electron can only add a whole-system loopback or the sound of one of its
// own web contents to a screen share. So the sound captured by the native
// module (process loopback) is played in a hidden player window, and that
// window's sound is what Electron adds to the screen share. While it is being
// captured Chromium mutes its local playback, so the user doesn't hear it
// twice either.

"use strict";

const path = require("node:path");
const fs = require("node:fs");

let native;

/** The native module, or null where it isn't available (non-Windows, old Windows). */
function loadNative() {
    if (native !== undefined) return native;
    native = null;
    for (const file of [
        path.join(__dirname, "..", "app_audio.node"),
        path.join(__dirname, "..", "build", "Release", "app_audio.node"),
    ]) {
        if (!fs.existsSync(file)) continue;
        try {
            const loaded = require(file);
            native = loaded.isSupported() ? loaded : null;
        } catch (e) {
            console.error("[app-audio] Could not load the native module", e);
        }
        break;
    }
    return native;
}

/** Whether this system can capture the sound of single applications. */
function isSupported() {
    return loadNative() !== null;
}

/** The window handle of a desktopCapturer source id ("window:<hwnd>:<n>"), if any. */
function windowHandle(sourceId) {
    const match = /^window:(\d+):/.exec(sourceId ?? "");
    return match ? Number(match[1]) : null;
}

/**
 * What to capture for a chosen source: the application's process tree for a
 * window, everything but Mosaix for a screen, nothing otherwise (or for one of
 * Mosaix's own windows, which would capture the call itself).
 */
function captureTarget(sourceId, ownPid, processOfWindow) {
    const hwnd = windowHandle(sourceId);
    if (hwnd !== null) {
        const pid = processOfWindow(hwnd);
        if (!pid || pid === ownPid) return null;
        return { pid, mode: "include" };
    }
    if (/^screen:/.test(sourceId ?? "")) return { pid: ownPid, mode: "exclude" };
    return null;
}

let worklet;

/** The code of the player's AudioWorklet. */
function workletCode() {
    worklet ??= fs.readFileSync(path.join(__dirname, "player-worklet.js"), "utf8");
    return worklet;
}

let active = null;

/** Stops the running capture, if any. */
function stop() {
    const session = active;
    active = null;
    if (!session) return;
    clearInterval(session.watch);
    try {
        session.capture.stop();
    } catch (e) {
        console.error("[app-audio] Stopping the capture failed", e);
    }
    session.port.close();
    if (!session.player.isDestroyed()) session.player.destroy();
    console.log("[app-audio] Stopped");
}

/** Whether a capture is running (for tests). */
function isActive() {
    return active !== null;
}

/**
 * How the player's jitter buffer is doing (for tests and diagnosis):
 * underruns, trims, skipped/repeated frames and buffered frames, or null.
 */
function stats() {
    const player = active?.player;
    if (!player || player.isDestroyed()) return Promise.resolve(null);
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        player.webContents.ipc.once("mosaix-app-audio-stats", (_event, data) => {
            clearTimeout(timer);
            resolve(data);
        });
        player.webContents.send("mosaix-app-audio-stats");
    });
}

/**
 * Starts capturing the sound for a chosen screen share source.
 *
 * @param {object} options
 * @param {typeof import("electron")} options.electron
 * @param {string} options.sourceId desktopCapturer source id
 * @param {number} options.ownPid Mosaix's main process id
 * @param {import("electron").WebFrameMain | null} [options.requestFrame] the frame that asked for the screen
 * @returns {Promise<import("electron").WebFrameMain | null>} the frame whose sound to add to the
 *     screen share, or null if there is nothing to capture
 */
async function start({ electron, sourceId, ownPid, requestFrame }) {
    stop();
    const n = loadNative();
    if (!n) return null;
    const target = captureTarget(sourceId, ownPid, (hwnd) => n.windowProcessId(hwnd));
    if (!target) return null;

    const player = new electron.BrowserWindow({
        show: false,
        width: 200,
        height: 100,
        skipTaskbar: true,
        focusable: false,
        title: "Mosaix screen share audio",
        webPreferences: {
            preload: path.join(__dirname, "player-preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            // Element Desktop sandboxes every renderer anyway (app.enableSandbox)
            sandbox: true,
            backgroundThrottling: false,
            autoplayPolicy: "no-user-gesture-required",
        },
    });
    await player.loadFile(path.join(__dirname, "player.html"));

    // The player is sandboxed like every renderer of Element Desktop, so it
    // gets the worklet's code from here
    const { port1, port2 } = new electron.MessageChannelMain();
    player.webContents.postMessage("mosaix-app-audio-port", workletCode(), [port2]);
    port1.start();

    let capture;
    try {
        capture = new n.Capture(
            target.pid,
            target.mode,
            (chunk) => port1.postMessage(chunk),
            (message) => {
                console.error("[app-audio]", message);
                stop();
            },
        );
    } catch (e) {
        console.error("[app-audio] Could not start the capture", e);
        port1.close();
        player.destroy();
        return null;
    }

    // End with the screen share: once the player isn't captured any more, or
    // the call that asked for it is gone. (Element Call also says so
    // explicitly, see stop().)
    let captured = false;
    const watch = setInterval(() => {
        if (active?.player !== player) return;
        const beingCaptured = !player.isDestroyed() && player.webContents.isBeingCaptured();
        if (beingCaptured) captured = true;
        const callGone = requestFrame != null && (requestFrame.detached || requestFrame.isDestroyed?.());
        if ((captured && !beingCaptured) || callGone) stop();
    }, 1000);

    active = { player, port: port1, capture, watch };
    console.log(`[app-audio] Capturing ${target.mode === "include" ? "process" : "all but process"} ${target.pid}`);
    return player.webContents.mainFrame;
}

module.exports = { isSupported, start, stop, isActive, stats, captureTarget, windowHandle };
