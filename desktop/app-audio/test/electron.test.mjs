// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Runs test/electron/main.cjs in Electron on Windows (needs an audio output
// device) and checks the sound of real screen shares.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const windows = process.platform === "win32";

test("screen share sound in Electron", { skip: !windows, timeout: 120000 }, () => {
    const electronPath = require("electron");
    const main = fileURLToPath(new URL("./electron/main.cjs", import.meta.url));
    const output = execFileSync(electronPath, [main], { encoding: "utf8", timeout: 110000 });
    const line = output.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
    assert.ok(line, `no result in:\n${output}`);
    const r = JSON.parse(line.slice(7));
    console.log(JSON.stringify(r, null, 2));
    assert.equal(r.error, undefined);
    assert.equal(r.supported, true);

    // The tone apps and this app play their tones at 0.5. "Heard" means
    // at least 0.35 in the median 100 ms block, "not heard" below 0.02.
    // "Clean": the tones make up at least 90 % of the sound in the median
    // block and in at least 90 % of all blocks, i.e. no lasting noise, and
    // the player's jitter buffer never ran dry or had to drop sound, i.e. no
    // dropouts. (Single blocks are off now and then; locally that happened
    // with a plain oscillator shared directly, too.)
    const HEARD = 0.35;
    const SILENT = 0.02;
    const clean = (share, what) => {
        assert.ok(share.cleanMedian > 0.95, `${what}: clean sound (${share.cleanMedian})`);
        assert.ok(
            share.unclean <= share.blocks / 10,
            `${what}: at most a tenth of ${share.blocks} blocks off (${share.unclean})`,
        );
        assert.equal(share.channels, 2, `${what}: stereo`);
        assert.equal(share.player?.underruns, 0, `${what}: the player never ran dry`);
        assert.equal(share.player?.trims, 0, `${what}: the player never dropped sound`);
    };

    // Sharing the window of the 440 Hz app: only its sound
    assert.equal(r.window.audioTrack, true);
    assert.ok(r.window.t440 > HEARD, "the shared app is heard");
    assert.ok(r.window.t880 < SILENT, "another app is not");
    assert.ok(r.window.t660 < SILENT, "the call (this app) is not");
    clean(r.window, "window");

    // Sharing the screen: every app, but not this one
    assert.equal(r.screen.audioTrack, true);
    assert.ok(r.screen.t440 > HEARD && r.screen.t880 > HEARD, "all other apps are heard");
    assert.ok(r.screen.t660 < SILENT, "the call is not heard twice");
    clean(r.screen, "screen");

    // The capture ends with the screen share
    assert.equal(r.windowCaptureStopped, true);
    assert.equal(r.screenCaptureStopped, true);
});
