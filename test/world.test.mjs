import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseManifest, parseLogLine, foldLog, foldState } from "openworldformat";
import { curves, render, wav, DURATION } from "../build/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const worlds = ["world", "world-recording"];

// The targets the reference renderer honors — a modulation outside
// this set would silently do nothing.
const HONORED_TARGETS = new Set(["emissive", "scale", "light_intensity", "opacity", "offset_y"]);

for (const dir of worlds) {
  const manifest = parseManifest(read(`${dir}/manifest.json`));
  const entries = read(`${dir}/ops.jsonl`).split("\n").filter((l) => l.trim())
    .map(parseLogLine);

  test(`${dir}: parses, folds, and the session is history-only`, () => {
    assert.equal(manifest.version, 3);
    const state = foldLog(manifest, entries);
    assert.equal(state.appliedEdits, 0); // a performance leaves the document alone
    const doc = JSON.parse(read(`${dir}/state.json`));
    assert.equal(foldState(doc, entries).values["plays.count"], 1);
  });

  test(`${dir}: every modulation resolves and hits a honored target`, () => {
    const stems = manifest.soundtrack.stems ?? {};
    const used = new Set();
    for (const e of manifest.entities) {
      for (const m of e.modulations ?? []) {
        assert.ok(HONORED_TARGETS.has(m.target), `${e.name}: target ${m.target} does nothing`);
        used.add(m.target);
        const sig = m.signal;
        const kind = typeof sig === "string" ? sig : Object.keys(sig ?? {})[0];
        if (kind === "stem") {
          assert.ok(Array.isArray(stems[sig.stem]), `${e.name}: stem '${sig.stem}' has no curve`);
        } else {
          assert.ok(["energy", "beat", "bass", "highs", "oscillator", "constant"].includes(kind),
            `${e.name}: unknown signal ${JSON.stringify(sig)}`);
        }
        assert.ok(Array.isArray(m.range) && m.range.length === 2 && m.range[1] >= m.range[0],
          `${e.name}: bad range`);
      }
    }
    // The world uses every target the renderer honors — the demo's point.
    assert.deepEqual([...used].sort(), [...HONORED_TARGETS].sort());
  });

  test(`${dir}: curves are one per second, in range, sections ascend`, () => {
    const st = manifest.soundtrack;
    assert.equal(st.duration, DURATION);
    assert.equal(st.energy.length, DURATION);
    for (const [name, curve] of Object.entries(st.stems)) {
      assert.equal(curve.length, DURATION, `stem ${name}`);
      assert.ok(curve.every((v) => v >= 0 && v <= 1), `stem ${name} out of 0..1`);
    }
    assert.deepEqual(st.sections, [...st.sections].sort((a, b) => a - b));
    assert.equal(st.sections[0], 0);
  });
}

test("world: the silent package ships no recording", () => {
  const st = JSON.parse(read("world/manifest.json")).soundtrack;
  assert.equal(st.path, undefined);
  assert.ok(st.energy.length > 0, "but the analysis is all there");
});

test("world-recording: the path resolves to a content-addressed asset", () => {
  const st = JSON.parse(read("world-recording/manifest.json")).soundtrack;
  assert.ok(st.path?.startsWith("assets/"), st.path);
  const file = path.join(root, "world-recording", st.path);
  assert.ok(existsSync(file), `${st.path} missing`);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  assert.equal(st.path, `assets/${sha}.wav`, "the name is the hash of what it holds");
});

test("the drop is louder than the intro — the arrangement reads from the curves", () => {
  const { energy } = curves();
  const sec = (i) => energy.slice(Math.floor(DURATION * [0, 0.2, 0.45, 0.78][i]),
    Math.floor(DURATION * [0.2, 0.45, 0.78, 1][i]));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(sec(2)) > mean(sec(0)) * 1.5, "the drop dwarfs the intro");
  assert.ok(mean(sec(2)) > mean(sec(1)), "and beats the build");
});

test("the build is deterministic: same score, same bytes", async () => {
  const a = curves();
  const b = curves();
  assert.deepEqual(a, b);
  const { createHash: h } = await import("node:crypto");
  const sha = h("sha256").update(wav(render())).digest("hex");
  const st = JSON.parse(read("world-recording/manifest.json")).soundtrack;
  assert.equal(`assets/${sha}.wav`, st.path);
});
