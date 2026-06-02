'use strict';
// quota-api-contract.test.js — live API contract validation.
//
// Skipped automatically when `gh auth token` is unavailable.
// When it runs, it validates every field the plugin depends on.
// Acts as an early-warning system for undocumented API changes.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');

const QUOTA_URL = 'https://api.github.com/copilot_internal/user';

let token = null;
let skipReason = null;

try {
  token = execFileSync('gh', ['auth', 'token'], {
    timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
  }).toString().trim();
  if (!token) skipReason = 'gh auth token returned empty string';
} catch (_) {
  skipReason = 'gh not installed or not authenticated';
}

describe('copilot_internal/user contract', { skip: skipReason || false }, () => {
  let body = null;

  test('fetch succeeds and returns JSON object', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(QUOTA_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      assert.ok(res.ok, `HTTP ${res.status} ${res.statusText}`);
      body = await res.json();
      assert.ok(body && typeof body === 'object', 'body should be an object');
    } finally {
      clearTimeout(timer);
    }
  });

  test('quota_snapshots is an object', () => {
    assert.ok(body, 'body must be set (prior test must pass)');
    assert.ok(body.quota_snapshots && typeof body.quota_snapshots === 'object',
      'quota_snapshots should be an object');
  });

  test('at least one snapshot has has_quota:true OR an unlimited:true snapshot exists', () => {
    assert.ok(body);
    const snapshots = Object.values(body.quota_snapshots || {});
    const hasFiniteQuota = snapshots.some(s => s.has_quota === true);
    const hasUnlimited   = snapshots.some(s => s.unlimited === true);
    assert.ok(hasFiniteQuota || hasUnlimited,
      'at least one snapshot should have has_quota:true or unlimited:true');
  });

  test('premium_interactions snapshot fields are correct types', () => {
    assert.ok(body);
    const pi = body.quota_snapshots && (
      body.quota_snapshots.premium_interactions ||
      Object.values(body.quota_snapshots).find(s => s && s.has_quota === true)
    );

    if (!pi) {
      // All-unlimited plan — nothing to validate here
      return;
    }

    const checks = [
      ['entitlement',       'number'],
      ['remaining',         'number'],
      ['quota_remaining',   'number'],
      ['percent_remaining', 'number'],
      ['overage_permitted', 'boolean'],
      ['overage_count',     'number'],
    ];

    for (const [key, expectedType] of checks) {
      assert.equal(
        typeof pi[key], expectedType,
        `premium snapshot.${key} should be ${expectedType}, got ${typeof pi[key]}`
      );
    }

    // percent_remaining should be in [0, 100]
    assert.ok(pi.percent_remaining >= 0 && pi.percent_remaining <= 100,
      `percent_remaining out of range: ${pi.percent_remaining}`);
  });

  test('quota_reset_date_utc matches ISO 8601 pattern', () => {
    assert.ok(body);
    if (!body.quota_reset_date_utc) return; // optional field
    assert.match(
      body.quota_reset_date_utc,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      `quota_reset_date_utc does not look like ISO 8601: ${body.quota_reset_date_utc}`
    );
  });
});
