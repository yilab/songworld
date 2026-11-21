// Validate the committed packages against the format's normative
// schemas: world.schema.json against both manifests, state.schema.json
// against both state documents — draft 2020, strict off, via ajv-cli.
//
//   npm run validate
//
// Each schema is resolved in order, first match wins:
//   1. the installed openworldformat package, through its ./schema/*
//      exports subpaths — the registry copy, version-matched to the
//      reference the build itself runs against (ships >= 0.3.8);
//   2. the sibling checkout ../openworldformat/schema/;
//   3. the spec repository's raw URL, downloaded to a temp dir.
// The dependency still predates 0.3.8, so today the sibling (or the
// URL, without a sibling) is the effective source — a dep bump flips
// the package path on by itself, with nothing to change here.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sibling = path.join(root, "..", "openworldformat", "schema");
const raw = "https://raw.githubusercontent.com/openworldformat/openworldformat/main/schema";

// schema file → the committed documents it governs
const cases = [
  ["world.schema.json", ["world/manifest.json", "world-recording/manifest.json"]],
  ["state.schema.json", ["world/state.json", "world-recording/state.json"]],
];

// Fallback 3, run at most once: fetch every schema the run needs into
// one temp dir, so cross-schema $refs (if any appear) still resolve.
let fetched = false;
async function fromUrl(name) {
  const dir = path.join(os.tmpdir(), "openworldformat-schema");
  if (!fetched) {
    await mkdir(dir, { recursive: true });
    for (const [n] of cases) {
      const res = await fetch(`${raw}/${n}`);
      if (!res.ok) throw new Error(`${n}: ${res.status} ${res.statusText}`);
      await writeFile(path.join(dir, n), await res.text());
    }
    fetched = true;
  }
  return path.join(dir, name);
}

async function resolveSchema(name) {
  try {
    return [require.resolve(`openworldformat/schema/${name}`), "installed package"];
  } catch {
    // no ./schema/* exports — the installed dependency predates them
  }
  const local = path.join(sibling, name);
  if (existsSync(local)) return [local, "sibling checkout"];
  return [await fromUrl(name), "GitHub raw URL"];
}

let failed = false;
for (const [name, docs] of cases) {
  let schema, source;
  try {
    [schema, source] = await resolveSchema(name);
  } catch (e) {
    console.error(`cannot resolve ${name}: ${e.message}`);
    failed = true;
    continue;
  }
  const shown = schema.startsWith(root + path.sep) ? path.relative(root, schema) : schema;
  console.log(`${name}: ${source} (${shown})`);
  const r = spawnSync("npx", ["-y", "ajv-cli@5", "validate", "-s", schema,
    ...docs.flatMap((d) => ["-d", d]), "--spec=draft2020", "--strict=false"],
    { cwd: root, stdio: "inherit" });
  if (r.error || r.status !== 0) {
    if (r.error) console.error(r.error.message);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("both packages validate against the normative schemas");
