#!/usr/bin/env bash
set -euo pipefail

if [ -z "${KOYEB_TOKEN:-}" ]; then
  echo "KOYEB_TOKEN is required."
  echo "Create one at: https://app.koyeb.com/user/settings/api"
  exit 1
fi

KOYEB_BIN="${KOYEB_BIN:-$HOME/.koyeb/bin/koyeb}"

if [ ! -x "$KOYEB_BIN" ]; then
  echo "Koyeb CLI not found at $KOYEB_BIN"
  exit 1
fi

APP_NAME="${KOYEB_APP_NAME:-yigiyio}"
SERVICE_NAME="${KOYEB_SERVICE_NAME:-game}"

"$KOYEB_BIN" deploy . "$APP_NAME/$SERVICE_NAME" \
  --token "$KOYEB_TOKEN" \
  --archive-builder buildpack \
  --archive-buildpack-run-command "npm start" \
  --env PORT=3000 \
  --ports 3000:http \
  --routes "/:3000" \
  --checks "3000:http:/" \
  --instance-type free \
  --type web \
  --wait
