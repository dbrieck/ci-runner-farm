#!/bin/bash
# Publish the plugin to a public Google Cloud Storage bucket — the private-fork
# alternative to GitHub release assets (Unraid's plugin installer downloads
# anonymously, so private release URLs 404; a public GCS object serves raw
# bytes at a stable URL, and the .plg's MD5 pin keeps hosting integrity-neutral).
#
#   ./scripts/publish-gcs.sh <bucket> [location]
#
# What it does:
#   1. creates gs://<bucket> if it doesn't exist (uniform access, public read)
#   2. builds ci-runner-farm.plg + .tgz with PLUGIN_URL_BASE pointing at the bucket
#   3. uploads the version-pinned .tgz and the .plg (the .plg with
#      Cache-Control: no-cache, so Unraid's "check for updates" always sees
#      the newest version stamp instead of a cached copy)
#   4. prints the public .plg URL to paste into Plugins > Install Plugin
#
# Requires the gcloud CLI, authenticated (gcloud auth login) with a default
# project set (gcloud config set project <id>). Old version-pinned .tgz files
# are left in the bucket so an already-installed .plg can always re-fetch its
# exact package; they're ~40KB each, prune whenever you like.
set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET="${1:?usage: $0 <bucket> [location]}"
LOCATION="${2:-us-central1}"
NAME="ci-runner-farm"
BASE_URL="https://storage.googleapis.com/${BUCKET}"

command -v gcloud >/dev/null 2>&1 || {
  echo "ERROR: gcloud CLI not found — install the Google Cloud SDK and run 'gcloud auth login'" >&2
  exit 1
}

# ---- 1. bucket (create if missing, ensure public read) ----------------------
if gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  echo "[publish-gcs] bucket gs://${BUCKET} exists"
else
  echo "[publish-gcs] creating gs://${BUCKET} in ${LOCATION}"
  gcloud storage buckets create "gs://${BUCKET}" \
    --location="${LOCATION}" --uniform-bucket-level-access
fi
# Idempotent: re-adding an existing binding is a no-op.
echo "[publish-gcs] ensuring public read (allUsers -> objectViewer)"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member=allUsers --role=roles/storage.objectViewer >/dev/null

# ---- 2. build with URLs pointing at the bucket -------------------------------
echo "[publish-gcs] building with PLUGIN_URL_BASE=${BASE_URL}"
PLUGIN_URL_BASE="${BASE_URL}" ./build-plg.sh

PKG="$(sed -n 's/^<!ENTITY packageName[[:space:]]*"\(.*\)">$/\1/p' "${NAME}.plg")"
[ -n "$PKG" ] || { echo "ERROR: could not read packageName from ${NAME}.plg" >&2; exit 1; }

# ---- 3. upload ----------------------------------------------------------------
# The .tgz is immutable (version-pinned name) — default caching is fine. The
# .plg is a moving target ("latest"), so no-cache keeps update checks honest.
echo "[publish-gcs] uploading ${NAME}.tgz -> gs://${BUCKET}/${PKG}"
gcloud storage cp "${NAME}.tgz" "gs://${BUCKET}/${PKG}"
echo "[publish-gcs] uploading ${NAME}.plg (Cache-Control: no-cache)"
gcloud storage cp --cache-control="no-cache" "${NAME}.plg" "gs://${BUCKET}/${NAME}.plg"

# ---- 4. done -------------------------------------------------------------------
echo ""
echo "Published. In the Unraid webGUI go to Plugins > Install Plugin and paste:"
echo ""
echo "  ${BASE_URL}/${NAME}.plg"
echo ""
echo "Re-run this script after changes: uploads a new version-pinned package and"
echo "overwrites the .plg, and Unraid's plugin update check picks it up."
