# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

song.world — the first independent producer of Open World Format
packages, and a rhythm demo world: one synthesized 64-second score
whose analysis curves drive every entity. The sibling checkout
`../openworldformat` holds the spec, the schema and the JS reference
this repo consumes; changes to the format's semantics happen there,
not here.

## Rules

- Deterministic builds only: `node build` must reproduce `world/` and
  `world-recording/` byte for byte. Any randomness comes from a fixed
  seed. The WAV's SHA-256 is its filename — never rename it by hand.
- `world/` and `world-recording/` are generated artifacts but they are
  COMMITTED: the packages are the product. Edit `build/build.mjs`, run
  `npm run build`, commit both. They are head-first packages (format 2):
  `package.json` names the bytes of `manifest.json` and `ops.jsonl`
  (`world_sha256`, `log_sha256`) and entry ids are content hashes, so a
  hand edit to any of them is a corrupt package.
- The silent package ships no audio. If a change gives it a `path`,
  the point of the demo is lost — the recording belongs in
  `world-recording/` only.
- Every modulation target must be one the reference renderer honors
  (emissive, scale, light_intensity, opacity, offset_y) and every
  signal must resolve against the soundtrack — the tests enforce both.
- Validate against the sibling schemas before committing format changes:
  `npx ajv-cli@5 validate -s ../openworldformat/schema/world.schema.json
  -d "world/manifest.json" -d "world-recording/manifest.json"
  --spec=draft2020 --strict=false`, and `state.schema.json` against
  both `state.json` files the same way.
- Conventional commits, no Co-Authored-By trailers. `npm test` must
  pass before reporting completion.
- License: Apache-2.0, including the synthesized music — never add
  sampled or licensed audio to this repository.

## Open items

- Schema validation still reads the sibling checkout
  (`../openworldformat/schema/`) — the normative schema doesn't ship in
  the npm package. If that sibling is absent, validate via the GitHub
  raw URL instead.
