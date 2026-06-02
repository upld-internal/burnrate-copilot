'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  quota_remaining,
  quota_used,
  overage_status,
  mtd_cost,
  mtd_credits,
} = require('../scripts/widgets/cost');

// Strip ANSI escape codes for assertions on plain text
function strip(s) {
  return s ? s.replace(/\x1b\[[0-9;]*m/g, '') : s;
}

function sd(overrides = {}) {
  return {
    hasQuota:        true,
    quotaRemaining:  252.6,
    quotaEntitlement: 3000,
    quotaPercent:    8.4,
    quotaResetDate:  '2026-07-01T00:00:00.000Z',
    quotaOverage:    0,
    quotaOverageOk:  true,
    quotaStale:      false,
    hasPricing:      true,
    sessionCost:     1.23,
    mtd:             27.47,
    projected:       null,
    ...overrides,
  };
}

const stdinData = {};
const plainOpts = { _powerline: false };
const plOpts    = { _powerline: true };

// ---------------------------------------------------------------------------
// quota_remaining
// ---------------------------------------------------------------------------

describe('quota_remaining', () => {
  test('fresh data — shows remaining + reset date', () => {
    const result = strip(quota_remaining(stdinData, sd(), plainOpts));
    assert.ok(result.includes('252.6 left'));
    assert.ok(result.includes('resets Jul 1'));
  });

  test('stale data — tilde prefix', () => {
    const result = strip(quota_remaining(stdinData, sd({ quotaStale: true }), plainOpts));
    assert.ok(result.startsWith('~'), `expected tilde prefix, got: ${result}`);
    assert.ok(result.includes('left'));
  });

  test('no quota — returns null', () => {
    assert.equal(quota_remaining(stdinData, sd({ hasQuota: false }), plainOpts), null);
  });

  test('powerline mode — no ANSI codes', () => {
    const result = quota_remaining(stdinData, sd(), plOpts);
    assert.ok(result);
    // No ESC characters in powerline output
    assert.ok(!result.includes('\x1b'), 'powerline output should not contain ANSI escapes');
    assert.ok(result.includes('left'));
  });

  test('show_reset_date: false — omits reset date', () => {
    const opts = { _powerline: false, show_reset_date: false };
    const result = strip(quota_remaining(stdinData, sd(), opts));
    assert.ok(!result.includes('resets'));
    assert.ok(result.includes('left'));
  });

  test('show_label: true — includes Quota: prefix', () => {
    const opts = { _powerline: false, show_label: true };
    const result = strip(quota_remaining(stdinData, sd(), opts));
    assert.ok(result.includes('Quota:'));
  });

  test('show_label: false (default) — no prefix', () => {
    const result = strip(quota_remaining(stdinData, sd(), plainOpts));
    assert.ok(!result.includes('Quota:'));
  });
});

// ---------------------------------------------------------------------------
// quota_used
// ---------------------------------------------------------------------------

describe('quota_used', () => {
  test('shows used/entitlement and percent', () => {
    const result = strip(quota_used(stdinData, sd(), plainOpts));
    // used = 3000 - 252.6 = 2747.4 → rounded to 2747.4
    assert.ok(result.includes('2747.4/3000'));
    assert.ok(result.includes('91.6%'));
  });

  test('no quota — returns null', () => {
    assert.equal(quota_used(stdinData, sd({ hasQuota: false }), plainOpts), null);
  });

  test('powerline mode — no pct, no ANSI', () => {
    const result = quota_used(stdinData, sd(), plOpts);
    assert.ok(!result.includes('\x1b'));
    assert.ok(result.includes('/3000'));
    assert.ok(!result.includes('%'));
  });

  test('show_label: true — includes Used: prefix', () => {
    const result = strip(quota_used(stdinData, sd(), { _powerline: false, show_label: true }));
    assert.ok(result.includes('Used:'));
  });
});

// ---------------------------------------------------------------------------
// overage_status
// ---------------------------------------------------------------------------

describe('overage_status', () => {
  test('returns null when overage_count is 0', () => {
    assert.equal(overage_status(stdinData, sd({ quotaOverage: 0 }), plainOpts), null);
  });

  test('returns null when hasQuota is false', () => {
    assert.equal(overage_status(stdinData, sd({ hasQuota: false, quotaOverage: 5 }), plainOpts), null);
  });

  test('shows overage count when > 0', () => {
    const result = strip(overage_status(stdinData, sd({ quotaOverage: 3 }), plainOpts));
    assert.ok(result.includes('+3'));
    assert.ok(result.includes('overage'));
  });

  test('powerline mode — shorter label', () => {
    const result = overage_status(stdinData, sd({ quotaOverage: 3 }), plOpts);
    assert.ok(!result.includes('\x1b'));
    assert.ok(result.includes('+3 over'));
  });
});

// ---------------------------------------------------------------------------
// mtd_cost — quota as primary source
// ---------------------------------------------------------------------------

describe('mtd_cost with quota', () => {
  test('uses API cache when hasQuota is true', () => {
    // used = (3000 - 252.6) / 100 = $27.47
    const result = strip(mtd_cost(stdinData, sd(), plainOpts));
    assert.ok(result.includes('$27.47'), `expected $27.47 in: ${result}`);
  });

  test('stale cache — tilde prefix', () => {
    const result = strip(mtd_cost(stdinData, sd({ quotaStale: true }), plainOpts));
    assert.ok(result.includes('~$'), `expected ~$ prefix in: ${result}`);
  });

  test('no quota + no pricing → null', () => {
    assert.equal(mtd_cost(stdinData, sd({ hasQuota: false, hasPricing: false }), plainOpts), null);
  });

  test('no quota + has pricing → falls back to JSONL sum', () => {
    const result = strip(mtd_cost(stdinData, sd({ hasQuota: false, hasPricing: true, mtd: 5.00 }), plainOpts));
    assert.ok(result.includes('$5.00'));
  });
});

// ---------------------------------------------------------------------------
// mtd_credits — quota as primary source
// ---------------------------------------------------------------------------

describe('mtd_credits with quota', () => {
  test('uses API cache when hasQuota is true', () => {
    // used = 3000 - 252.6 = 2747.4
    const result = strip(mtd_credits(stdinData, sd(), plainOpts));
    assert.ok(result.includes('2747'), `expected credits value in: ${result}`);
  });

  test('stale cache — tilde prefix', () => {
    const result = strip(mtd_credits(stdinData, sd({ quotaStale: true }), plainOpts));
    assert.ok(result.includes('~'), `expected tilde in: ${result}`);
  });

  test('no quota + no pricing → null', () => {
    assert.equal(mtd_credits(stdinData, sd({ hasQuota: false, hasPricing: false }), plainOpts), null);
  });

  test('no quota + has pricing → falls back to JSONL sum', () => {
    const result = strip(mtd_credits(stdinData, sd({ hasQuota: false, hasPricing: true, mtd: 5.00 }), plainOpts));
    // 5.00 USD * 100 = 500 credits
    assert.ok(result.includes('500'));
  });
});
