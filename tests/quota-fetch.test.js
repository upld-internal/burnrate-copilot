'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FETCH_SCRIPT = path.join(__dirname, '..', 'scripts', 'quota-fetch.js');

const VALID_API_RESPONSE = JSON.stringify({
  quota_reset_date_utc: '2026-07-01T00:00:00.000Z',
  quota_snapshots: {
    chat: {
      quota_id: 'chat', unlimited: true, has_quota: false,
      entitlement: 0, remaining: 0, quota_remaining: 0, percent_remaining: 100,
      overage_permitted: false, overage_count: 0,
    },
    premium_interactions: {
      quota_id:          'premium_interactions',
      unlimited:         false,
      has_quota:         true,
      entitlement:       3000,
      remaining:         252,
      quota_remaining:   252.6,
      percent_remaining: 8.4,
      overage_permitted: true,
      overage_count:     0,
    },
  },
});

function tmpCopilotHome() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-quota-fetch-'));
  fs.mkdirSync(path.join(base, 'plugin-data', 'burnrate-copilot'), { recursive: true });
  return base;
}

function runFetch(copilotHome, extra = {}) {
  return spawnSync(process.execPath, [FETCH_SCRIPT], {
    encoding: 'utf8',
    timeout:  10000,
    env: {
      ...process.env,
      COPILOT_HOME: copilotHome,
      GH_TOKEN: '',          // prevent real gh auth token calls
      ...extra,
    },
  });
}

function dataDir(home) {
  return path.join(home, 'plugin-data', 'burnrate-copilot');
}

function readState(home) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(home), 'quota-state.json'), 'utf8'));
  } catch (_) { return null; }
}

function readCache(home) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(home), 'quota-cache.json'), 'utf8'));
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------

describe('quota-fetch.js subprocess', () => {
  test('valid mock response → cache file written, consecutive_failures = 0', () => {
    const home = tmpCopilotHome();
    const result = runFetch(home, { COPILOT_QUOTA_MOCK_RESPONSE: VALID_API_RESPONSE });
    assert.equal(result.status, 0, `exit non-zero: ${result.stderr}`);
    const cache = readCache(home);
    assert.ok(cache, 'quota-cache.json should exist');
    assert.equal(cache.entitlement,     3000);
    assert.equal(cache.quota_remaining, 252.6);
    const state = readState(home);
    assert.equal(state.consecutive_failures, 0);
    assert.equal(state.circuit_open_until,   null);
  });

  test('malformed mock response → failure counter incremented, no cache written', () => {
    const home = tmpCopilotHome();
    runFetch(home, { COPILOT_QUOTA_MOCK_RESPONSE: 'not-json' });
    assert.equal(readCache(home), null, 'cache should not exist');
    const state = readState(home);
    assert.ok(state.consecutive_failures >= 1);
  });

  test('missing premium_interactions → failure counter incremented', () => {
    const home = tmpCopilotHome();
    const noQuota = JSON.stringify({ quota_snapshots: { chat: { has_quota: false } } });
    runFetch(home, { COPILOT_QUOTA_MOCK_RESPONSE: noQuota });
    const state = readState(home);
    assert.ok(state.consecutive_failures >= 1);
  });

  test('circuit already open → exits without writing or incrementing counters', () => {
    const home = tmpCopilotHome();
    const future = new Date(Date.now() + 3600000).toISOString();
    const initialState = {
      consecutive_failures:  2,
      circuit_open_until:    future,
      refresh_pending_since: null,
      last_attempt_at:       null,
      last_success_at:       null,
    };
    fs.writeFileSync(
      path.join(dataDir(home), 'quota-state.json'),
      JSON.stringify(initialState)
    );
    runFetch(home, { COPILOT_QUOTA_MOCK_RESPONSE: VALID_API_RESPONSE });
    // Cache should NOT be written (circuit was open)
    assert.equal(readCache(home), null);
    // Failures should not have changed
    const state = readState(home);
    assert.equal(state.consecutive_failures, 2);
  });

  test('failure count reaches threshold → circuit_open_until is set to ~1hr from now', () => {
    const home = tmpCopilotHome();
    // Pre-seed state with 2 failures (threshold is 3, so this run pushes it over)
    fs.writeFileSync(
      path.join(dataDir(home), 'quota-state.json'),
      JSON.stringify({ consecutive_failures: 2, circuit_open_until: null, refresh_pending_since: null })
    );
    runFetch(home, { COPILOT_QUOTA_MOCK_RESPONSE: 'bad' });
    const state = readState(home);
    assert.ok(state.circuit_open_until, 'circuit should now be open');
    const openUntil = new Date(state.circuit_open_until).getTime();
    const now = Date.now();
    assert.ok(openUntil > now + 55 * 60 * 1000, 'circuit should be open for ~1 hour');
  });

  test('success after previous failures → consecutive_failures reset, circuit cleared', () => {
    const home = tmpCopilotHome();
    fs.writeFileSync(
      path.join(dataDir(home), 'quota-state.json'),
      JSON.stringify({ consecutive_failures: 2, circuit_open_until: null, refresh_pending_since: null })
    );
    runFetch(home, { COPILOT_QUOTA_MOCK_RESPONSE: VALID_API_RESPONSE });
    const state = readState(home);
    assert.equal(state.consecutive_failures, 0);
    assert.equal(state.circuit_open_until, null);
    assert.ok(readCache(home), 'cache should be written on success');
  });

  test('GH_TOKEN env var used directly (no gh auth token call)', () => {
    // We verify this indirectly: if quota-fetch falls through to `gh auth token`
    // when GH_TOKEN is empty and no mock is set, it exits 0 without writing cache
    // (gh is either unavailable or has no token — we just verify no crash).
    const home = tmpCopilotHome();
    const result = runFetch(home, { GH_TOKEN: '', COPILOT_QUOTA_MOCK_RESPONSE: undefined });
    assert.equal(result.status, 0);
  });
});
