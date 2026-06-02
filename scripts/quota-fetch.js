#!/usr/bin/env node
'use strict';
// quota-fetch.js — async background quota fetcher for burnrate-copilot.
//
// Run as a detached child process from statusline.js and session-start.js.
// Never called from the synchronous render path.
//
// Environment hooks (for testing):
//   GH_TOKEN                    — use directly instead of calling `gh auth token`
//   COPILOT_QUOTA_MOCK_RESPONSE — JSON string; skip network, parse this instead
//   COPILOT_HOME                — override ~/.copilot location (used by tests)

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getDataDir } = require('./paths');
const {
  FAILURE_THRESHOLD,
  CIRCUIT_OPEN_DURATION_MS,
  readQuotaState,
  writeQuotaState,
  isCircuitOpen,
  parseApiResponse,
} = require('./quota-api');

const QUOTA_URL = 'https://api.github.com/copilot_internal/user';

async function main() {
  const dataDir = getDataDir();

  // Read current state; exit immediately if circuit is open.
  const state = readQuotaState(dataDir);
  if (isCircuitOpen(state)) {
    process.exit(0);
  }

  // Mark refresh as pending (already set by spawner, but set again for safety).
  const pendingState = { ...state, refresh_pending_since: new Date().toISOString() };
  try { writeQuotaState(dataDir, pendingState); } catch (_) {}

  let token = null;
  const mockResponse = process.env.COPILOT_QUOTA_MOCK_RESPONSE;

  if (!mockResponse) {
    // Get auth token: prefer GH_TOKEN env, fall back to `gh auth token`.
    token = (process.env.GH_TOKEN || '').trim();
    if (!token) {
      try {
        token = execFileSync('gh', ['auth', 'token'], {
          timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
      } catch (_) {
        // gh not installed or not authenticated
      }
    }
    if (!token) {
      // Cannot authenticate — clear pending, don't count as failure.
      try { writeQuotaState(dataDir, { ...pendingState, refresh_pending_since: null }); } catch (_) {}
      process.exit(0);
    }
  }

  let quota = null;
  let fetchFailed = false;

  try {
    let responseJson;

    if (mockResponse) {
      // Test hook: parse mock response directly, skip network.
      responseJson = JSON.parse(mockResponse);
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(QUOTA_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          fetchFailed = true;
        } else {
          responseJson = await res.json();
        }
      } catch (_) {
        clearTimeout(timer);
        fetchFailed = true;
      }
    }

    if (!fetchFailed && responseJson !== undefined) {
      quota = parseApiResponse(responseJson);
      if (!quota) fetchFailed = true;
    }
  } catch (_) {
    fetchFailed = true;
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (quota && !fetchFailed) {
    // Success: write cache file and reset circuit state.
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const cachePath = path.join(dataDir, 'quota-cache.json');
      fs.writeFileSync(cachePath, JSON.stringify(quota, null, 2));
    } catch (_) {}

    writeQuotaState(dataDir, {
      consecutive_failures:  0,
      last_attempt_at:       now,
      last_success_at:       now,
      circuit_open_until:    null,
      refresh_pending_since: null,
    });
  } else {
    // Failure: increment counter, open circuit if threshold reached.
    const failures = (state.consecutive_failures || 0) + 1;
    const openUntil = failures >= FAILURE_THRESHOLD
      ? new Date(Date.now() + CIRCUIT_OPEN_DURATION_MS).toISOString().replace(/\.\d{3}Z$/, 'Z')
      : state.circuit_open_until || null;

    writeQuotaState(dataDir, {
      ...state,
      consecutive_failures:  failures,
      last_attempt_at:       now,
      circuit_open_until:    openUntil,
      refresh_pending_since: null,
    });
  }

  process.exit(0);
}

main().catch(() => process.exit(1));
