// Headless render check: serve web/assembled/, open the page in
// Chromium with software WebGL, and fail on any error, a missing
// canvas, or a viewer that reports no entities. Both packages must
// render; the silent one is the point of the demo.
//
//   npm run assemble && npm run check

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("./assembled/", import.meta.url));
const types = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".jsonl": "application/json", ".css": "text/css",
  ".wav": "audio/wav",
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  const file = join(root, path === "/" ? "index.html" : path);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

let failed = 0;
for (const pkg of ["pkg/world", "pkg/world-recording"]) {
  errors.length = 0;
  await page.goto(`${base}/?pkg=${pkg}`, { waitUntil: "load" });
  let info = null;
  try {
    await page.waitForFunction(
      () => window.owfViewer && window.owfViewer.sceneInfo().entityCount > 0,
      null, { timeout: 20000 },
    );
    info = await page.evaluate(() => window.owfViewer.sceneInfo());
  } catch {
    // reported below
  }
  const canvas = await page.evaluate(() => Boolean(document.querySelector("#scene canvas")));
  // The recording's audio must actually be reachable — the sound bug
  // this check missed was a doubled assets/ path 404ing the WAV.
  let audio = "n/a";
  if (pkg === "pkg/world-recording" && info) {
    audio = await page.evaluate(async () => {
      const st = window.owfViewer ? null : null;
      const response = await fetch("pkg/world-recording/manifest.json");
      const path = (await response.json()).soundtrack.path;
      const r = await fetch(`pkg/world-recording/${path}`, { method: "HEAD" });
      return r.status;
    });
  }
  const ok = Boolean(info) && canvas && errors.length === 0 && info.entityCount >= 15
    && (audio === "n/a" || audio === 200);
  if (!ok) failed += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${pkg}: entities=${info?.entityCount ?? 0}`
      + ` tours=${info?.tourCount ?? 0} canvas=${canvas} errors=${errors.length}`
      + (audio === "n/a" ? "" : ` audio=${audio}`),
  );
  for (const error of errors) console.log(`      ${error.slice(0, 300)}`);
}

await browser.close();
server.close();
if (failed) {
  console.log(`${failed} package(s) failed to render`);
  process.exit(1);
}
console.log("both packages rendered");
