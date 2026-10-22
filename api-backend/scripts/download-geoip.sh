#!/usr/bin/env bash
# Download the GeoIP databases the tracker reads country / region / city / ISP from (spec §2). Without a
# city database, GEO rules (allow / block countries, per-country payouts) and geo targeting are NOT
# enforced — every country is let through.
#
#   MaxMind GeoLite2 (recommended)  — free account at maxmind.com/en/geolite2/signup → Manage License Keys →
#                                     put MAXMIND_ACCOUNT_ID=… and MAXMIND_LICENSE_KEY=… in api-backend/.env.
#                                     Updated twice a week. (Without the account id the older key-only
#                                     download link is used.)
#   DB-IP Lite (fallback, no account) — used when there is no MaxMind key. Updated monthly, CC BY 4.0
#                                     (credit "IP Geolocation by DB-IP" with a link to db-ip.com).
#
# Files land in data/geoip/ (git-ignored); the tracking server reloads them within 10 minutes, no restart.
# Re-run weekly (MaxMind) or monthly (DB-IP) to stay current, e.g. from cron.
#
#   npm run geoip:download
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="data/geoip"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The key / account id from the environment, else from .env (those lines only — .env is never sourced).
from_env_file() { [[ -f .env ]] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true; }
KEY="${MAXMIND_LICENSE_KEY:-$(from_env_file MAXMIND_LICENSE_KEY)}"
ACCOUNT="${MAXMIND_ACCOUNT_ID:-$(from_env_file MAXMIND_ACCOUNT_ID)}"

# Atomic replace: the tracker never opens a half-written file.
install_db() { mv -f "$1" "$DEST/$2.tmp" && mv -f "$DEST/$2.tmp" "$DEST/$2"; echo "  -> $DEST/$2"; }

if [[ -n "$KEY" ]]; then
  for edition in GeoLite2-City GeoLite2-ASN; do
    echo "Downloading MaxMind ${edition}…"
    if [[ -n "$ACCOUNT" ]]; then  # MaxMind's current link: HTTP basic auth (account id : license key)
      curl -sSfL -u "${ACCOUNT}:${KEY}" "https://download.maxmind.com/geoip/databases/${edition}/download?suffix=tar.gz" -o "$TMP/$edition.tar.gz"
    else
      curl -sSfL "https://download.maxmind.com/app/geoip_download?edition_id=${edition}&license_key=${KEY}&suffix=tar.gz" -o "$TMP/$edition.tar.gz"
    fi
    mkdir -p "$TMP/$edition"
    tar -xzf "$TMP/$edition.tar.gz" -C "$TMP/$edition"            # portable: no GNU-only --wildcards
    found="$(find "$TMP/$edition" -name "$edition.mmdb" -type f | head -1)"
    [[ -n "$found" ]] || { echo "No $edition.mmdb in the download — is the license key right?" >&2; exit 1; }
    install_db "$found" "$edition.mmdb"
  done
  # A MaxMind database wins; drop DB-IP copies so it's clear which one is loaded.
  rm -f "$DEST/dbip-city-lite.mmdb" "$DEST/dbip-asn-lite.mmdb"
else
  echo "No MAXMIND_LICENSE_KEY — using DB-IP Lite (free, monthly, CC BY 4.0)."
  for kind in city asn; do
    ok=""
    for month in "$(date -u +%Y-%m)" "$(date -u -v-1m +%Y-%m 2>/dev/null || date -u -d '1 month ago' +%Y-%m)"; do
      url="https://download.db-ip.com/free/dbip-${kind}-lite-${month}.mmdb.gz"
      echo "Downloading ${url}…"
      if curl -sSfL "$url" -o "$TMP/$kind.mmdb.gz"; then ok=1; break; fi
    done
    [[ -n "$ok" ]] || { echo "DB-IP $kind download failed." >&2; exit 1; }
    gunzip -f "$TMP/$kind.mmdb.gz"
    install_db "$TMP/$kind.mmdb" "dbip-${kind}-lite.mmdb"
  done
fi
echo "Done. Check: curl -s localhost:4002/health | grep -o '\"geoip\":{[^}]*}'"
