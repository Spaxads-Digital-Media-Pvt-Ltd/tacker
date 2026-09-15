# Task 9.3.4-B — A-1 Fix: Click-Ownership Bypass in POST /advertiser/conversions

**Date:** 2026-09-12
**Branch:** main
**Finding fixed:** A-1 (CRITICAL) from Task 9.3.4-A Public API Security Audit
**Scope:** `src/surfaces/public-api/advertiser.ts` — the POST /advertiser/conversions handler only

---

## 1. Root Cause

The ownership check in `src/surfaces/public-api/advertiser.ts` (lines 76-85 in the pre-fix version) was:

```typescript
// PRE-FIX (vulnerable)
const { rows } = await query(
 `SELECT o.advertiser_id FROM clicks c JOIN offers o ON o.id = c.offer_id
 WHERE c.click_id = $1 AND c.network_id = $2 LIMIT 1`,
 [clickId, id.networkId],
);
if (rows[0] && rows[0].advertiser_id !== id.ownerId) {
 throw forbidden('...');
}
// implicit: missing row → passes through to recordConversion()
```

When the click record is absent from `clicks` (Postgres), `rows[0]` is `undefined` and the check is skipped entirely. `recordConversion()` then runs the Redis fast-path `findClick()`, which locates the click and attributes the conversion to whatever advertiser owns the offer. The caller's key determines only which network namespace is used — not which advertiser gets credited.

**Attack scenario:**
1. Advertiser A has a valid API key.
2. A click is generated for an offer owned by Advertiser B (stored in Redis, not yet persisted to `clicks` table).
3. Advertiser A sends `POST /conversions` with that `click_id`.
4. The JOIN query returns zero rows → ownership check is vacuously skipped.
5. `recordConversion()` finds the click in Redis → attributes conversion to Advertiser B's offer.
6. Conversion is recorded under Advertiser B's financial records, with Advertiser A's key as the caller.

---

## 2. Exact Fix

The fix in `src/surfaces/public-api/advertiser.ts` replaces the single-Postgres-check with a two-tier lookup:

```typescript
// POST-FIX (lines 76-105)
let clickAdvertiserId: string | null = null;

// Tier 1: Postgres — definitive once flushed
const pgRow = await query<{ advertiser_id: string | null }>(
 `SELECT o.advertiser_id FROM clicks c JOIN offers o ON o.id = c.offer_id
 WHERE c.click_id = $1 AND c.network_id = $2 LIMIT 1`,
 [clickId, id.networkId],
).then((r) => r.rows[0] ?? null);

if (pgRow) {
 clickAdvertiserId = pgRow.advertiser_id;
} else {
 // Tier 2: Redis click-store — valid during async flush window
 const stored = await getStoredClick(id.networkId, clickId);
 if (!stored) {
 throw forbidden('Click not found. Cannot verify ownership for this click_id.');
 }
 const offerRow = await query<{ advertiser_id: string }>(
 `SELECT advertiser_id FROM offers WHERE id = $1 AND network_id = $2 LIMIT 1`,
 [stored.offer_id, id.networkId],
 );
 clickAdvertiserId = offerRow.rows[0]?.advertiser_id ?? null;
}

if (clickAdvertiserId !== id.ownerId) {
 throw forbidden('This click does not belong to your offers.');
}
```

**Key change:** A click must be found in **at least one** store (Postgres or Redis) before ownership is checked. Absence from both = rejected. The check no longer has an implicit "trust when unknown" branch.

---

## 3. Security Reasoning

The fix closes the bypass by making the ownership check explicit:

- **Before:** `if (rows[0] && rows[0].advertiser_id !== id.ownerId)` — absence = pass
- **After:** Click must be found in Postgres OR Redis; if neither, `403 forbidden`

An attacker who knows an unflushed `click_id` for another advertiser's offer can no longer exploit the gap. The only remaining paths to acceptance are:
1. The click is found in Postgres AND `advertiser_id === id.ownerId` (legitimate advertiser posting for their own click).
2. The click is in Redis AND the offer lookup confirms it belongs to the caller's advertiser (race window — legitimate S2S postback arriving before flush completes).

Both paths require the caller to actually own the click — there is no implicit trust path.

---

## 4. Race-Condition Handling

The click hot-path writes to Redis *before* async Postgres persistence:

```
click → Redis (immediate) → BullMQ worker → Postgres flush (async, ~100-500ms delay)
```

The two-tier design preserves this legitimate flow:

- **Tier 1 (Postgres):** definitive ownership source. If the click has flushed, this is the source of truth.
- **Tier 2 (Redis `getStoredClick`):** secondary source for the async flush window. When the Postgres check returns empty, the Redis click-store is queried. If a stored click exists, its `offer_id` is used to look up the owning advertiser via a separate `offers` table query.

The Redis lookup is **read-only** and **network-scoped** (`id.networkId`), so there is no cross-tenant data leak. The fallback is only reachable through the ownership check — it cannot be used to bypass the check.

---

## 5. Tenant-Isolation Reasoning

All three tiers of the check filter by `networkId`:

- **Postgres tier:** `WHERE c.click_id = $1 AND c.network_id = $2` — click must belong to the caller's network.
- **Redis tier:** `getStoredClick(id.networkId, clickId)` — stored click is keyed by `(networkId, clickId)`.
- **Offer lookup tier:** `WHERE id = $1 AND network_id = $2` — offer must belong to the caller's network.

The `id.ownerId` (from `apiKeyAuth`) is compared against the resolved `clickAdvertiserId`. Cross-advertiser attempts within the same network are rejected (403). Cross-network clicks cannot be resolved because the click-store key is network-prefixed.

---

## 6. Tests Added

7 tests in `test/isolation/advertiser-click-ownership.test.ts`:

| # | Scenario | Expected | What it proves |
|---|----------|----------|----------------|
| 1 | Click in Postgres, owned by this advertiser | 201 | Legitimate flow preserved |
| 2 | Click absent from both Postgres and Redis | 403 | **A-1 fix** — no implicit pass |
| 3 | Click in Postgres, different advertiser | 403 | Cross-advertiser blocked |
| 4 | Click in Redis (not Postgres yet), offer owned by caller | 201 | Async flush window preserved |
| 5 | Click in Redis, offer belongs to different advertiser | 403 | Redis fallback enforces ownership |
| 6 | Click in Redis, offer not found in this network | 403 | Network-scoping in fallback |
| 7 | Missing `click_id` in request body | 400 | Pre-existing validation unaffected |

**Test design:** Each test builds a fresh Express app with isolated mocks (`vi.resetModules` + `vi.doMock` per test). The handler is exercised end-to-end via supertest, covering `apiKeyAuth → requireAudience → requireScope → ownership check → recordConversion`. The `recordConversion` function is mocked to avoid the deep internal call chain and focus the test on the handler-level A-1 fix.

---

## 7. Tests Executed / Results

```
test/isolation/advertiser-click-ownership.test.ts 7 passed (7)
test/isolation/api-audience.test.ts 3 passed (3) [regression]
```

---

## 8. Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/surfaces/public-api/advertiser.ts` | **Modified** | Two-tier ownership check (Postgres → Redis fallback → reject) |
| `test/isolation/advertiser-click-ownership.test.ts` | **Created** | 7 tests for A-1 ownership enforcement |

---

## 9. Remaining Limitations

- **Redis click-store is a soft trust boundary.** If the Redis instance is compromised, an attacker could inject stored clicks. This is an infrastructure trust assumption, not a code vulnerability — Redis is already used as the authoritative click source for the hot path.
- **Race window duration is bounded by the BullMQ flush interval** (configurable, defaults to ~100ms). An advertiser can only exploit a race window for clicks that have not yet been flushed. Once flushed to Postgres, ownership is definitively checked.
- **No key-level per-advertiser scoping on the Redis key.** The stored click is keyed by `(networkId, clickId)` — not `(networkId, advertiserId, clickId)`. The two-tier design compensates by doing a separate offer lookup after retrieving the stored click.
- **Fix does not address A-2, A-3, or MEDIUM findings** — out of scope for this task.
