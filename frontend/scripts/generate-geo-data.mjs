#!/usr/bin/env node
/**
 * Generates the static geo dataset under src/data/geo/ (countries, top-level ISO 3166-2 regions,
 * country → IANA timezones, and cities per country). Run once when the data needs refreshing —
 * the output is committed, so neither the app nor CI needs these sources or any npm dependency.
 *
 * Usage: node scripts/generate-geo-data.mjs <source-dir>
 *
 * <source-dir> must contain (download them yourself; nothing is fetched here):
 *   iso_3166-1.json, iso_3166-2.json  — Debian iso-codes (salsa.debian.org/iso-codes-team/iso-codes, data/), LGPL-2.1
 *   cities15000.txt (unzipped), admin1CodesASCII.txt, timeZones.txt — GeoNames (download.geonames.org/export/dump/), CC BY 4.0
 *
 * Region codes are the ones MaxMind returns as subdivisions[0].iso_code (top-level ISO 3166-2),
 * stored country-prefixed ("US-CA"), which the tracking server's targeting matcher accepts as-is.
 * GeoNames admin1 codes are NOT ISO, so each city's region is resolved by matching admin1 names
 * against ISO subdivision names; cities whose region can't be matched keep region "" (still
 * listed for the country, just not narrowed by region).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/generate-geo-data.mjs <source-dir>'); process.exit(1); }
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/geo/generated');

const readJson = (f) => JSON.parse(readFileSync(join(src, f), 'utf8'));
const readTsv = (f) => readFileSync(join(src, f), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));

// ── Countries ────────────────────────────────────────────────────────────────
const countries = readJson('iso_3166-1.json')['3166-1'].map((c) => c.alpha_2);
if (!countries.includes('XK')) countries.push('XK'); // Kosovo: not ISO, but MaxMind/GeoNames emit it
countries.sort();
const countrySet = new Set(countries);

// ── Name normalisation for admin1 ↔ ISO matching ─────────────────────────────
const STOP = /\b(state|province|provincia|region|regione|région|oblast|krai|kray|republic|of|the|governorate|prefecture|county|district|department|departamento|municipality|city|autonomous|community|comunidad|territory|union|capital|federal|special|administrative|voivodeship|canton|emirate|division|parish|island|islands|and|al|el|la|le|de|del|di|du)\b/g;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’'`]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();

// ── Top-level ISO 3166-2 subdivisions ────────────────────────────────────────
/** cc → [{ code: 'US-CA', name }] */
const regionsByCountry = new Map();
for (const s of readJson('iso_3166-2.json')['3166-2']) {
  if (s.parent) continue; // top level only — that's what MaxMind puts in subdivisions[0]
  const cc = s.code.slice(0, 2);
  if (!countrySet.has(cc)) continue;
  if (!regionsByCountry.has(cc)) regionsByCountry.set(cc, []);
  regionsByCountry.get(cc).push({ code: s.code, name: s.name });
}

// ── GeoNames admin1 → ISO region ─────────────────────────────────────────────
/** "IN.16" → "IN-MH" (or undefined when unmatched) */
const admin1ToIso = new Map();
let a1Total = 0; let a1Matched = 0;
for (const [key, name, ascii] of readTsv('admin1CodesASCII.txt')) {
  const [cc, a1] = key.split('.');
  const regions = regionsByCountry.get(cc);
  if (!regions) continue;
  a1Total++;
  const n1 = norm(name); const n2 = norm(ascii);
  const byName = regions.find((r) => { const rn = norm(r.name); return rn === n1 || rn === n2; })
    ?? regions.find((r) => { const rn = norm(r.name); return rn.length > 3 && (n1.includes(rn) || rn.includes(n1)); });
  // Same code is only trusted when the names also agree (JP.40 ≠ JP-40 — numbering differs).
  const byCode = regions.find((r) => r.code === `${cc}-${a1}`);
  const hit = byName ?? (byCode && norm(byCode.name).split(' ')[0] === n1.split(' ')[0] ? byCode : undefined);
  if (hit) { admin1ToIso.set(key, hit.code); a1Matched++; }
}

// ── Cities (pop ≥ 15k) + population-weighted timezones ───────────────────────
/** cc → [{ name, region, pop, tz }] */
const citiesByCountry = new Map();
const tzPop = new Map(); // `${cc}|${tz}` → population
const regionTzPop = new Map(); // `${regionCode}|${tz}` → population
let citiesTotal = 0; let citiesWithRegion = 0;
for (const f of readTsv('cities15000.txt')) {
  const name = f[1]; const cc = f[8]; const a1 = f[10]; const pop = Number(f[14]) || 0; const tz = f[17];
  if (!countrySet.has(cc) || !name) continue;
  const region = admin1ToIso.get(`${cc}.${a1}`) ?? '';
  citiesTotal++; if (region) citiesWithRegion++;
  if (!citiesByCountry.has(cc)) citiesByCountry.set(cc, []);
  citiesByCountry.get(cc).push({ name, region, pop, tz });
  if (tz) {
    tzPop.set(`${cc}|${tz}`, (tzPop.get(`${cc}|${tz}`) ?? 0) + pop);
    if (region) regionTzPop.set(`${region}|${tz}`, (regionTzPop.get(`${region}|${tz}`) ?? 0) + pop);
  }
}

// Every zone GeoNames assigns to a country, ordered by the population living in it (primary first).
const zonesByCountry = new Map();
for (const [cc, tz] of readTsv('timeZones.txt').slice(1)) {
  if (!countrySet.has(cc) || !tz) continue;
  if (!zonesByCountry.has(cc)) zonesByCountry.set(cc, []);
  zonesByCountry.get(cc).push(tz);
}
const timezones = {};
for (const cc of countries) {
  const zones = Array.from(new Set(zonesByCountry.get(cc) ?? []));
  for (const [k] of tzPop) { const [c, tz] = k.split('|'); if (c === cc && !zones.includes(tz)) zones.push(tz); }
  zones.sort((a, b) => (tzPop.get(`${cc}|${b}`) ?? 0) - (tzPop.get(`${cc}|${a}`) ?? 0) || a.localeCompare(b));
  if (zones.length) timezones[cc] = zones;
}

// Region rows: [code, name, primaryTz?] — tz only when it differs from the country's primary.
const regions = {};
for (const [cc, list] of regionsByCountry) {
  const primary = timezones[cc]?.[0];
  regions[cc] = list
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => {
      let best = ''; let bestPop = -1;
      for (const [k, p] of regionTzPop) { const [rc, tz] = k.split('|'); if (rc === r.code && p > bestPop) { best = tz; bestPop = p; } }
      return best && best !== primary ? [r.code, r.name, best] : [r.code, r.name];
    });
}

// ── Write ────────────────────────────────────────────────────────────────────
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'cities'), { recursive: true });
const header = 'Generated by scripts/generate-geo-data.mjs from Debian iso-codes (LGPL-2.1) and GeoNames (CC BY 4.0, https://www.geonames.org). Do not edit by hand.';
writeFileSync(join(out, 'countries.json'), JSON.stringify(countries));
writeFileSync(join(out, 'timezones.json'), JSON.stringify(timezones));
writeFileSync(join(out, 'regions.json'), JSON.stringify(regions));
let cityFiles = 0;
for (const [cc, list] of citiesByCountry) {
  // Biggest first; one row per (name, region) — GeoNames lists some places twice (PPL + PPLA).
  const seen = new Set();
  const rows = list.sort((a, b) => b.pop - a.pop).filter((c) => { const k = `${c.name}|${c.region}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((c) => (c.region ? [c.name, c.region.slice(3)] : [c.name]));
  writeFileSync(join(out, 'cities', `${cc}.json`), JSON.stringify(rows));
  cityFiles++;
}
writeFileSync(join(out, 'SOURCE.md'), `${header}\n`);

console.log(`countries ${countries.length}, countries with regions ${regionsByCountry.size}, with timezones ${Object.keys(timezones).length}`);
console.log(`admin1 matched to ISO ${a1Matched}/${a1Total}; cities ${citiesTotal} (${citiesWithRegion} with region) in ${cityFiles} files`);
