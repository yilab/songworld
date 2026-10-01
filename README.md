# song.world

**A `.world` that is a song.** A synthesized 64-second performance
whose analysis curves drive every entity in a stage world — the kick
pulses on the beat, the bass wall swells with the root, four pads orbit
glowing with the mix, a light rig rides the drop, and a veil breathes
with the whole arrangement.

The first independent producer of
[Open World Format](https://openworldformat.org) packages: no LocalGPT
code, no spec-repo checkout — just `openworldformat` from npm, plus
the normative schema for validation.

## Two packages, one score

| Package | What it is |
|---|---|
| `world/` | **The silent package** — soundtrack analysis curves, no audio file. Modulations run on the curves alone: *a world performs a piece of music without shipping the recording*. |
| `world-recording/` | **The recording** — the same score plus a 4 MB synthesized WAV, content-addressed under `assets/<sha256>.wav`; `bass`/`highs` modulations switch to the live analyser while it plays. |

Both are built from one deterministic score (`node build` reproduces
them byte for byte — the WAV's SHA-256 is its filename, and the test
suite checks it). The arrangement is legible in the curves themselves:
the drop's energy dwarfs the intro's, and a test asserts it.

## The score

`build/build.mjs` composes 32 bars at 120 BPM in A minor (Am–F–C–G):
kick and snare in the drop, hats from the build, an eighth-note bass,
a detuned pad, and a sixteenth-note arp. The analysis curves — one
value per second for `energy` and the `drums`/`bass`/`other` stems —
are computed analytically from the same event schedule the synthesizer
renders. No samples, no recordings, nothing to license: Apache-2.0 all
the way down.

## Use

```bash
npm install   # openworldformat ^0.1.0, from the registry
npm run build # regenerates world/ and world-recording/ (deterministic)
npm test      # folds, validates, and checks the arrangement reads
```

The reference comes from npm — this repository holds no LocalGPT code
and no spec-repo symlinks; parse, fold and state-folding all run
against the published package.

Any conforming renderer opens `world/manifest.json`; the audio starts
from the world's own soundtrack block, not a player widget.

## The page

`web/` assembles the shareable site — the **published** renderer from
`node_modules/openworldformat`, three.js vendored, both packages — into
`web/assembled/` (gitignored; rerun after a build):

```bash
npm run assemble && python3 -m http.server -d web/assembled 8000
npm run check   # headless: both packages must render, zero errors
```

CI goes further: the committed packages must be **byte-reproducible**
(`npm run build && git diff --exit-code`), the page must render
headless, and the manifests must validate against the spec's normative
schema.

## Layout

```
build/build.mjs   the score, the synth, the curves, the emitter
world/            the silent package (curves only)
world-recording/  the package with the recording (content-addressed)
test/             folds + schema discipline + musical assertions
web/              the shareable page (assembled; gitignored output)
```

## License

Apache-2.0. The music is synthesized by this repository's build and
ships under the same license.
