// song.world — the build: one score, two packages.
//
// The score is a fixed event schedule (120 BPM, 64 s, A minor); the
// analysis curves are computed analytically from that schedule — the
// honest analysis of a performance we composed — and the recording is
// synthesized from the same events. Everything is deterministic: no
// randomness beyond a fixed seed, so `node build` reproduces the world
// byte for byte.
//
// Two packages, one build:
//   world/            the silent package — curves only, no recording;
//                     modulations run on the analysis alone ("a world
//                     performs a piece of music without shipping the
//                     recording")
//   world-recording/  the same world plus the synthesized WAV, where
//                     bass/highs modulations go live-analyser when
//                     playing

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const BPM = 120;
export const DURATION = 64; // 32 bars of 2 s
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const SAMPLE_RATE = 32000;

// Section boundaries as fractions of duration (ascending, from 0).
export const SECTIONS = [0.0, 0.2, 0.45, 0.78];

// A minor, four bars each: Am F C G — roots for the bass, chords for
// the pad, scale tones for the arp.
export const PROGRESSION = [
  { root: 110.0, chord: [220.0, 261.63, 329.63] }, // A2, Am
  { root: 87.31, chord: [174.61, 220.0, 261.63] }, // F2, F
  { root: 65.41, chord: [261.63, 329.63, 392.0] }, // C2, C
  { root: 98.0, chord: [196.0, 246.94, 293.66] }, // G2, G
];
const ARP_SCALE = [0, 3, 7, 12, 15, 19, 24]; // minor shape, semitones up

const sectionAt = (t) => {
  const f = t / DURATION;
  let s = 0;
  SECTIONS.forEach((b, i) => { if (f >= b) s = i; });
  return s; // 0 intro, 1 build, 2 drop, 3 outro
};

// Deterministic humanization (mulberry32, fixed seed).
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The event schedule: {t, dur, stem, env} — env is the amplitude
// envelope the event contributes to its stem curve (and to the synth).
// ---------------------------------------------------------------------------

export function schedule() {
  const rand = rng(20260930);
  const events = [];
  const add = (t, dur, stem, env) => events.push({ t, dur, stem, env });

  for (let bar = 0; bar < 32; bar++) {
    const t0 = bar * BAR;
    const sec = sectionAt(t0);
    const chord = PROGRESSION[Math.floor(bar / 4) % 4];

    // Drums: hats from the build, kick and snare in the drop.
    if (sec >= 1) {
      for (let e = 0; e < 8; e++) {
        add(t0 + e * BEAT / 2, 0.06, "drums", 0.22 + 0.1 * (e % 2) + rand() * 0.05);
      }
    }
    if (sec === 2) {
      for (let b = 0; b < 4; b++) add(t0 + b * BEAT, 0.35, "drums", 1.0); // kick
      add(t0 + BEAT, 0.25, "drums", 0.8); // snare on 2
      add(t0 + 3 * BEAT, 0.25, "drums", 0.8); // and 4
    }

    // Bass: 8ths from the build, only in build and drop.
    if (sec === 1 || sec === 2) {
      for (let e = 0; e < 8; e++) {
        add(t0 + e * BEAT / 2, 0.22, "bass", (e === 0 ? 0.9 : 0.55) + rand() * 0.1);
      }
    }

    // Pad: every section, the chord, slow.
    add(t0, BAR * 0.98, "other", sec === 0 ? 0.5 : sec === 3 ? 0.35 : 0.45);

    // Arp: 16ths in build and drop, sparse sparkle in intro/outro.
    if (sec === 1 || sec === 2) {
      for (let s = 0; s < 16; s++) {
        const step = ARP_SCALE[(s + bar) % ARP_SCALE.length];
        add(t0 + s * BEAT / 4, 0.18, "other", 0.3 + 0.2 * (s % 4 === 0) + rand() * 0.08);
      }
    } else if (bar % 2 === 0) {
      for (let s = 0; s < 4; s++) {
        add(t0 + s * BEAT, 0.4, "other", 0.25 + rand() * 0.1);
      }
    }
  }
  return events.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Analysis curves: one value per second, the mean envelope of each
// stem over that second. `energy` is the mix of all three. This is the
// analysis the modulations read; the recording variant's live analyser
// approximates the same signals from the audio.
// ---------------------------------------------------------------------------

export function curves() {
  const events = schedule();
  const stems = { drums: [], bass: [], other: [] };
  for (let s = 0; s < DURATION; s++) {
    const lo = s, hi = s + 1;
    for (const [name, arr] of Object.entries(stems)) {
      let sum = 0;
      for (const e of events) {
        if (e.stem !== name || e.t >= hi || e.t + e.dur <= lo) continue;
        const overlap = Math.min(hi, e.t + e.dur) - Math.max(lo, e.t);
        sum += e.env * (overlap / Math.max(e.dur, 1e-6)) * (overlap / (hi - lo));
      }
      arr.push(Math.min(1, sum));
    }
  }
  const energy = stems.drums.map((d, i) =>
    Math.min(1, d * 0.45 + stems.bass[i] * 0.3 + stems.other[i] * 0.35));
  return { energy, stems };
}

// ---------------------------------------------------------------------------
// The synthesizer: mono, 32 kHz, the same schedule rendered. Not a
// production instrument — a deterministic one.
// ---------------------------------------------------------------------------

function envelope(t, dur) {
  if (t < 0 || t > dur) return 0;
  const attack = Math.min(t / 0.005, 1);
  return attack * Math.exp(-4 * t / dur);
}

export function render() {
  const n = DURATION * SAMPLE_RATE;
  const out = new Float64Array(n);
  const rand = rng(20260930); // same seed as schedule(): same feel
  let noise = 0;

  for (const e of schedule()) {
    const start = Math.floor(e.t * SAMPLE_RATE);
    const len = Math.floor(e.dur * SAMPLE_RATE);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / SAMPLE_RATE;
      const env = envelope(t, e.dur) * e.env;
      let s = 0;
      if (e.dur === 0.35) {
        // Kick: a pitch sweep 120 → 45 Hz.
        const f = 45 + 75 * Math.exp(-t * 28);
        s = Math.sin(2 * Math.PI * f * t) * 1.4;
      } else if (e.dur === 0.25) {
        // Snare: noise plus a 180 Hz body.
        noise = noise * 0.2 + (rand() * 2 - 1) * 0.8;
        s = noise * 0.7 + Math.sin(2 * Math.PI * 180 * t) * 0.3;
      } else if (e.dur === 0.06) {
        // Hat: bright noise.
        noise = noise * 0.1 + (rand() * 2 - 1) * 0.9;
        s = noise * 0.5;
      } else if (e.stem === "bass") {
        // Bass: a hollow saw-ish tone at the section's root.
        const bar = Math.floor(e.t / BAR);
        const f = PROGRESSION[Math.floor(bar / 4) % 4].root;
        s = (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t)) * 0.8;
      } else if (e.dur >= BAR * 0.9) {
        // Pad: the chord, three detuned partials per tone.
        const bar = Math.floor(e.t / BAR + 0.01);
        for (const f of PROGRESSION[Math.floor(bar / 4) % 4].chord) {
          s += Math.sin(2 * Math.PI * (f + 0.7) * t) * 0.18;
          s += Math.sin(2 * Math.PI * (f - 0.6) * t) * 0.12;
        }
      } else {
        // Arp/sparkle: a plucked sine walking the shape.
        const bar = Math.floor(e.t / BAR);
        const step = ARP_SCALE[(Math.round((e.t % BAR) / (BEAT / 4)) + bar) % ARP_SCALE.length];
        const f = 440 * Math.pow(2, step / 12);
        s = Math.sin(2 * Math.PI * f * t) * 0.6;
      }
      out[start + i] += s * env;
    }
  }
  // Soft clip to ±1.
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.tanh(out[i] * 0.9);
  return pcm;
}

/** 16-bit mono WAV. */
export function wav(pcm) {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(SAMPLE_RATE, 24);
  head.writeUInt32LE(SAMPLE_RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// ---------------------------------------------------------------------------
// The world: a stage that performs the track. Every modulation target
// the renderer honors is used at least once.
// ---------------------------------------------------------------------------

function entities() {
  const list = [];
  const add = (e) => list.push(e);
  const pos = (p) => ({ position: p });

  add({ id: 1, name: "ground", shape: { Plane: { x: 50.0, z: 50.0 } },
    material: { color: [0.09, 0.08, 0.14, 1.0], roughness: 0.92 } });
  add({ id: 2, name: "moon", transform: pos([4.0, 20.0, 8.0]),
    light: { light_type: "directional", color: [0.65, 0.65, 1.0, 1.0],
      intensity: 900.0, direction: [-0.3, -1.0, -0.35] } });
  add({ id: 3, name: "stage", transform: pos([0.0, 0.15, -2.0]),
    shape: { Cuboid: { x: 14.0, y: 0.3, z: 8.0 } },
    material: { color: [0.16, 0.15, 0.22, 1.0], roughness: 0.6 } });

  // The kit: kick pulses on the beat, the hat halo rides the highs.
  add({ id: 10, name: "kick_drum", transform: pos([0.0, 1.0, -3.0]),
    shape: { Cylinder: { radius: 1.1, height: 1.4 } },
    material: { color: [0.85, 0.25, 0.35, 1.0], emissive: [0.9, 0.1, 0.2, 1.0] },
    modulations: [
      { target: "scale", signal: "beat", range: [0.94, 1.12], smoothing: 0.02 },
      { target: "emissive", signal: { stem: "drums" }, range: [0.4, 2.6], smoothing: 0.08 } ] });
  add({ id: 11, name: "hat_halo", transform: pos([2.6, 2.6, -3.0]),
    shape: { Torus: { major_radius: 0.8, minor_radius: 0.08 } },
    material: { color: [0.95, 0.9, 0.5, 1.0], metallic: 0.9, roughness: 0.2 },
    modulations: [
      { target: "offset_y", signal: "highs", range: [0.0, 0.45], smoothing: 0.02 },
      { target: "emissive", signal: "highs", range: [0.3, 2.2], smoothing: 0.04 } ] });
  add({ id: 12, name: "snare_plate", transform: pos([-2.6, 1.6, -3.0]),
    shape: { Cylinder: { radius: 0.7, height: 0.08 } },
    material: { color: [0.9, 0.85, 0.4, 1.0], metallic: 0.8, roughness: 0.25 },
    modulations: [
      { target: "offset_y", signal: { stem: "drums" }, range: [0.0, 0.5], smoothing: 0.05 },
      { target: "emissive", signal: { stem: "drums" }, range: [0.3, 2.0], smoothing: 0.1 } ] });

  // The bass wall: three pillars swelling with the root.
  for (let i = 0; i < 3; i++) {
    add({ id: 20 + i, name: `bass_pillar_${i}`,
      transform: pos([-5.0 + i * 5.0, 2.0, -8.0]),
      shape: { Cuboid: { x: 1.6, y: 4.0, z: 0.5 } },
      material: { color: [0.2, 0.35, 0.9, 1.0], emissive: [0.15, 0.3, 1.2, 1.0] },
      modulations: [
        { target: "scale", signal: "bass", range: [0.9, 1.25], smoothing: 0.05 },
        { target: "emissive", signal: "bass", range: [0.5, 2.2], smoothing: 0.07 } ] });
  }

  // The pad ring: four orbs orbiting the stage, glowing with the mix.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    add({ id: 30 + i, name: `pad_orb_${i}`,
      transform: pos([Math.sin(a) * 6.0, 1.4, -2.0 + Math.cos(a) * 6.0]),
      shape: { Sphere: { radius: 0.55 } },
      material: { color: [0.3, 0.7, 0.6, 1.0], emissive: [0.2, 0.9, 0.7, 1.0] },
      behaviors: [{ Orbit: { center_point: [0.0, 1.4, -2.0], radius: 6.0,
        speed: 18.0 + i * 6.0, axis: [0.0, 1.0, 0.0], phase: i * 90.0 } }],
      modulations: [
        { target: "emissive", signal: "energy", range: [0.4, 2.4], smoothing: 0.3 },
        { target: "scale", signal: { oscillator: { frequency: 0.2 + i * 0.1 } },
          range: [0.85, 1.15] } ] });
  }

  // The lead: one orb above the kit, the melody's ghost.
  add({ id: 40, name: "lead_orb", transform: pos([0.0, 4.5, -3.0]),
    shape: { Icosahedron: { radius: 0.8 } },
    material: { color: [0.95, 0.9, 1.0, 1.0], emissive: [1.4, 1.2, 2.2, 1.0],
      metallic: 0.4, roughness: 0.3 },
    modulations: [
      { target: "offset_y", signal: { oscillator: { frequency: 0.5 } }, range: [0.0, 1.2] },
      { target: "emissive", signal: { stem: "other" }, range: [0.6, 2.8], smoothing: 0.15 },
      { target: "scale", signal: { stem: "other" }, range: [0.9, 1.1], smoothing: 0.2 } ] });

  // The rig: two lights riding the beat and the bass.
  add({ id: 50, name: "beat_light", transform: pos([0.0, 6.0, 0.0]),
    shape: { Sphere: { radius: 0.15 } },
    material: { color: [0.1, 0.1, 0.1, 1.0], emissive: [3.0, 0.6, 0.8, 1.0] },
    light: { light_type: "point", color: [1.0, 0.5, 0.7, 1.0], intensity: 60000.0, range: 18.0 },
    modulations: [
      { target: "light_intensity", signal: "beat", range: [0.3, 1.8], smoothing: 0.03 },
      { target: "emissive", signal: "beat", range: [0.4, 3.0], smoothing: 0.03 } ] });
  add({ id: 51, name: "bass_light", transform: pos([0.0, 0.6, -6.0]),
    light: { light_type: "point", color: [0.4, 0.6, 1.0, 1.0], intensity: 40000.0, range: 16.0 },
    modulations: [
      { target: "light_intensity", signal: "bass", range: [0.2, 1.6], smoothing: 0.08 } ] });

  // The veil: two sheets whose opacity breathes with the whole mix.
  for (let i = 0; i < 2; i++) {
    add({ id: 60 + i, name: `veil_${i}`,
      transform: pos([-4.0 + i * 8.0, 2.5, -5.0]),
      shape: { Cuboid: { x: 5.0, y: 5.0, z: 0.06 } },
      material: { color: [0.7, 0.4, 0.9, 1.0], alpha_mode: "blend" },
      modulations: [
        { target: "opacity", signal: "energy", range: [0.15, 0.85], smoothing: 0.4 } ] });
  }

  return list;
}

export function manifest(soundtrack) {
  return {
    version: 3,
    meta: {
      name: "song-world",
      description: "A world that is a song: a synthesized 64-second performance whose analysis curves drive every entity — kick, hats and snare, a bass wall, orbiting pads, the lead, a light rig and a veil that breathes with the mix. The silent package performs on curves alone; the recording variant adds the audio and goes live-analyser.",
      tags: ["songworld", "soundtrack", "modulation"],
    },
    environment: {
      background_color: [0.04, 0.03, 0.08, 1.0],
      ambient_color: [0.5, 0.45, 0.8, 1.0],
      ambient_intensity: 90.0,
      fog_density: 0.015,
      fog_color: [0.05, 0.04, 0.1, 1.0],
    },
    camera: { position: [0.0, 3.5, 10.0], look_at: [0.0, 1.5, -3.0], fov_degrees: 55.0 },
    avatar: { height: 1.8, movement_speed: 5.0,
      spawn_position: [0.0, 0.2, 8.0], spawn_look_at: [0.0, 1.5, -3.0] },
    soundtrack,
    tours: [{
      name: "the-drop",
      description: "Front row, the bass wall, overhead for the drop",
      mode: "fly", speed: 3.0, loop_tour: false, autostart: false,
      waypoints: [
        { position: [0.0, 2.0, 6.0], look_at: [0.0, 1.2, -3.0],
          description: "The kit", pause_duration: 2.0 },
        { position: [-5.0, 2.5, -3.0], look_at: [-2.5, 2.0, -8.0],
          description: "The bass wall", pause_duration: 2.0 },
        { position: [0.0, 9.0, 2.0], look_at: [0.0, 1.0, -4.0],
          description: "The drop, from above", pause_duration: 3.0 },
      ],
    }],
    entities: entities(),
    next_entity_id: 70,
  };
}

export function soundtrack(withRecording, wavSha) {
  const c = curves();
  return {
    title: "song.world",
    artist: "songworld build",
    license: "Apache-2.0 (synthesized; no sampled recording)",
    duration: DURATION,
    bpm: BPM,
    beat_offset: 0.0,
    sections: SECTIONS,
    energy: c.energy,
    stems: c.stems,
    ...(withRecording ? { path: `assets/${wavSha}.wav` } : {}),
  };
}

// The session log: what a host records around a performance.
export function opsLog() {
  return [
    { revision: 1, timestamp_ms: 1790000300000, author: { name: "build" },
      ops: [{ tool: "build_songworld", args: { score: "am-f-c-g", bpm: BPM },
        result_hash: "sha256:9f14e45fceea167a5a36dedd4bea2543f",
        phase: "score", timestamp_ms: 1790000300010 }] },
    { revision: 1, timestamp_ms: 1790000305000, author: { name: "visitor-1" },
      ops: [
        { input: { actor: "visitor-1", position: [0.0, 1.8, 8.0], look: [180.0, -6.0] } },
        { input: { actor: "visitor-1", position: [-2.0, 1.8, 5.0], look: [200.0, -4.0] } },
        { input: { actor: "visitor-1", position: [-4.5, 1.8, 1.0], look: [230.0, -8.0], click: 20 } }] },
    { revision: 1, timestamp_ms: 1790000390000, author: { name: "host" },
      ops: [
        { clock: { playing: true, position_s: 0.0 } },
        { clock: { playing: false, position_s: 64.0 } },
        { state: { "plays.count": 1 } }] },
  ];
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function writePackage(dir, manifestJson, withAssets, wavBuffer) {
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifestJson, null, 1) + "\n");
  writeFileSync(path.join(dir, "ops.jsonl"),
    opsLog().map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(path.join(dir, "state.json"), JSON.stringify({
    format_version: 1,
    fields: { "plays.count": { type: "int", initial: 0 } },
  }, null, 1) + "\n");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    format_version: 1,
    name: withAssets ? "song-world-recording" : "song-world",
    profiles: ["viewer", "player", "session"],
    base_revision: 0,
    head_revision: 1,
    refs: { main: "line-3" },
    forked_from: withAssets ? "song-world@line-3" : null,
    seed: null,
    updated_ms: 1790000390000,
  }, null, 1) + "\n");
  if (withAssets && wavBuffer) {
    const sha = createHash("sha256").update(wavBuffer).digest("hex");
    writeFileSync(path.join(dir, "assets", `${sha}.wav`), wavBuffer);
    return sha;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const c = curves();
  // The silent package: curves only.
  writePackage(path.join(root, "world"),
    manifest(soundtrack(false)), false, null);
  // The recording: same score, plus the WAV, content-addressed.
  const buffer = wav(render());
  const sha = createHash("sha256").update(buffer).digest("hex");
  writePackage(path.join(root, "world-recording"),
    manifest(soundtrack(true, sha)), true, buffer);
  console.log(`wrote world/ (silent) and world-recording/`);
  console.log(`  curves: ${c.energy.length} s, stems: ${Object.keys(c.stems).join(", ")}`);
  console.log(`  recording: ${(buffer.length / 1e6).toFixed(1)} MB, sha256 ${sha.slice(0, 12)}…`);
}
