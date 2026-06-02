'use strict';
// quota-api.js — synchronous quota cache utilities for burnrate-copilot.
//
// No network calls, no child_process. All functions read/write local files
// and are safe to call from the synchronous render path in compositor.js.
//
// The cache file is written by quota-fetch.js (detached background process).
// The state file tracks circuit-breaker and pending-refresh state.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CACHE_TTL_MS              = 5 * 60 * 1000;    // 5 minutes
const CIRCUIT_OPEN_DURATION_MS  = 60 * 60 * 1000;   // 1 hour
const FAILURE_THRESHOLD         = 3;
const REFRESH_PENDING_TIMEOUT_MS = 30 * 1000;        // 30 seconds

const STATE_DEFAULTS = {
  consecutive_failures: 0,
  last_attempt_at:      null,
  last_success_at:      null,
  circuit_open_until:   null,
  refresh_pending_since: null,
};

// ---------------------------------------------------------------------------
// Cache file helpers
// ---------------------------------------------------------------------------

// readQuotaCache — reads quota-cache.json synchronously.
// Returns { data, stale, ageMs } when file exists and is parseable with
// required fields; { data: null } when missing or malformed.
function readQuotaCache(dataDir) {
  const cachePath = path.join(dataDir, 'quota-cache.json');
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return { data: null };

    // Validate required fields
    if (typeof obj.entitlement        !== 'number') return { data: null };
    if (typeof obj.quota_remaining    !== 'number') return { data: null };
    if (typeof obj.percent_remaining  !== 'number') return { data: null };
    if (typeof obj.fetched_at         !== 'string') return { data: null };

    const ageMs = Date.now() - new Date(obj.fetched_at).getTime();
    const stale = ageMs > CACHE_TTL_MS;
    return { data: obj, stale, ageMs };
  } catch (_) {
    return { data: null };
  }
}

// ---------------------------------------------------------------------------
// State file helpers
// ---------------------------------------------------------------------------

// readQuotaState — reads quota-state.json; returns defaults if missing or bad.
function readQuotaState(dataDir) {
  const statePath = path.join(dataDir, 'quota-state.json');
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return { ...STATE_DEFAULTS };
    return { ...STATE_DEFAULTS, ...obj };
  } catch (_) {
    return { ...STATE_DEFAULTS };
  }
}

// writeQuotaState — atomic write via tmp+rename to avoid partial writes.
function writeQuotaState(dataDir, state) {
  const statePath = path.join(dataDir, 'quota-state.json');
  const tmpPath   = path.join(os.tmpdir(), 'burnrate-quota-state-' + process.pid + '.tmp');
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, statePath);
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

// isCircuitOpen — returns true when circuit_open_until is set and in the future.
function isCircuitOpen(state) {
  if (!state.circuit_open_until) return false;
  return new Date(state.circuit_open_until).getTime() > Date.now();
}

// shouldRefresh — returns true when all three conditions are met:
//   1. Cache is missing or stale
//   2. Circuit is not open
//   3. No pending refresh (or pending lock is stale / crashed)
function shouldRefresh(cacheResult, state) {
  // Condition 1: cache missing or stale
  const cacheMissingOrStale = !cacheResult.data || cacheResult.stale;
  if (!cacheMissingOrStale) return false;

  // Condition 2: circuit closed
  if (isCircuitOpen(state)) return false;

  // Condition 3: no pending refresh
  if (state.refresh_pending_since) {
    const pendingAge = Date.now() - new Date(state.refresh_pending_since).getTime();
    if (pendingAge < REFRESH_PENDING_TIMEOUT_MS) return false;
    // pending lock is stale (process crashed) — allow refresh
  }

  return true;
}

// ---------------------------------------------------------------------------
// API response parsing
// ---------------------------------------------------------------------------

// findPremiumSnapshot — locates the premium_interactions quota snapshot.
// Prefers the key by name; falls back to first snapshot with has_quota: true.
function findPremiumSnapshot(quotaSnapshots) {
  if (!quotaSnapshots || typeof quotaSnapshots !== 'object') return null;
  if (quotaSnapshots.premium_interactions &&
      quotaSnapshots.premium_interactions.has_quota === true) {
    return quotaSnapshots.premium_interactions;
  }
  const values = Object.values(quotaSnapshots);
  return values.find(s => s && s.has_quota === true) || null;
}

// parseApiResponse — validates and normalizes a copilot_internal/user response.
// Returns a normalized quota object on success, null on any schema failure.
function parseApiResponse(json) {
  if (!json || typeof json !== 'object') return null;

  const pi = findPremiumSnapshot(json.quota_snapshots);
  if (!pi) return null;

  // Validate required numeric fields
  if (typeof pi.entitlement       !== 'number') return null;
  if (typeof pi.remaining         !== 'number') return null;
  if (typeof pi.quota_remaining   !== 'number') return null;
  if (typeof pi.percent_remaining !== 'number') return null;
  if (typeof pi.overage_permitted !== 'boolean') return null;
  if (typeof pi.overage_count     !== 'number') return null;

  return {
    fetched_at:           new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    entitlement:          pi.entitlement,
    remaining:            pi.remaining,
    quota_remaining:      pi.quota_remaining,
    percent_remaining:    pi.percent_remaining,
    overage_permitted:    pi.overage_permitted,
    overage_count:        pi.overage_count,
    quota_reset_date_utc: json.quota_reset_date_utc || null,
  };
}

module.exports = {
  CACHE_TTL_MS,
  CIRCUIT_OPEN_DURATION_MS,
  FAILURE_THRESHOLD,
  REFRESH_PENDING_TIMEOUT_MS,
  readQuotaCache,
  readQuotaState,
  writeQuotaState,
  isCircuitOpen,
  shouldRefresh,
  findPremiumSnapshot,
  parseApiResponse,
};
