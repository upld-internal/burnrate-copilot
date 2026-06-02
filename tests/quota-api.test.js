'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  CACHE_TTL_MS,
  REFRESH_PENDING_TIMEOUT_MS,
  readQuotaCache,
  readQuotaState,
  writeQuotaState,
  isCircuitOpen,
  shouldRefresh,
  findPremiumSnapshot,
  parseApiResponse,
} = require('../scripts/quota-api');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-quota-api-'));
}

const VALID_SNAPSHOT = {
  quota_id:          'premium_interactions',
  unlimited:         false,
  has_quota:         true,
  entitlement:       3000,
  remaining:         252,
  quota_remaining:   252.6,
  percent_remaining: 8.4,
  overage_permitted: true,
  overage_count:     0,
};

const VALID_API_RESPONSE = {
  quota_reset_date_utc: '2026-07-01T00:00:00.000Z',
  quota_snapshots: {
    chat: {
      quota_id: 'chat', unlimited: true, has_quota: false,
      entitlement: 0, remaining: 0, quota_remaining: 0, percent_remaining: 100,
      overage_permitted: false, overage_count: 0,
    },
    premium_interactions: VALID_SNAPSHOT,
  },
};

// ---------------------------------------------------------------------------
// readQuotaCache
// ---------------------------------------------------------------------------

describe('readQuotaCache', () => {
  test('returns data + stale:false when file is fresh', () => {
    const dir = tmpDir();
    const cache = {
      fetched_at:        new Date().toISOString(),
      entitlement:       3000,
      quota_remaining:   252.6,
      percent_remaining: 8.4,
    };
    fs.writeFileSync(path.join(dir, 'quota-cache.json'), JSON.stringify(cache));
    const result = readQuotaCache(dir);
    assert.ok(result.data, 'data should exist');
    assert.equal(result.stale, false);
    assert.ok(typeof result.ageMs === 'number');
  });

  test('returns data + stale:true when file is old', () => {
    const dir = tmpDir();
    const old = new Date(Date.now() - CACHE_TTL_MS - 10000).toISOString();
    const cache = {
      fetched_at:        old,
      entitlement:       3000,
      quota_remaining:   252.6,
      percent_remaining: 8.4,
    };
    fs.writeFileSync(path.join(dir, 'quota-cache.json'), JSON.stringify(cache));
    const result = readQuotaCache(dir);
    assert.ok(result.data);
    assert.equal(result.stale, true);
  });

  test('returns { data: null } when file is missing', () => {
    const dir = tmpDir();
    const result = readQuotaCache(dir);
    assert.equal(result.data, null);
  });

  test('returns { data: null } when file is malformed JSON', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'quota-cache.json'), 'not json{{{');
    assert.equal(readQuotaCache(dir).data, null);
  });

  test('returns { data: null } when required fields are missing', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'quota-cache.json'), JSON.stringify({
      fetched_at: new Date().toISOString(),
      entitlement: 3000,
      // missing quota_remaining + percent_remaining
    }));
    assert.equal(readQuotaCache(dir).data, null);
  });
});

// ---------------------------------------------------------------------------
// readQuotaState / writeQuotaState
// ---------------------------------------------------------------------------

describe('readQuotaState', () => {
  test('returns defaults when file is missing', () => {
    const dir = tmpDir();
    const state = readQuotaState(dir);
    assert.equal(state.consecutive_failures, 0);
    assert.equal(state.circuit_open_until, null);
    assert.equal(state.refresh_pending_since, null);
  });

  test('returns defaults when file is malformed', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'quota-state.json'), 'bad json');
    const state = readQuotaState(dir);
    assert.equal(state.consecutive_failures, 0);
  });

  test('roundtrip: write then read', () => {
    const dir = tmpDir();
    const written = {
      consecutive_failures:  2,
      last_attempt_at:       '2026-06-01T10:00:00Z',
      last_success_at:       '2026-06-01T09:00:00Z',
      circuit_open_until:    null,
      refresh_pending_since: null,
    };
    writeQuotaState(dir, written);
    const read = readQuotaState(dir);
    assert.equal(read.consecutive_failures, 2);
    assert.equal(read.last_attempt_at, '2026-06-01T10:00:00Z');
    assert.equal(read.circuit_open_until, null);
  });
});

// ---------------------------------------------------------------------------
// isCircuitOpen
// ---------------------------------------------------------------------------

describe('isCircuitOpen', () => {
  test('returns true when circuit_open_until is in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    assert.equal(isCircuitOpen({ circuit_open_until: future }), true);
  });

  test('returns false when circuit_open_until is in the past', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    assert.equal(isCircuitOpen({ circuit_open_until: past }), false);
  });

  test('returns false when circuit_open_until is null', () => {
    assert.equal(isCircuitOpen({ circuit_open_until: null }), false);
  });
});

// ---------------------------------------------------------------------------
// shouldRefresh
// ---------------------------------------------------------------------------

describe('shouldRefresh', () => {
  const closedState  = { circuit_open_until: null, refresh_pending_since: null };
  const openState    = { circuit_open_until: new Date(Date.now() + 3600000).toISOString(), refresh_pending_since: null };
  const pendingState = { circuit_open_until: null, refresh_pending_since: new Date().toISOString() };
  const stalePendingState = {
    circuit_open_until: null,
    refresh_pending_since: new Date(Date.now() - REFRESH_PENDING_TIMEOUT_MS - 1000).toISOString(),
  };

  const freshCache   = { data: { quota_remaining: 100 }, stale: false };
  const staleCache   = { data: { quota_remaining: 100 }, stale: true };
  const missingCache = { data: null };

  test('fresh cache → false (never refresh when cache is valid)', () => {
    assert.equal(shouldRefresh(freshCache, closedState), false);
  });

  test('stale cache + closed circuit + no pending → true', () => {
    assert.equal(shouldRefresh(staleCache, closedState), true);
  });

  test('missing cache + closed circuit + no pending → true', () => {
    assert.equal(shouldRefresh(missingCache, closedState), true);
  });

  test('stale cache + open circuit → false', () => {
    assert.equal(shouldRefresh(staleCache, openState), false);
  });

  test('stale cache + closed circuit + pending (fresh) → false', () => {
    assert.equal(shouldRefresh(staleCache, pendingState), false);
  });

  test('stale cache + closed circuit + pending (stale/crashed) → true', () => {
    assert.equal(shouldRefresh(staleCache, stalePendingState), true);
  });
});

// ---------------------------------------------------------------------------
// findPremiumSnapshot
// ---------------------------------------------------------------------------

describe('findPremiumSnapshot', () => {
  test('returns premium_interactions by name', () => {
    const snap = findPremiumSnapshot(VALID_API_RESPONSE.quota_snapshots);
    assert.equal(snap.quota_id, 'premium_interactions');
  });

  test('falls back to first has_quota:true when name is missing', () => {
    const snapshots = {
      chat: { has_quota: false, quota_id: 'chat' },
      other: { has_quota: true, quota_id: 'other', entitlement: 100 },
    };
    const snap = findPremiumSnapshot(snapshots);
    assert.equal(snap.quota_id, 'other');
  });

  test('returns null when no has_quota:true snapshot exists', () => {
    const snapshots = {
      chat:        { has_quota: false },
      completions: { has_quota: false },
    };
    assert.equal(findPremiumSnapshot(snapshots), null);
  });

  test('returns null for null/undefined input', () => {
    assert.equal(findPremiumSnapshot(null), null);
    assert.equal(findPremiumSnapshot(undefined), null);
  });
});

// ---------------------------------------------------------------------------
// parseApiResponse
// ---------------------------------------------------------------------------

describe('parseApiResponse', () => {
  test('returns normalized object for valid full response', () => {
    const result = parseApiResponse(VALID_API_RESPONSE);
    assert.ok(result);
    assert.equal(result.entitlement,       3000);
    assert.equal(result.remaining,         252);
    assert.equal(result.quota_remaining,   252.6);
    assert.equal(result.percent_remaining, 8.4);
    assert.equal(result.overage_permitted, true);
    assert.equal(result.overage_count,     0);
    assert.equal(result.quota_reset_date_utc, '2026-07-01T00:00:00.000Z');
    assert.ok(result.fetched_at);
  });

  test('returns null when quota_snapshots is missing', () => {
    assert.equal(parseApiResponse({ login: 'user' }), null);
  });

  test('returns null when premium_interactions is missing and no has_quota:true', () => {
    const resp = {
      quota_snapshots: {
        chat: { has_quota: false },
      },
    };
    assert.equal(parseApiResponse(resp), null);
  });

  test('returns null when required numeric fields are missing', () => {
    const resp = {
      quota_snapshots: {
        premium_interactions: {
          has_quota: true,
          // missing entitlement, remaining, etc.
        },
      },
    };
    assert.equal(parseApiResponse(resp), null);
  });

  test('returns null for null input', () => {
    assert.equal(parseApiResponse(null), null);
  });

  test('returns null for wrong types on required fields', () => {
    const bad = JSON.parse(JSON.stringify(VALID_API_RESPONSE));
    bad.quota_snapshots.premium_interactions.entitlement = 'three thousand';
    assert.equal(parseApiResponse(bad), null);
  });

  test('handles all-unlimited response (no has_quota:true) → null', () => {
    const resp = {
      quota_snapshots: {
        chat:        { unlimited: true, has_quota: false },
        completions: { unlimited: true, has_quota: false },
      },
    };
    assert.equal(parseApiResponse(resp), null);
  });
});
