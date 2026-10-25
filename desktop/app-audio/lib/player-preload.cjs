// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Hidden player window: plays the captured sound (interleaved stereo float32,
// 48 kHz) received over a MessagePort from the main process.
//
// Runs sandboxed (Element Desktop sandboxes every renderer): no Node.js, no
// file access. The main process sends the worklet's code along with the port.

"use strict";

const { ipcRenderer } = require("electron");

const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
let player = null;

async function startPlayer(workletCode) {
    // Loaded from a blob: the sandbox can't read the worklet file itself
    const url = URL.createObjectURL(new Blob([workletCode], { type: "text/javascript" }));
    await context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(context, "mosaix-pcm-player", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
    });
    node.connect(context.destination);
    return node;
}

ipcRenderer.on("mosaix-app-audio-port", (event, workletCode) => {
    const [port] = event.ports;
    player = startPlayer(workletCode);
    void player.then(
        (node) => {
            port.onmessage = (message) => {
                const chunk = message.data;
                node.port.postMessage(chunk, [chunk.buffer]);
            };
            port.start();
            void context.resume();
        },
        (e) => console.error("[app-audio] The player could not start", e),
    );
});

// How the jitter buffer is doing (for tests and diagnosis)
ipcRenderer.on("mosaix-app-audio-stats", () => {
    if (!player) {
        ipcRenderer.send("mosaix-app-audio-stats", null);
        return;
    }
    void player.then((node) => {
        node.port.onmessage = (message) => ipcRenderer.send("mosaix-app-audio-stats", message.data);
        node.port.postMessage("stats");
    });
});
