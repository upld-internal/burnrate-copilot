'use strict';
// tests/events-parser.test.js — Task 2: Multi-model cost from events.jsonl
//
// Tests for events-parser.js (unit) and integration with session-end.js.
// Uses fixture data to simulate events.jsonl with multi-model sessions.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpHome;
let tmpDataDir;
let tmpSessionStateDir;

before(() => {
  tmpHome            = fs.mkdtempSync(path.join(os.tmpdir(), 'burnrate-events-test-'));
  tmpDataDir         = path.join(tmpHome, 'burnrate-copilot');
  tmpSessionStateDir = path.join(tmpHome, 'session-state');
  fs.mkdirSync(path.join(tmpDataDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(tmpDataDir, 'monthly'),  { recursive: true });
  fs.mkdirSync(tmpSessionStateDir, { recursive: true });
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Create a fixture events.jsonl with session.shutdown containing modelMetrics
function createEventsFixture(sessionId, modelMetrics, extras = []) {
  const sessionDir = path.join(tmpSessionStateDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const events = [
    ...extras.map(e => JSON.stringify(e)),
    JSON.stringify({
      type: 'session.shutdown',
      data: { modelMetrics },
      id: 'shutdown-1',
      timestamp: new Date().toISOString(),
    }),
  ];

  fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), events.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Unit tests: events-parser.js
// ---------------------------------------------------------------------------

describe('events-parser', () => {
  // We need to override getCopilotConfigDir to point to our tmp dir.
  // The simplest approach is to test via the subprocess (session-end.js) and
  // directly test the computeMultiModelCost function which doesn't depend on paths.

  test('computeMultiModelCost with multi-model metrics', () => {
    // Import directly — computeMultiModelCost is a pure function
    const { computeMultiModelCost } = require('../scripts/events-parser');

    const modelMetrics = {
      'claude-sonnet-4.6': {
        requests: { count: 50, cost: 9 },
        usage: {
          inputTokens: 3725610,
          outputTokens: 25630,
          cacheReadTokens: 3467457,
          cacheWriteTokens: 256942,
          reasoningTokens: 0,
        },
      },
      'gpt-5.5': {
        requests: { count: 5, cost: 0 },
        usage: {
          inputTokens: 141510,
          outputTokens: 3301,
          cacheReadTokens: 108544,
          cacheWriteTokens: 0,
          reasoningTokens: 1719,
        },
      },
    };

    const pricingTable = {
      'claude-sonnet-4.6': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
      'gpt-5.5': { input: 5.0, output: 30.0, cache_write: 0, cache_read: 0.5 },
    };

    const result = computeMultiModelCost(modelMetrics, pricingTable);

    assert.ok(result, 'should return a result');
    assert.ok(result.total > 0, 'total cost should be positive');
    assert.deepEqual(result.models, ['claude-sonnet-4.6', 'gpt-5.5']);
    assert.deepEqual(result.missingPricing, []);

    // Verify per-model costs
    const sonnetCost = result.perModel['claude-sonnet-4.6'].cost;
    const gptCost = result.perModel['gpt-5.5'].cost;

    // sonnet: (3725610/1e6 * 3) + (25630/1e6 * 15) + (256942/1e6 * 3.75) + (3467457/1e6 * 0.3)
    const expectedSonnet = 3725610 / 1e6 * 3 + 25630 / 1e6 * 15 + 256942 / 1e6 * 3.75 + 3467457 / 1e6 * 0.3;
    assert.ok(Math.abs(sonnetCost - expectedSonnet) < 0.001, `sonnet cost: got ${sonnetCost}, expected ${expectedSonnet}`);

    // gpt-5.5: (141510/1e6 * 5) + (3301/1e6 * 30) + (0) + (108544/1e6 * 0.5)
    const expectedGpt = 141510 / 1e6 * 5 + 3301 / 1e6 * 30 + 0 + 108544 / 1e6 * 0.5;
    assert.ok(Math.abs(gptCost - expectedGpt) < 0.001, `gpt cost: got ${gptCost}, expected ${expectedGpt}`);

    // Total should be sum
    assert.ok(Math.abs(result.total - (sonnetCost + gptCost)) < 0.0001);
  });

  test('computeMultiModelCost with missing pricing for one model', () => {
    const { computeMultiModelCost } = require('../scripts/events-parser');

    const modelMetrics = {
      'claude-sonnet-4.6': {
        requests: { count: 10, cost: 1 },
        usage: { inputTokens: 100000, outputTokens: 5000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      'unknown-model-xyz': {
        requests: { count: 2, cost: 0 },
        usage: { inputTokens: 50000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    };

    const pricingTable = {
      'claude-sonnet-4.6': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
    };

    const result = computeMultiModelCost(modelMetrics, pricingTable);
    assert.ok(result);
    assert.deepEqual(result.missingPricing, ['unknown-model-xyz']);
    assert.equal(result.perModel['unknown-model-xyz'].hasPricing, false);
    // Total only includes models with pricing
    assert.ok(result.total > 0);
  });

  test('computeMultiModelCost returns null for null input', () => {
    const { computeMultiModelCost } = require('../scripts/events-parser');
    assert.equal(computeMultiModelCost(null, {}), null);
    assert.equal(computeMultiModelCost(undefined, {}), null);
  });

  test('loadPricingTable loads all non-meta keys', () => {
    const { loadPricingTable } = require('../scripts/events-parser');
    const scriptDir = path.join(__dirname, '..', 'scripts');
    const table = loadPricingTable(null, scriptDir);
    assert.ok(Object.keys(table).length >= 10, 'should have many models');
    assert.ok(table['claude-sonnet-4.6'], 'should have sonnet');
    assert.ok(table['gpt-5.5'], 'should have gpt-5.5');
    assert.ok(!table['_meta'], 'should not include _meta');
    assert.ok(!table['_comment_anthropic'], 'should not include comments');
  });
});

// ---------------------------------------------------------------------------
// Integration test: session-end.js uses multi-model cost
// ---------------------------------------------------------------------------

describe('session-end.js multi-model integration', () => {
  const SESSION_ID = 'test-multimodel-001';

  before(() => {
    // Create a session file (simulating what session-start + compositor writes)
    const sessionFile = {
      session_id: SESSION_ID,
      started_at: '2026-05-20T10:00:00Z',
      start_month: '2026-05',
      model_id: 'claude-sonnet-4.6',
      last_known_model: 'claude-sonnet-4.6',
      last_known_at: '2026-05-20T11:00:00Z',
      last_known_cost: 10.0, // single-model estimate (inaccurate)
      last_known_tokens: {
        total_input_tokens: 3867120,
        total_output_tokens: 28931,
        total_cache_write_tokens: 256942,
        total_cache_read_tokens: 3576001,
      },
      snapshot: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_write_tokens: 0,
        total_cache_read_tokens: 0,
      },
      project: 'test-project',
      project_id: '-Users-test-test-project',
    };
    fs.writeFileSync(
      path.join(tmpDataDir, 'sessions', SESSION_ID + '.json'),
      JSON.stringify(sessionFile, null, 2)
    );

    // Create events.jsonl with multi-model shutdown metrics
    const sessionStateDir = path.join(tmpSessionStateDir, SESSION_ID);
    fs.mkdirSync(sessionStateDir, { recursive: true });
    const shutdownEvent = {
      type: 'session.shutdown',
      data: {
        modelMetrics: {
          'claude-sonnet-4.6': {
            requests: { count: 50, cost: 9 },
            usage: {
              inputTokens: 3725610,
              outputTokens: 25630,
              cacheReadTokens: 3467457,
              cacheWriteTokens: 256942,
              reasoningTokens: 0,
            },
          },
          'gpt-5.5': {
            requests: { count: 5, cost: 0 },
            usage: {
              inputTokens: 141510,
              outputTokens: 3301,
              cacheReadTokens: 108544,
              cacheWriteTokens: 0,
              reasoningTokens: 1719,
            },
          },
        },
      },
      id: 'shutdown-test',
      timestamp: '2026-05-20T11:01:00Z',
    };
    fs.writeFileSync(
      path.join(sessionStateDir, 'events.jsonl'),
      JSON.stringify(shutdownEvent) + '\n'
    );
  });

  test('session-end produces multi-model cost record', () => {
    const stdin = JSON.stringify({ sessionId: SESSION_ID });
    const result = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'session-end.js')], {
      input: stdin,
      env: { ...process.env, COPILOT_HOME: tmpHome },
      timeout: 5000,
    });

    if (result.status !== 0) {
      console.error('session-end stderr:', result.stderr?.toString());
    }
    assert.equal(result.status, 0, 'session-end should exit cleanly');

    // Read the monthly JSONL record
    const monthlyFile = path.join(tmpDataDir, 'monthly', '2026-05.jsonl');
    assert.ok(fs.existsSync(monthlyFile), 'monthly file should exist');

    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, SESSION_ID);
    assert.equal(record.cost_method, 'multi_model', 'should use multi_model method');
    assert.ok(record.cost_usd > 0, 'cost should be positive');
    assert.ok(record.model_metrics, 'should have model_metrics');
    assert.ok(record.model_metrics['claude-sonnet-4.6'], 'should have sonnet metrics');
    assert.ok(record.model_metrics['gpt-5.5'], 'should have gpt metrics');

    // Verify cost is NOT the single-model estimate (10.0) — it should be different
    assert.notEqual(record.cost_usd, 10.0, 'should not be the single-model fallback');

    // Verify cost is reasonable (should be ~14.4 for this fixture data)
    assert.ok(record.cost_usd > 13 && record.cost_usd < 16,
      `cost should be ~14.4, got ${record.cost_usd}`);
  });

  test('session-end falls back to single-model when no events.jsonl', () => {
    const SESSION_ID_2 = 'test-singlemodel-002';

    // Session file only (no events.jsonl)
    const sessionFile = {
      session_id: SESSION_ID_2,
      started_at: '2026-05-20T12:00:00Z',
      start_month: '2026-05',
      model_id: 'claude-sonnet-4.6',
      last_known_model: 'claude-sonnet-4.6',
      last_known_at: '2026-05-20T13:00:00Z',
      last_known_cost: 5.5,
      last_known_tokens: {
        total_input_tokens: 1000000,
        total_output_tokens: 10000,
        total_cache_write_tokens: 50000,
        total_cache_read_tokens: 800000,
      },
      snapshot: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_write_tokens: 0,
        total_cache_read_tokens: 0,
      },
      project: 'test-project',
      project_id: '-Users-test-test-project',
    };
    fs.writeFileSync(
      path.join(tmpDataDir, 'sessions', SESSION_ID_2 + '.json'),
      JSON.stringify(sessionFile, null, 2)
    );

    const stdin = JSON.stringify({ sessionId: SESSION_ID_2 });
    const result = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'session-end.js')], {
      input: stdin,
      env: { ...process.env, COPILOT_HOME: tmpHome },
      timeout: 5000,
    });

    assert.equal(result.status, 0, 'should exit cleanly');

    const monthlyFile = path.join(tmpDataDir, 'monthly', '2026-05.jsonl');
    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, SESSION_ID_2);
    assert.equal(record.cost_method, 'single_model', 'should fall back to single_model');
    assert.ok(record.cost_usd > 0, 'cost should be positive');
    assert.equal(record.model_metrics, undefined, 'should not have model_metrics');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: parseSubagentCompletions
// ---------------------------------------------------------------------------

describe('parseSubagentCompletions', () => {
  test('parses subagent completions with cost', () => {
    const { parseSubagentCompletions } = require('../scripts/events-parser');
    const SESSION_ID_SA = 'test-subagent-unit';

    // Create events.jsonl with subagent.completed events
    const sessionDir = path.join(tmpSessionStateDir, SESSION_ID_SA);
    fs.mkdirSync(sessionDir, { recursive: true });
    const events = [
      JSON.stringify({
        type: 'subagent.completed',
        data: {
          agentName: 'gsd-executor',
          model: 'claude-sonnet-4.6',
          totalTokens: 2000000,
          durationMs: 330000,
          totalToolCalls: 45,
        },
      }),
      JSON.stringify({
        type: 'subagent.completed',
        data: {
          agentName: 'rubber-duck',
          model: 'gpt-5.5',
          totalTokens: 375820,
          durationMs: 416707,
          totalToolCalls: 17,
        },
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: { modelMetrics: {} },
      }),
    ];
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), events.join('\n') + '\n');

    const pricingTable = {
      'claude-sonnet-4.6': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
      'gpt-5.5': { input: 5.0, output: 30.0, cache_write: 0, cache_read: 0.5 },
    };

    // Override COPILOT_HOME for this test
    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;
    try {
      const result = parseSubagentCompletions(SESSION_ID_SA, pricingTable);
      assert.ok(result, 'should return results');
      assert.equal(result.length, 2);

      // First subagent: gsd-executor on sonnet
      assert.equal(result[0].name, 'gsd-executor');
      assert.equal(result[0].model, 'claude-sonnet-4.6');
      assert.equal(result[0].tokens, 2000000);
      assert.ok(result[0].cost_usd > 0);
      assert.equal(result[0].duration_ms, 330000);
      assert.equal(result[0].tool_calls, 45);

      // Verify cost calculation: 95% input + 5% output
      const expectedCost = (1900000 / 1e6 * 3.0) + (100000 / 1e6 * 15.0);
      assert.ok(Math.abs(result[0].cost_usd - expectedCost) < 0.01,
        `expected ~${expectedCost}, got ${result[0].cost_usd}`);

      // Second subagent: rubber-duck on gpt-5.5
      assert.equal(result[1].name, 'rubber-duck');
      assert.equal(result[1].model, 'gpt-5.5');
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('returns null when no events.jsonl', () => {
    const { parseSubagentCompletions } = require('../scripts/events-parser');
    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;
    try {
      const result = parseSubagentCompletions('nonexistent-session', {});
      assert.equal(result, null);
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests: parseCompactionCosts
// ---------------------------------------------------------------------------

describe('parseCompactionCosts', () => {
  test('parses compaction events with cost', () => {
    const { parseCompactionCosts } = require('../scripts/events-parser');
    const SESSION_ID_COMP = 'test-compaction-unit';

    // Create events.jsonl with session.compaction_complete events
    const sessionDir = path.join(tmpSessionStateDir, SESSION_ID_COMP);
    fs.mkdirSync(sessionDir, { recursive: true });
    const events = [
      JSON.stringify({
        type: 'session.compaction_complete',
        data: {
          success: true,
          preCompactionTokens: 102000,
          compactionTokensUsed: {
            inputTokens: 131504,
            outputTokens: 2706,
            cacheReadTokens: 129508,
            cacheWriteTokens: 0,
            model: 'claude-sonnet-4.6',
            duration: 8500,
          },
        },
        timestamp: '2026-05-20T10:30:00Z',
      }),
      JSON.stringify({
        type: 'session.compaction_complete',
        data: {
          success: true,
          preCompactionTokens: 105000,
          compactionTokensUsed: {
            inputTokens: 135000,
            outputTokens: 3100,
            cacheReadTokens: 130000,
            cacheWriteTokens: 0,
            model: 'claude-sonnet-4.6',
            duration: 9200,
          },
        },
        timestamp: '2026-05-20T11:00:00Z',
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: { modelMetrics: {} },
      }),
    ];
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), events.join('\n') + '\n');

    const pricingTable = {
      'claude-sonnet-4.6': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
    };

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;
    try {
      const result = parseCompactionCosts(SESSION_ID_COMP, pricingTable);
      assert.ok(result, 'should return results');
      assert.equal(result.count, 2);
      assert.equal(result.compactions.length, 2);
      assert.ok(result.total_cost_usd > 0, 'total cost should be positive');

      // Verify first compaction cost
      // (131504/1e6 * 3) + (2706/1e6 * 15) + (129508/1e6 * 0.3) = 0.394512 + 0.04059 + 0.038852
      const expectedCost1 = 131504 / 1e6 * 3.0 + 2706 / 1e6 * 15.0 + 129508 / 1e6 * 0.3;
      assert.ok(Math.abs(result.compactions[0].cost_usd - expectedCost1) < 0.001,
        `expected ~${expectedCost1}, got ${result.compactions[0].cost_usd}`);

      assert.equal(result.compactions[0].model, 'claude-sonnet-4.6');
      assert.equal(result.compactions[0].input_tokens, 131504);
      assert.equal(result.compactions[0].output_tokens, 2706);
      assert.equal(result.compactions[0].duration_ms, 8500);
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('returns null when no compaction events', () => {
    const { parseCompactionCosts } = require('../scripts/events-parser');
    const SESSION_ID_NO_COMP = 'test-no-compaction-unit';

    // events.jsonl without compaction events
    const sessionDir = path.join(tmpSessionStateDir, SESSION_ID_NO_COMP);
    fs.mkdirSync(sessionDir, { recursive: true });
    const events = [
      JSON.stringify({
        type: 'session.shutdown',
        data: { modelMetrics: {} },
      }),
    ];
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), events.join('\n') + '\n');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;
    try {
      const result = parseCompactionCosts(SESSION_ID_NO_COMP, {});
      assert.equal(result, null, 'should return null for no compactions');
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('handles compaction events without compactionTokensUsed', () => {
    const { parseCompactionCosts } = require('../scripts/events-parser');
    const SESSION_ID_OLD = 'test-old-compaction-format';

    // Older format without compactionTokensUsed
    const sessionDir = path.join(tmpSessionStateDir, SESSION_ID_OLD);
    fs.mkdirSync(sessionDir, { recursive: true });
    const events = [
      JSON.stringify({
        type: 'session.compaction_complete',
        data: {
          success: true,
          preCompactionTokens: 102000,
          // No compactionTokensUsed field
        },
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: { modelMetrics: {} },
      }),
    ];
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), events.join('\n') + '\n');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;
    try {
      const result = parseCompactionCosts(SESSION_ID_OLD, {});
      assert.equal(result, null, 'should return null when compactionTokensUsed is missing');
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });
});

// ---------------------------------------------------------------------------
// Integration test: session-end includes subagents_detail
// ---------------------------------------------------------------------------

describe('session-end.js subagent attribution', () => {
  test('includes subagents_detail when subagent events exist', () => {
    const SESSION_ID_3 = 'test-subagent-integration';

    // Session file
    const sessionFile = {
      session_id: SESSION_ID_3,
      started_at: '2026-05-20T14:00:00Z',
      start_month: '2026-05',
      model_id: 'claude-sonnet-4.6',
      last_known_model: 'claude-sonnet-4.6',
      last_known_at: '2026-05-20T15:00:00Z',
      last_known_cost: 20.0,
      last_known_tokens: {
        total_input_tokens: 5000000,
        total_output_tokens: 50000,
        total_cache_write_tokens: 100000,
        total_cache_read_tokens: 4000000,
      },
      snapshot: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_write_tokens: 0,
        total_cache_read_tokens: 0,
      },
      project: 'test-project',
      project_id: '-Users-test-test-project',
    };
    fs.writeFileSync(
      path.join(tmpDataDir, 'sessions', SESSION_ID_3 + '.json'),
      JSON.stringify(sessionFile, null, 2)
    );

    // events.jsonl with shutdown + subagent events
    const sessionStateDir = path.join(tmpSessionStateDir, SESSION_ID_3);
    fs.mkdirSync(sessionStateDir, { recursive: true });
    const events = [
      JSON.stringify({
        type: 'subagent.completed',
        data: {
          agentName: 'explore',
          model: 'claude-haiku-4.5',
          totalTokens: 500000,
          durationMs: 60000,
          totalToolCalls: 20,
        },
      }),
      JSON.stringify({
        type: 'subagent.completed',
        data: {
          agentName: 'gsd-executor',
          model: 'claude-sonnet-4.6',
          totalTokens: 3000000,
          durationMs: 400000,
          totalToolCalls: 80,
        },
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          modelMetrics: {
            'claude-sonnet-4.6': {
              requests: { count: 100, cost: 15 },
              usage: { inputTokens: 4500000, outputTokens: 45000, cacheReadTokens: 3800000, cacheWriteTokens: 95000 },
            },
            'claude-haiku-4.5': {
              requests: { count: 10, cost: 1 },
              usage: { inputTokens: 500000, outputTokens: 5000, cacheReadTokens: 200000, cacheWriteTokens: 5000 },
            },
          },
        },
      }),
    ];
    fs.writeFileSync(path.join(sessionStateDir, 'events.jsonl'), events.join('\n') + '\n');

    const stdin = JSON.stringify({ sessionId: SESSION_ID_3 });
    const result = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'session-end.js')], {
      input: stdin,
      env: { ...process.env, COPILOT_HOME: tmpHome },
      timeout: 5000,
    });

    assert.equal(result.status, 0, 'should exit cleanly');

    const monthlyFile = path.join(tmpDataDir, 'monthly', '2026-05.jsonl');
    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, SESSION_ID_3);
    assert.ok(record.subagents_detail, 'should have subagents_detail');
    assert.equal(record.subagents_detail.length, 2);

    // Check first subagent (explore on haiku)
    assert.equal(record.subagents_detail[0].name, 'explore');
    assert.equal(record.subagents_detail[0].model, 'claude-haiku-4.5');
    assert.equal(record.subagents_detail[0].tokens, 500000);
    assert.ok(record.subagents_detail[0].cost_usd > 0, 'explore should have cost');
    assert.equal(record.subagents_detail[0].tool_calls, 20);

    // Check second subagent (executor on sonnet)
    assert.equal(record.subagents_detail[1].name, 'gsd-executor');
    assert.equal(record.subagents_detail[1].model, 'claude-sonnet-4.6');
    assert.ok(record.subagents_detail[1].cost_usd > record.subagents_detail[0].cost_usd,
      'sonnet executor should cost more than haiku explore');

    // Sum of subagent costs should be <= total cost
    const subagentTotal = record.subagents_detail.reduce((s, a) => s + a.cost_usd, 0);
    assert.ok(subagentTotal <= record.cost_usd,
      `subagent total (${subagentTotal}) should be <= session total (${record.cost_usd})`);
  });
});

// ---------------------------------------------------------------------------
// Integration test: session-end includes compaction_cost
// ---------------------------------------------------------------------------

describe('session-end.js compaction cost', () => {
  test('includes compaction_cost when compaction events exist', () => {
    const SESSION_ID_4 = 'test-compaction-integration';

    // Session file
    const sessionFile = {
      session_id: SESSION_ID_4,
      started_at: '2026-05-20T16:00:00Z',
      start_month: '2026-05',
      model_id: 'claude-sonnet-4.6',
      last_known_model: 'claude-sonnet-4.6',
      last_known_at: '2026-05-20T17:00:00Z',
      last_known_cost: 30.0,
      last_known_tokens: {
        total_input_tokens: 10000000,
        total_output_tokens: 80000,
        total_cache_write_tokens: 200000,
        total_cache_read_tokens: 8000000,
      },
      snapshot: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_write_tokens: 0,
        total_cache_read_tokens: 0,
      },
      project: 'test-project',
      project_id: '-Users-test-test-project',
    };
    fs.writeFileSync(
      path.join(tmpDataDir, 'sessions', SESSION_ID_4 + '.json'),
      JSON.stringify(sessionFile, null, 2)
    );

    // events.jsonl with compaction + shutdown
    const sessionStateDir = path.join(tmpSessionStateDir, SESSION_ID_4);
    fs.mkdirSync(sessionStateDir, { recursive: true });
    const events = [
      JSON.stringify({
        type: 'session.compaction_complete',
        data: {
          success: true,
          preCompactionTokens: 102000,
          compactionTokensUsed: {
            inputTokens: 130000,
            outputTokens: 3000,
            cacheReadTokens: 125000,
            cacheWriteTokens: 0,
            model: 'claude-sonnet-4.6',
            duration: 8000,
          },
        },
        timestamp: '2026-05-20T16:30:00Z',
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          modelMetrics: {
            'claude-sonnet-4.6': {
              requests: { count: 120, cost: 18 },
              usage: { inputTokens: 10000000, outputTokens: 80000, cacheReadTokens: 8000000, cacheWriteTokens: 200000 },
            },
          },
        },
      }),
    ];
    fs.writeFileSync(path.join(sessionStateDir, 'events.jsonl'), events.join('\n') + '\n');

    const stdin = JSON.stringify({ sessionId: SESSION_ID_4 });
    const result = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'session-end.js')], {
      input: stdin,
      env: { ...process.env, COPILOT_HOME: tmpHome },
      timeout: 5000,
    });

    assert.equal(result.status, 0, 'should exit cleanly');

    const monthlyFile = path.join(tmpDataDir, 'monthly', '2026-05.jsonl');
    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, SESSION_ID_4);
    assert.ok(record.compaction_cost, 'should have compaction_cost');
    assert.equal(record.compaction_cost.count, 1);
    assert.ok(record.compaction_cost.total_cost_usd > 0, 'compaction cost should be positive');
    assert.equal(record.compaction_cost.compactions[0].model, 'claude-sonnet-4.6');
    assert.equal(record.compaction_cost.compactions[0].input_tokens, 130000);

    // compaction_cost should be a SUBSET of total cost (not additive)
    assert.ok(record.compaction_cost.total_cost_usd < record.cost_usd,
      `compaction cost ($${record.compaction_cost.total_cost_usd}) should be < total ($${record.cost_usd})`);
  });

  test('omits compaction_cost when no compaction events', () => {
    const SESSION_ID_5 = 'test-no-compaction-integration';

    const sessionFile = {
      session_id: SESSION_ID_5,
      started_at: '2026-05-20T18:00:00Z',
      start_month: '2026-05',
      model_id: 'claude-sonnet-4.6',
      last_known_model: 'claude-sonnet-4.6',
      last_known_at: '2026-05-20T19:00:00Z',
      last_known_cost: 5.0,
      last_known_tokens: {
        total_input_tokens: 1000000,
        total_output_tokens: 10000,
        total_cache_write_tokens: 50000,
        total_cache_read_tokens: 800000,
      },
      snapshot: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_write_tokens: 0,
        total_cache_read_tokens: 0,
      },
      project: 'test-project',
      project_id: '-Users-test-test-project',
    };
    fs.writeFileSync(
      path.join(tmpDataDir, 'sessions', SESSION_ID_5 + '.json'),
      JSON.stringify(sessionFile, null, 2)
    );

    // events.jsonl WITHOUT compaction events
    const sessionStateDir = path.join(tmpSessionStateDir, SESSION_ID_5);
    fs.mkdirSync(sessionStateDir, { recursive: true });
    const events = [
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          modelMetrics: {
            'claude-sonnet-4.6': {
              requests: { count: 20, cost: 3 },
              usage: { inputTokens: 1000000, outputTokens: 10000, cacheReadTokens: 800000, cacheWriteTokens: 50000 },
            },
          },
        },
      }),
    ];
    fs.writeFileSync(path.join(sessionStateDir, 'events.jsonl'), events.join('\n') + '\n');

    const stdin = JSON.stringify({ sessionId: SESSION_ID_5 });
    const result = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'session-end.js')], {
      input: stdin,
      env: { ...process.env, COPILOT_HOME: tmpHome },
      timeout: 5000,
    });

    assert.equal(result.status, 0, 'should exit cleanly');

    const monthlyFile = path.join(tmpDataDir, 'monthly', '2026-05.jsonl');
    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, SESSION_ID_5);
    assert.equal(record.compaction_cost, undefined, 'should NOT have compaction_cost field');
    assert.ok(record.cost_usd > 0);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: parseShutdownEnriched
// ---------------------------------------------------------------------------

describe('parseShutdownEnriched', () => {
  const SESSION_ENRICHED = 'enriched-test-001';

  before(() => {
    // Write a full shutdown event with all enriched fields
    const sessionDir = path.join(tmpSessionStateDir, SESSION_ENRICHED);
    fs.mkdirSync(sessionDir, { recursive: true });

    const shutdownEvent = {
      type: 'session.shutdown',
      data: {
        shutdownType: 'routine',
        totalPremiumRequests: 12,
        totalApiDurationMs: 300000,
        sessionStartTime: 1776478755617,
        codeChanges: {
          linesAdded: 120,
          linesRemoved: 45,
          filesModified: ['/src/app.js', '/src/utils.js', '/tests/app.test.js'],
        },
        currentModel: 'claude-opus-4.6',
        currentTokens: 80000,
        systemTokens: 10000,
        conversationTokens: 50000,
        toolDefinitionsTokens: 20000,
        modelMetrics: {
          'claude-opus-4.6': {
            requests: { count: 30, cost: 10 },
            usage: { inputTokens: 2000000, outputTokens: 50000, cacheReadTokens: 1500000, cacheWriteTokens: 400000, reasoningTokens: 0 },
          },
          'claude-haiku-4.5': {
            requests: { count: 15, cost: 2 },
            usage: { inputTokens: 500000, outputTokens: 10000, cacheReadTokens: 400000, cacheWriteTokens: 0, reasoningTokens: 8000 },
          },
        },
      },
      id: 'shutdown-enriched',
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify(shutdownEvent) + '\n'
    );
  });

  test('extracts all enriched fields from shutdown event', () => {
    const { parseShutdownEnriched } = require('../scripts/events-parser');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;

    try {
      const result = parseShutdownEnriched(SESSION_ENRICHED);

      assert.ok(result, 'should return enriched object');
      assert.deepEqual(result.files_modified, ['/src/app.js', '/src/utils.js', '/tests/app.test.js']);
      assert.equal(result.files_modified_count, 3);
      assert.equal(result.lines_added, 120);
      assert.equal(result.lines_removed, 45);
      assert.equal(result.premium_requests, 12);
      assert.equal(result.api_duration_ms, 300000);
      assert.equal(result.reasoning_tokens, 8000);
      assert.deepEqual(result.context_breakdown, { system: 10000, conversation: 50000, tool_definitions: 20000 });
      assert.deepEqual(result.models_used.sort(), ['claude-haiku-4.5', 'claude-opus-4.6']);
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('returns null when no events.jsonl exists', () => {
    const { parseShutdownEnriched } = require('../scripts/events-parser');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;

    try {
      const result = parseShutdownEnriched('nonexistent-session-xyz');
      assert.equal(result, null);
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('omits reasoning_tokens when none present', () => {
    const { parseShutdownEnriched } = require('../scripts/events-parser');

    // Create a session with no reasoning tokens
    const sessionId = 'enriched-no-reasoning';
    const sessionDir = path.join(tmpSessionStateDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), JSON.stringify({
      type: 'session.shutdown',
      data: {
        totalPremiumRequests: 5,
        totalApiDurationMs: 100000,
        codeChanges: { linesAdded: 10, linesRemoved: 2, filesModified: [] },
        systemTokens: 5000,
        conversationTokens: 20000,
        toolDefinitionsTokens: 8000,
        modelMetrics: {
          'claude-sonnet-4.6': {
            requests: { count: 10, cost: 5 },
            usage: { inputTokens: 500000, outputTokens: 10000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
          },
        },
      },
    }) + '\n');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;

    try {
      const result = parseShutdownEnriched(sessionId);
      assert.ok(result);
      assert.equal(result.reasoning_tokens, undefined, 'should not include reasoning_tokens when 0');
      assert.equal(result.files_modified, undefined, 'should not include empty files_modified');
      assert.equal(result.files_modified_count, undefined);
      assert.equal(result.premium_requests, 5);
      assert.deepEqual(result.models_used, ['claude-sonnet-4.6']);
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });
});

// ---------------------------------------------------------------------------
// Integration test: session-end.js includes enriched fields in monthly JSONL
// ---------------------------------------------------------------------------

describe('session-end.js enriched fields integration', () => {
  const SESSION_ID_ENRICHED = 'test-enriched-integration-001';

  before(() => {
    // Create session file
    const sessionFile = {
      session_id: SESSION_ID_ENRICHED,
      started_at: '2026-05-20T10:00:00Z',
      start_month: '2026-05',
      model_id: 'claude-opus-4.6',
      last_known_model: 'claude-opus-4.6',
      last_known_at: '2026-05-20T12:00:00Z',
      last_known_cost: 5.0,
      last_known_tokens: {
        total_input_tokens: 2500000,
        total_output_tokens: 60000,
        total_cache_write_tokens: 400000,
        total_cache_read_tokens: 1900000,
      },
      snapshot: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_write_tokens: 0,
        total_cache_read_tokens: 0,
      },
      project: 'enriched-test',
      project_id: '-Users-test-enriched-test',
    };
    fs.writeFileSync(
      path.join(tmpDataDir, 'sessions', SESSION_ID_ENRICHED + '.json'),
      JSON.stringify(sessionFile, null, 2)
    );

    // Create events.jsonl with full shutdown data including enriched fields
    const sessionStateDir = path.join(tmpSessionStateDir, SESSION_ID_ENRICHED);
    fs.mkdirSync(sessionStateDir, { recursive: true });
    const shutdownEvent = {
      type: 'session.shutdown',
      data: {
        shutdownType: 'routine',
        totalPremiumRequests: 25,
        totalApiDurationMs: 450000,
        sessionStartTime: 1776478755617,
        codeChanges: {
          linesAdded: 200,
          linesRemoved: 80,
          filesModified: ['/src/main.js', '/src/utils.js'],
        },
        currentModel: 'claude-opus-4.6',
        currentTokens: 90000,
        systemTokens: 12000,
        conversationTokens: 55000,
        toolDefinitionsTokens: 23000,
        modelMetrics: {
          'claude-opus-4.6': {
            requests: { count: 40, cost: 20 },
            usage: {
              inputTokens: 2500000,
              outputTokens: 60000,
              cacheReadTokens: 1900000,
              cacheWriteTokens: 400000,
              reasoningTokens: 15000,
            },
          },
        },
      },
      id: 'shutdown-enriched-integ',
      timestamp: '2026-05-20T12:01:00Z',
    };
    fs.writeFileSync(
      path.join(sessionStateDir, 'events.jsonl'),
      JSON.stringify(shutdownEvent) + '\n'
    );
  });

  test('session-end includes enriched fields in monthly record', () => {
    const stdin = JSON.stringify({ sessionId: SESSION_ID_ENRICHED });
    const result = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'session-end.js')], {
      input: stdin,
      env: { ...process.env, COPILOT_HOME: tmpHome },
      timeout: 5000,
    });

    if (result.status !== 0) {
      console.error('session-end stderr:', result.stderr?.toString());
    }
    assert.equal(result.status, 0, 'session-end should exit cleanly');

    const monthlyFile = path.join(tmpDataDir, 'monthly', '2026-05.jsonl');
    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, SESSION_ID_ENRICHED);

    // Enriched fields should be present
    assert.deepEqual(record.files_modified, ['/src/main.js', '/src/utils.js']);
    assert.equal(record.files_modified_count, 2);
    assert.equal(record.lines_added, 200);
    assert.equal(record.lines_removed, 80);
    assert.equal(record.premium_requests, 25);
    assert.equal(record.api_duration_ms, 450000);
    assert.equal(record.reasoning_tokens, 15000);
    assert.deepEqual(record.context_breakdown, { system: 12000, conversation: 55000, tool_definitions: 23000 });
    assert.deepEqual(record.models_used, ['claude-opus-4.6']);
  });
});
