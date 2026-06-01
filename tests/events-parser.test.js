'use strict';
// tests/events-parser.test.js — AI Credits billing and session-end integration
//
// Tests for events-parser.js (unit) and integration with session-end.js.
// Cost is derived from ai_used.total_nano_aiu (AI Credits billing).

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
  tmpDataDir         = path.join(tmpHome, 'plugin-data', 'burnrate-copilot');
  tmpSessionStateDir = path.join(tmpHome, 'session-state');
  fs.mkdirSync(path.join(tmpDataDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(tmpDataDir, 'monthly'),  { recursive: true });
  fs.mkdirSync(tmpSessionStateDir, { recursive: true });
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('session-end.js ai_credits integration', () => {
  const SESSION_ID = 'test-ai-credits-001';

  before(() => {
    const sessionFile = {
      session_id: SESSION_ID,
      started_at: '2026-06-01T10:00:00Z',
      start_month: '2026-06',
      model_id: 'claude-sonnet-4.6',
      last_known_model: 'claude-sonnet-4.6',
      last_known_at: '2026-06-01T11:00:00Z',
      last_known_nano_aiu: 6987975000,
      last_known_cost: 0.069879750,
      last_known_tokens: {
        total_input_tokens: 85386,
        total_output_tokens: 98,
        total_cache_write_tokens: 12397,
        total_cache_read_tokens: 72980,
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
  });

  test('session-end uses last_known_nano_aiu and reports cost_method ai_credits', () => {
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

    const monthlyFile = path.join(tmpDataDir, 'monthly', '2026-06.jsonl');
    assert.ok(fs.existsSync(monthlyFile), 'monthly file should exist');

    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, SESSION_ID);
    assert.equal(record.cost_method, 'ai_credits', 'should use ai_credits method');
    // 6987975000 / 100_000_000_000 = 0.06987975
    const expectedCost = 6987975000 / 100_000_000_000;
    assert.ok(Math.abs(record.cost_usd - expectedCost) < 0.000001,
      `cost should be ~${expectedCost}, got ${record.cost_usd}`);
    assert.equal(record.model_metrics, undefined, 'should not have model_metrics');
    assert.ok(record.final_tokens, 'should preserve final_tokens');
  });

  test('session-end falls back to last_known_cost when no nano_aiu', () => {
    const SESSION_ID_2 = 'test-last-known-002';

    const sessionFile = {
      session_id: SESSION_ID_2,
      started_at: '2026-06-01T12:00:00Z',
      start_month: '2026-06',
      model_id: 'claude-sonnet-4.6',
      last_known_model: 'claude-sonnet-4.6',
      last_known_at: '2026-06-01T13:00:00Z',
      last_known_cost: 0.05,
      last_known_tokens: {
        total_input_tokens: 50000,
        total_output_tokens: 500,
        total_cache_write_tokens: 5000,
        total_cache_read_tokens: 30000,
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

    const monthlyFile = path.join(tmpDataDir, 'monthly', '2026-06.jsonl');
    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, SESSION_ID_2);
    assert.equal(record.cost_method, 'last_known');
    assert.equal(record.cost_usd, 0.05);
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
