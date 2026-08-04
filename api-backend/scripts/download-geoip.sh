#!/usr/bin/env bash
# Download MaxMind GeoLite2 City + ASN databases for in-process geo enrichment (spec §2).
# Requires a free MaxMind account + license key in MAXMIND_LICENSE_KEY.
# Without these DBs the click path still works (geo enrichment fails-open).
set -euo pipefail

: "${MAXMIND_LICENSE_KEY:?Set MAXMIND_LICENSE_KEY (free at maxmind.com)}"
DEST="$(dirname "$0")/../data/geoip"
mkdir -p "$DEST"

fetch() {
  local edition="$1"
  echo "Downloading $edition..."
  curl -sSL "https://download.maxmind.com/app/geoip_download?edition_id=${edition}&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" \
    | tar -xz -C "$DEST" --strip-components=1 --wildcards "*/${edition}.mmdb"
  echo "  -> $DEST/${edition}.mmdb"
}

fetch GeoLite2-City
fetch GeoLite2-ASN
echo "Done. Set MAXMIND_CITY_DB / MAXMIND_ASN_DB if you keep them elsewhere."
