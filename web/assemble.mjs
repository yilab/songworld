// Assemble the shareable page: the published renderer + three.js + the
// packages, copied into web/assembled/ (gitignored — rerun after a
// build; the copies are outputs, never sources).
//
//   npm run assemble   →  web/assembled/  →  any static host
//
// The renderer comes from node_modules/openworldformat — the registry
// copy, not a sibling checkout: the page ships what npm shipped.

import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "web", "assembled");

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "vendor/three/build"), { recursive: true });
await mkdir(path.join(out, "vendor/three/examples/jsm"), { recursive: true });
await mkdir(path.join(out, "pkg"), { recursive: true });

// three.js: the build plus the addons the renderer imports.
const three = path.join(root, "node_modules", "three");
// three >= 0.16x: the module build and its core chunk (the .min build
// is gone); examples/jsm imports resolve through the importmap.
for (const f of ["three.module.js", "three.core.js"]) {
  await cp(path.join(three, "build", f), path.join(out, "vendor/three/build", f));
}
for (const dir of ["loaders", "controls", "utils"]) {
  await cp(path.join(three, `examples/jsm/${dir}`),
    path.join(out, `vendor/three/examples/jsm/${dir}`), { recursive: true });
}

// The published renderer, verbatim, and the page that hosts it. Resolved
// through the package's exports map (openworldformat/render), so an
// upstream file move fails here at assemble time, not as a page 404.
const require = createRequire(import.meta.url);
await cp(require.resolve("openworldformat/render"), path.join(out, "world-viewer.js"));
await cp(path.join(root, "web", "index.html"), path.join(out, "index.html"));

// The packages: manifest, log, state — and the recording's assets.
for (const pkg of ["world", "world-recording"]) {
  await mkdir(path.join(out, "pkg", pkg), { recursive: true });
  for (const f of await readdir(path.join(root, pkg))) {
    if (f === "assets") {
      await cp(path.join(root, pkg, "assets"), path.join(out, "pkg", pkg, "assets"),
        { recursive: true });
    } else if (f.endsWith(".json") || f.endsWith(".jsonl")) {
      await cp(path.join(root, pkg, f), path.join(out, "pkg", pkg, f));
    }
  }
}

const worlds = ["world", "world-recording"];
console.log(`assembled ${worlds.length} packages, the renderer, and three.js into web/assembled/`);
