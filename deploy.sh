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

# Logged in is not enough: the login must reach the account wrangler.jsonc
# pins, or wrangler fails on the API with an authentication error.
account=$(sed -nE 's/.*"account_id": *"([0-9a-f]{32})".*/\1/p' wrangler.jsonc)
: "${account:?wrangler.jsonc pins no account_id}"
if ! npx --yes wrangler whoami 2>&1 | grep -q "$account"; then
  echo "Not logged in to the Cloudflare account songworld deploys to ($account)."
  echo "Run: npx wrangler login"
  exit 1
fi

npx --yes wrangler deploy
