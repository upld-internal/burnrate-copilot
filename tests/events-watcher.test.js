'use strict';
// tests/events-watcher.test.js — Task 9: events.jsonl watcher for live subagent display
//
// Tests that pollSubagentEvents correctly tails events.jsonl, tracks offset,
// and supplements hud-state with subagent lifecycle events.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

let tmpHome;
let tmpDataDir;
let tmpSessionStateDir;

before(() => {
  tmpHome            = fs.mkdtempSync(path.join(os.tmpdir(), 'burnrate-watcher-test-'));
  tmpDataDir         = path.join(tmpHome, 'plugin-data', 'burnrate-copilot');
  tmpSessionStateDir = path.join(tmpHome, 'session-state');
  fs.mkdirSync(path.join(tmpDataDir, 'sessions'), { recursive: true });
  fs.mkdirSync(tmpSessionStateDir, { recursive: true });
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('pollSubagentEvents', () => {
  const SESSION_ID = 'watcher-test-001';

  before(() => {
    // Create session state dir with events.jsonl
    const sessionStateDir = path.join(tmpSessionStateDir, SESSION_ID);
    fs.mkdirSync(sessionStateDir, { recursive: true });

    const events = [
      { type: 'session.start', data: {}, timestamp: '2026-05-20T10:00:00Z' },
      { type: 'subagent.started', data: { toolCallId: 'agent-1', agentName: 'explore', agentDisplayName: 'Explorer Agent' }, timestamp: '2026-05-20T10:01:00Z' },
      { type: 'subagent.started', data: { toolCallId: 'agent-2', agentName: 'task', agentDisplayName: 'Task Agent', model: 'claude-haiku-4.5' }, timestamp: '2026-05-20T10:02:00Z' },
      { type: 'subagent.completed', data: { toolCallId: 'agent-1', agentName: 'explore', model: 'claude-haiku-4.5', totalTokens: 50000, durationMs: 5000, totalToolCalls: 3 }, timestamp: '2026-05-20T10:03:00Z' },
    ];

    fs.writeFileSync(
      path.join(sessionStateDir, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n'
    );

    // Create session file (for offset tracking)
    fs.writeFileSync(
      path.join(tmpDataDir, 'sessions', SESSION_ID + '.json'),
      JSON.stringify({ session_id: SESSION_ID, start_month: '2026-05' })
    );
  });

  test('finds subagent started and completed events', () => {
    const { pollSubagentEvents } = require('../scripts/events-watcher');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;

    try {
      const result = pollSubagentEvents(SESSION_ID, []);
      assert.equal(result.started.length, 2, 'should find 2 started agents');
      assert.equal(result.completed.length, 1, 'should find 1 completed agent');

      // Verify started agent fields
      const first = result.started[0];
      assert.equal(first.id, 'agent-1');
      assert.equal(first.name, 'explore');
      assert.equal(first.displayName, 'Explorer Agent');
      assert.equal(first.status, 'running');

      const second = result.started[1];
      assert.equal(second.id, 'agent-2');
      assert.equal(second.model, 'claude-haiku-4.5');

      // Verify completed agent fields
      const done = result.completed[0];
      assert.equal(done.id, 'agent-1');
      assert.equal(done.status, 'completed');
      assert.equal(done.tokens, 50000);
      assert.equal(done.durationMs, 5000);
      assert.equal(done.toolCalls, 3);
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('filters out known agent IDs', () => {
    const { pollSubagentEvents } = require('../scripts/events-watcher');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;

    try {
      // Reset offset so it re-reads from start
      const sessionPath = path.join(tmpDataDir, 'sessions', SESSION_ID + '.json');
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      delete session._watcher_offset;
      fs.writeFileSync(sessionPath, JSON.stringify(session));

      const result = pollSubagentEvents(SESSION_ID, ['agent-1']);
      assert.equal(result.started.length, 1, 'should only find agent-2 (agent-1 is known)');
      assert.equal(result.started[0].id, 'agent-2');
      // Completed events still show all (needed to update status)
      assert.equal(result.completed.length, 1);
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('persists offset and only reads new events on second call', () => {
    const { pollSubagentEvents } = require('../scripts/events-watcher');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;

    try {
      // Reset offset
      const sessionPath = path.join(tmpDataDir, 'sessions', SESSION_ID + '.json');
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      delete session._watcher_offset;
      fs.writeFileSync(sessionPath, JSON.stringify(session));

      // First poll reads everything
      const first = pollSubagentEvents(SESSION_ID, []);
      assert.equal(first.started.length, 2);

      // Second poll with no new data should return empty
      const second = pollSubagentEvents(SESSION_ID, []);
      assert.equal(second.started.length, 0, 'second poll should find nothing new');
      assert.equal(second.completed.length, 0);

      // Append new event
      const eventsFile = path.join(tmpSessionStateDir, SESSION_ID, 'events.jsonl');
      fs.appendFileSync(eventsFile, JSON.stringify({
        type: 'subagent.completed',
        data: { toolCallId: 'agent-2', agentName: 'task', model: 'claude-haiku-4.5', totalTokens: 80000, durationMs: 10000, totalToolCalls: 5 },
        timestamp: '2026-05-20T10:05:00Z',
      }) + '\n');

      // Third poll should only see the new event
      const third = pollSubagentEvents(SESSION_ID, []);
      assert.equal(third.started.length, 0);
      assert.equal(third.completed.length, 1);
      assert.equal(third.completed[0].id, 'agent-2');
      assert.equal(third.completed[0].tokens, 80000);
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('returns empty when no events.jsonl exists', () => {
    const { pollSubagentEvents } = require('../scripts/events-watcher');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;

    try {
      const result = pollSubagentEvents('nonexistent-session-xyz', []);
      assert.deepEqual(result, { started: [], completed: [] });
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });

  test('handles subagent.failed events', () => {
    const { pollSubagentEvents } = require('../scripts/events-watcher');

    const origHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = tmpHome;

    try {
      // Create a new session with a failed agent
      const failSessionId = 'watcher-fail-001';
      const sessionStateDir = path.join(tmpSessionStateDir, failSessionId);
      fs.mkdirSync(sessionStateDir, { recursive: true });
      fs.writeFileSync(path.join(sessionStateDir, 'events.jsonl'), [
        JSON.stringify({ type: 'subagent.started', data: { toolCallId: 'fail-1', agentName: 'explore' }, timestamp: '2026-05-20T10:00:00Z' }),
        JSON.stringify({ type: 'subagent.failed', data: { toolCallId: 'fail-1', agentName: 'explore', model: 'claude-haiku-4.5', totalTokens: 1000, durationMs: 500 }, timestamp: '2026-05-20T10:00:05Z' }),
      ].join('\n') + '\n');

      fs.writeFileSync(
        path.join(tmpDataDir, 'sessions', failSessionId + '.json'),
        JSON.stringify({ session_id: failSessionId })
      );

      const result = pollSubagentEvents(failSessionId, []);
      assert.equal(result.completed.length, 1);
      assert.equal(result.completed[0].status, 'failed');
    } finally {
      if (origHome) process.env.COPILOT_HOME = origHome;
      else delete process.env.COPILOT_HOME;
    }
  });
});
