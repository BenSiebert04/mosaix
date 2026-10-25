// End-to-end test of playback volume and "Mute for me" over time, measured
// at the output: Anna joins from Element Web with a steady 440 Hz tone as her
// microphone; Ben (in Element Web, or with BEN_CDP in the real desktop app)
// changes her volume again and again – 50 %, muted, unmuted, 200 %, 100 % –
// in several rounds, with a layout change, Anna muting and unmuting her
// microphone, and Anna leaving and joining again in between. After every
// step the level of what Ben's call actually plays must match.
//
// Usage (backend from start.sh running, web app assembled in build/webapp):
//   node e2e/volume-cycles.e2e.mjs
//   BEN_CDP=http://localhost:9333 node e2e/volume-cycles.e2e.mjs

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../element-call/package.json"));
const { chromium } = require("@playwright/test");
const RESULTS = path.join(here, "results");
const WORK = path.join(here, ".work");
mkdirSync(RESULTS, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Anna's microphone: a steady tone
const TONE = path.join(WORK, "tone440.wav");
if (!existsSync(TONE)) {
    const rate = 48000;
    const samples = rate * 10;
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(data.length, 40);
    writeFileSync(TONE, Buffer.concat([header, data]));
}

const webapp = path.join(WORK, "webapp-cycles");
rmSync(webapp, { recursive: true, force: true });
cpSync(path.join(here, "../build/webapp"), webapp, { recursive: true });
writeFileSync(
    path.join(webapp, "config.json"),
    JSON.stringify({
        default_server_config: { "m.homeserver": { base_url: "http://localhost:8008", server_name: "localhost:8448" } },
        brand: "Mosaix",
    }),
);
const server = spawn("node", [path.join(here, "serve.mjs"), webapp, "8084"], { stdio: "ignore" });
const roomId = execFileSync(path.join(WORK, "venv/bin/python"), [path.join(here, "create-room.py")]).toString().trim();
const BASE = "http://localhost:8084";

// In every frame: tap everything that is played (connected to the speakers)
function hooks() {
    window.__taps = [];
    window.__gains = [];
    const createGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function (...args) {
        const node = createGain.apply(this, args);
        node.__created = new Error().stack.split("\n").slice(2, 4).join(" | ").replace(/\s+/g, " ").slice(0, 160);
        window.__gains.push(node);
        return node;
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...rest) {
        const result = connect.call(this, destination, ...rest);
        if (destination instanceof AudioDestinationNode && !this.__tapped) {
            this.__tapped = true;
            const analyser = this.context.createAnalyser();
            analyser.fftSize = 2048;
            connect.call(this, analyser);
            window.__taps.push(analyser);
        }
        return result;
    };
    window.__sources = [];
    const createSource = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (...args) {
        const node = createSource.apply(this, args);
        const analyser = this.createAnalyser();
        analyser.fftSize = 2048;
        connect.call(node, analyser);
        window.__sources.push(analyser);
        return node;
    };
    const rms = (analysers) => {
        let level = 0;
        const buffer = new Float32Array(2048);
        for (const a of analysers) {
            if (a.context.state === "closed") continue;
            a.getFloatTimeDomainData(buffer);
            let p = 0;
            for (const v of buffer) p += v * v;
            level = Math.max(level, Math.sqrt(p / buffer.length));
        }
        return level;
    };
    // What arrives and what is played, right now
    window.__io = () => ({ in: rms(window.__sources), out: rms(window.__taps) });
    // Loudest tap right now (RMS); audio elements that play by themselves count too
    window.__level = () => {
        let level = 0;
        const buffer = new Float32Array(2048);
        for (const a of window.__taps) {
            if (a.context.state === "closed") continue;
            a.getFloatTimeDomainData(buffer);
            let p = 0;
            for (const v of buffer) p += v * v;
            level = Math.max(level, Math.sqrt(p / buffer.length));
        }
        return level;
    };
    window.__elements = () =>
        [...document.querySelectorAll("audio")]
            .filter((a) => a.srcObject?.getAudioTracks().length)
            .map((a) => ({ muted: a.muted, volume: a.volume }));
}

async function login(name, extraArgs = []) {
    if (name === "Ben" && process.env.BEN_CDP) {
        const browser = await chromium.connectOverCDP(process.env.BEN_CDP);
        const context = browser.contexts()[0];
        await context.addInitScript(hooks);
        const page = context.pages().find((p) => p.url().startsWith("vector://")) ?? context.pages()[0];
        await page.waitForURL(/vector:\/\//, { timeout: 30000 });
        await page.evaluate(() => (location.hash = "#/login"));
        await page.getByLabel("Username").fill("ben", { timeout: 30000 });
        await page.getByLabel("Password").fill("testpass123");
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.getByRole("button", { name: "Dismiss" }).click({ timeout: 30000 }).catch(() => {});
        await page.evaluate((r) => (location.hash = `#/room/${r}`), roomId);
        await page.getByRole("button", { name: "Later" }).click({ timeout: 5000 }).catch(() => {});
        return { name, browser, page, remote: true };
    }
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH,
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--mute-audio", ...extraArgs],
    });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ["microphone", "camera"] });
    await context.addInitScript(hooks);
    const page = await context.newPage();
    await page.goto(`${BASE}/#/login`);
    await page.getByLabel("Username").fill(name.toLowerCase());
    await page.getByLabel("Password").fill("testpass123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Dismiss" }).click({ timeout: 30000 }).catch(() => {});
    await page.goto(`${BASE}/#/room/${roomId}`);
    await page.getByRole("button", { name: "Later" }).click({ timeout: 5000 }).catch(() => {});
    return { name, browser, page };
}

const widget = (page) => page.frameLocator('iframe[src*="widgets/element-call"]');
const callFrame = (page) => page.frames().find((f) => f.url().includes("widgets/element-call"));

async function joinCall(x, start) {
    if (start) {
        await x.page.getByRole("button", { name: /Video call/i }).first().click();
        await x.page.getByRole("menuitem", { name: "Element Call" }).click({ timeout: 5000 }).catch(() => {});
    } else {
        const join = x.page.getByRole("button", { name: "Join", exact: true });
        await join.last().waitFor({ timeout: 30000 });
        await join.last().click();
    }
    await widget(x.page).getByTestId("lobby_joinCall").click({ timeout: 15000 }).catch(() => {});
    await widget(x.page).getByTestId("incall_leave").waitFor({ timeout: 30000 });
    log(x.name, "in call");
}

const people = [];
let failed = false;
try {
    const anna = await login("Anna", [`--use-file-for-fake-audio-capture=${TONE}`]);
    const ben = await login("Ben");
    people.push(anna, ben);
    await joinCall(anna, true);
    await joinCall(ben, false);
    const b = ben.page;

    /**
     * The effective playback gain of Anna's voice: what Ben's call plays
     * divided by what arrives (Anna's own microphone processing changes the
     * level over time; this measures only what Ben's side does with it).
     * Median over a second; 0 if nothing is played.
     */
    const level = async () => {
        await b.waitForTimeout(800); // gain changes ramp over ~0.3 s
        const values = [];
        for (let i = 0; i < 10; i++) {
            const { in: input, out } = await callFrame(b).evaluate(() => window.__io());
            values.push(input > 0.002 ? out / input : out > 0.002 ? Infinity : NaN);
            await b.waitForTimeout(100);
        }
        const valid = values.filter((v) => !Number.isNaN(v)).sort((x, y) => x - y);
        return valid.length ? valid[valid.length >> 1] : NaN;
    };
    const annaTile = () =>
        widget(b).locator('[data-testid="custom-layout-tile"][data-stream-kind="camera"]').filter({ hasText: "Anna" });
    const withMenu = async (fn) => {
        await annaTile().click({ button: "right", position: { x: 60, y: 60 } });
        const menu = widget(b).getByRole("menu");
        await menu.waitFor();
        await fn(menu);
        await b.keyboard.press("Escape");
        await menu.waitFor({ state: "detached" }).catch(() => {});
    };
    /** Sets Anna's volume (0..2) by clicking on the slider's track. */
    const setVolume = (value) =>
        withMenu(async (menu) => {
            const slider = menu.locator('[data-testid="volume-slider"], [role="slider"]').first();
            const track = slider.locator("xpath=ancestor::*[contains(@class,'Slider') or @data-orientation][1]");
            const box = (await track.boundingBox()) ?? (await slider.boundingBox());
            await b.mouse.click(box.x + Math.min((box.width * value) / 2, box.width - 1), box.y + box.height / 2);
        });
    const toggleMute = () => withMenu((menu) => menu.getByRole("menuitemcheckbox", { name: "Mute for me" }).click());

    await annaTile().waitFor({ timeout: 30000 });
    // Anna's tone must have arrived
    let full = NaN;
    for (let i = 0; i < 20 && !(full > 0.5); i++) full = await level();
    log("gain at 100 %:", full.toFixed(3), JSON.stringify(await callFrame(b).evaluate(() => window.__elements())));
    assert.ok(full > 0.8 && full < 1.25, "Anna is played at her own level");
    full = 1;

    const near = (value, expected, what) => {
        const ok = expected === 0 ? value < 0.02 : Math.abs(value / expected - 1) < 0.2;
        log(`${ok ? "ok " : "BAD"} ${what}: ${value.toFixed(3)} (expected ${expected.toFixed(3)})`);
        if (process.env.DEBUG_GAINS) void callFrame(b).evaluate(() => window.__gains.filter((g) => g.context.state !== "closed").map((g) => [Math.round(g.gain.value * 1000) / 1000, g.__created])).then((g) => log("   gains", JSON.stringify(g)));
        if (!ok) failed = true;
    };

    for (let round = 1; round <= 3; round++) {
        log(`--- round ${round}`);
        await setVolume(0.5);
        near(await level(), full * 0.5, "50 %");
        await toggleMute();
        near(await level(), 0, "muted");
        await toggleMute();
        near(await level(), full * 0.5, "unmuted, back at 50 %");
        await setVolume(2);
        near(await level(), full * 2, "200 %");
        await setVolume(1);
        near(await level(), full, "100 %");

        if (round === 1) {
            // Something else happens in the call: another layout
            await widget(b).getByTestId("custom-layout-button").click();
            await widget(b).getByTestId("custom-layout-preset-main-sidebar").click();
            await widget(b).getByTestId("custom-layout-button").click();
            log("layout changed");
        } else if (round === 3) {
            // Another output device (as when plugging in a headset), while
            // Ben has Anna muted
            await toggleMute();
            // Another output device (as when plugging in a headset)
            await callFrame(b).evaluate(async () => {
                const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
                localStorage.setItem("__outputs", JSON.stringify(outputs.map((d) => d.label)));
            });
            await widget(b).getByRole("button", { name: "Settings" }).click();
            const select = widget(b).getByRole("combobox", { name: /speaker|output/i }).first();
            if (await select.count()) {
                await select.click();
                await widget(b).getByRole("option").nth(1).click();
                log("output device changed");
            } else {
                await widget(b).getByRole("radio").filter({ hasText: /Fake Audio Output 1/ }).first().check().catch(() => {});
                log("output device changed (radio)");
            }
            await b.keyboard.press("Escape");
            near(await level(), 0, "still muted on the other output device");
            await toggleMute();
            await setVolume(0.5);
            near(await level(), full * 0.5, "50 % on the other output device");
            await toggleMute();
            near(await level(), 0, "muted on the other output device");
            await toggleMute();
            await setVolume(1);
            near(await level(), full, "100 % on the other output device");
        } else if (round === 2) {
            // Anna mutes and unmutes her microphone, while Ben has her muted,
            // then again while she is at 200 %
            const mic = widget(anna.page).getByRole("switch", { name: /microphone/i }).first();
            const micOffOn = async () => {
                await mic.click();
                await anna.page.waitForTimeout(1500);
                await mic.click();
                await anna.page.waitForTimeout(1500);
            };
            await toggleMute();
            await micOffOn();
            near(await level(), 0, "still muted after Anna's microphone came back");
            await toggleMute();
            await setVolume(2);
            await micOffOn();
            near(await level(), full * 2, "still 200 % after Anna's microphone came back");
            await setVolume(1);
        }
    }

    // Anna leaves and joins again: the remembered volume applies, and the
    // menu still works
    await setVolume(0.5);
    await widget(anna.page).getByTestId("incall_leave").click();
    await anna.page.waitForTimeout(3000);
    await anna.page.reload();
    await anna.page.getByRole("button", { name: "Later" }).click({ timeout: 5000 }).catch(() => {});
    await joinCall(anna, false);
    await annaTile().waitFor({ timeout: 30000 });
    let again = NaN;
    for (let i = 0; i < 20 && !(again > 0.2); i++) again = await level();
    near(again, full * 0.5, "Anna back: still 50 %");
    await toggleMute();
    near(await level(), 0, "Anna back: muted");
    await toggleMute();
    await setVolume(1);
    near(await level(), full, "Anna back: 100 %");

    if (failed) throw new Error("the played level did not follow the menu (see BAD lines)");
    log("OK volume and 'Mute for me' follow the menu every time");
} catch (e) {
    failed = true;
    log("FAILED:", e.message);
    for (const x of people) await x.page.screenshot({ path: path.join(RESULTS, `volume-cycles-error-${x.name}.png`) }).catch(() => {});
} finally {
    for (const x of people) if (!x.remote) await x.browser.close();
    server.kill();
}
process.exit(failed ? 1 : 0);
