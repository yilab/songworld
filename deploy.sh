#!/usr/bin/env bash
# Deploy the assembled page as the "songworld" Cloudflare Worker (static
# assets), serving songworld.<subdomain>.workers.dev.
#
# Assembles first: web/assembled/ is gitignored — the renderer and
# three.js come from node_modules, the packages from world/ and
# world-recording/ — so a deploy always publishes a fresh copy of what
# the repository currently builds.
set -euo pipefail
cd "$(dirname "$0")"

npm run assemble

if ! npx --yes wrangler whoami 2>&1 | grep -q "Account Name"; then
  echo "Not logged in to Cloudflare. Run: npx wrangler login"
  exit 1
fi

npx --yes wrangler deploy
