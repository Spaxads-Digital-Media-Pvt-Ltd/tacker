# Task 9.3.4-C — A-2 Fix: Publisher Ownership Bypass in POST /payouts

**Date:** 2026-09-13
**Branch:** main
**Finding fixed:** A-2 (HIGH) from Task 9.3.4-A Public API Security Audit
**Scope:** `src/surfaces/public-api/network.ts` — the POST /payouts handler only

---

## 1. Root Cause

The POST /payouts handler in `src/surfaces/public-api/network.ts:85-96` accepted caller-supplied `publisherIds` from the request body and forwarded them verbatim to `createPayoutRun` with zero authorization checks.

```typescript
// PRE-FIX (vulnerable)
const b = (req.body ?? {}) as { publisherIds?: string[]; note?: string };
const result = await createPayoutRun(id.networkId, {
 ...(b.publisherIds ? { publisherIds: b.publisherIds } : {}),
 ...(b.note ? { note: b.note } : {}),
 createdBy: `apikey:${id.keyId}`,
});
```

The trust boundary was violated: the API layer forwarded entity IDs from an untrusted request body directly to a financial operation (ledger write + payout record creation). Whether `createPayoutRun` validated publisher ownership was not enforced at the surface layer.

Inside `createPayoutRun` (src/lib/ledger/ledger.ts:161-170), the SQL used `AND account_id = ANY($2)` to restrict results:

```sql
SELECT account_id, SUM(...) AS bal
FROM ledger_entries
WHERE network_id = $1 AND account_type = 'publisher' AND status = 'approved'
 AND account_id = ANY($2)
GROUP BY account_id
HAVING SUM(...) > 0
```

This filter checks array membership — if a foreign publisherId is inside the caller-supplied array, it matches. There is no join or subquery to verify the publisher belongs to the caller's network. A foreign publisherId inside the caller's array passes the filter, gets a balance computed, and a payout line is written for it.

**Attack scenario:**
1. Network A has a valid network-level API key.
2. Network A knows a publisher ID that belongs to Network B (e.g., from public referrer links, prior integrations, or enumeration).
3. Network A sends `POST /payouts` with `publisherIds: ["pub-in-net-A", "pub-in-net-B"]`.
4. The handler forwards both IDs to `createPayoutRun`.
5. `account_id = ANY(["pub-in-net-A", "pub-in-net-B"])` matches both IDs.
6. A payout line is written for `pub-in-net-B`, debiting their ledger balance under Network A's batch.

---

## 2. Exact Fix

The fix in `src/surfaces/public-api/network.ts` adds an authorization check before forwarding to `createPayoutRun`:

```typescript
// POST-FIX (lines 89-109)
const publisherIds: string[] | undefined = b.publisherIds?.filter(
 (x): x is string => typeof x === 'string',
);

if (publisherIds && publisherIds.length > 0) {
 const { rows } = await query<{ id: string }>(
 `SELECT id FROM publishers WHERE network_id = $1 AND id = ANY($2)`,
 [id.networkId, publisherIds],
 );
 const authorizedIds = new Set(rows.map((r) => r.id));
 const unauthorized = publisherIds.filter((pid) => !authorizedIds.has(pid));
 if (unauthorized.length > 0) {
 throw forbidden(
 `Publisher IDs not found in your network: ${unauthorized.map((x) => `"${x}"`).join(', ')}`,
 );
 }
}

const result = await createPayoutRun(id.networkId, {
 ...(publisherIds ? { publisherIds } : {}),
 ...(b.note ? { note: b.note } : {}),
 createdBy: `apikey:${id.keyId}`,
});
```

**Key changes:**
1. The `publisherIds` array is type-filtered (string-only) before use.
2. A `SELECT id FROM publishers WHERE network_id = $1 AND id = ANY($2)` query resolves which caller-supplied IDs actually belong to the authenticated network.
3. Any ID not in that result set (foreign publisher or nonexistent) causes a `403 forbidden` — the request is rejected before `createPayoutRun` is called.
4. `createPayoutRun` receives only IDs that passed the authorization gate.

**Missing import fix:** `forbidden` was added to the import from `../../lib/http/errors.js` (was previously not imported in network.ts).

---

## 3. Authorization / Tenant-Isolation Reasoning

The fix closes the trust-boundary violation at the API surface layer:

- **Before:** Caller-supplied `publisherIds` array was forwarded to `createPayoutRun` without any ownership verification. The SQL filter `account_id = ANY($2)` checked membership in the caller's array, not network ownership. A foreign publisherId inside the array was treated as authorized.
- **After:** Every caller-supplied publisherId is looked up in the `publishers` table with `WHERE network_id = $1 AND id = ANY($2)`. The `publishers` table is the canonical source of which publishers belong to which network. Only IDs that resolve in that query are forwarded.

**Why the `publishers` table is the correct enforcement point:**
- It is the authoritative mapping of publisher → network.
- It is a single-row lookup per ID (O(n) where n = caller-supplied IDs).
- It is enforced before any financial operation (ledger writes, payout inserts) occurs.
- It does not change the behavior of `createPayoutRun` for legitimate callers — authorized IDs pass through identically.

**Defense-in-depth layering:**
```
Layer 1: requireAudience('network') — structural, middleware, 403 before handler
Layer 2: requireScope('payouts:write') — per-key capability check
Layer 3: publishers WHERE network_id=$1 — THIS FIX, entity-level authorization
Layer 4: createPayoutRun WHERE network_id=$1 — existing query scoping (still important)
```

Layers 1-2 existed. Layer 3 was missing. Layer 4 (inside `createPayoutRun`) already scopes by `network_id` but doesn't validate that the publisher IDs belong to the network — it only filters ledger entries. Layer 3 closes that gap.

---

## 4. Attack Scenarios Tested

| # | Scenario | Expected | What it proves |
|---|----------|----------|----------------|
| 1 | All publisherIds belong to authenticated network | 201 | Legitimate flow preserved |
| 2 | Foreign publisherId in the array | 403 | Cross-network access blocked at API layer |
| 3 | Mixed own + foreign publisherIds | 403 | Any unauthorized ID causes full rejection |
| 4 | Nonexistent publisherId in the array | 403 | Phantom IDs cannot bypass the check |
| 5 | No publisherIds provided (full network payout) | 201 | Unfiltered payout (all network publishers) still works |

---

## 5. Tests Added

5 tests in `test/isolation/payout-ownership.test.ts`:

Each test builds a fresh Express app via `vi.resetModules` + `vi.doMock`. The auth middleware is replaced with a stub that injects a network-audience identity. The `publishers` table lookup is mocked to simulate which IDs belong to the caller's network. `createPayoutRun` is mocked to verify it is called with the correct (filtered) IDs and never called when authorization fails.

| Test | Publisher rows (simulated) | Requested publisherIds | Expected | createPayoutRun called? |
|------|---------------------------|------------------------|----------|------------------------|
| 1 | PUB_OWNED_A1, PUB_OWNED_A2 | [PUB_OWNED_A1, PUB_OWNED_A2] | 201 | Yes, with both IDs |
| 2 | PUB_OWNED_A1 | [PUB_OWNED_A1, PUB_FOREIGN] | 403 | No |
| 3 | PUB_OWNED_A1 | [PUB_OWNED_A1, PUB_FOREIGN, PUB_OWNED_A2] | 403 | No |
| 4 | PUB_OWNED_A1 | [PUB_OWNED_A1, PUB_NONEXISTENT] | 403 | No |
| 5 | PUB_OWNED_A1 | undefined (no filter) | 201 | Yes, no publisherIds |

---

## 6. Tests Executed / Results

```
test/isolation/payout-ownership.test.ts 5 passed (5) ← A-2 fix
test/isolation/api-audience.test.ts 3 passed (3) ← regression
test/isolation/advertiser-click-ownership.test.ts 7 passed (7) ← A-1 regression
```

**Total: 15/15 pass.** No regressions.

---

## 7. Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/surfaces/public-api/network.ts` | **Modified** | Added `forbidden` import; added publisher authorization check in POST /payouts handler (filter + `SELECT id FROM publishers WHERE network_id = $1 AND id = ANY($2)` + explicit reject on unauthorized IDs) |
| `test/isolation/payout-ownership.test.ts` | **Created** | 5 tests covering A-2 enforcement: legitimate IDs, foreign ID, mixed IDs, nonexistent ID, no filter |

---

## 8. Remaining Limitations

- **`createPayoutRun` still trusts the caller-supplied array internally.** The fix is at the API surface layer. If `createPayoutRun` is called from another path (e.g., a future internal scheduler or dashboard endpoint) without the same authorization gate, the vulnerability could reappear. The ideal long-term fix is to add the same publisher authorization inside `createPayoutRun` itself — it should receive only an internal publisher list, not caller-supplied IDs.
- **Non-existent publishers are rejected at the handler layer, not silently ignored.** This is the correct security behavior — a caller requesting a nonexistent publisher should not succeed. However, if the dashboard or internal tools rely on "ignore missing publishers, process what exists" behavior, that needs a separate code path in `createPayoutRun` with explicit intent.
- **Fix does not address A-1, A-3, or MEDIUM findings** — out of scope for this task.
