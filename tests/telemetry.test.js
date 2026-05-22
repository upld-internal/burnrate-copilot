'use strict';
// tests/telemetry.test.js — Phase 2: Rich Session Telemetry
//
// Tests for session-file.js (unit), and hook scripts as subprocesses.
// All subprocess tests write to a temp COPILOT_HOME directory to avoid
// touching real plugin data.

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
let tmpDataDir;  // tmpHome/burnrate-copilot/

before(() => {
  tmpHome    = fs.mkdtempSync(path.join(os.tmpdir(), 'burnrate-copilot-test-'));
  tmpDataDir = path.join(tmpHome, 'burnrate-copilot');
  fs.mkdirSync(path.join(tmpDataDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(tmpDataDir, 'monthly'),  { recursive: true });
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Run a hook script as a subprocess with piped stdin and a temp COPILOT_HOME.
function runHook(scriptName, payload, env) {
  const scriptPath = path.join(__dirname, '..', 'scripts', scriptName);
  return spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    env: { ...process.env, COPILOT_HOME: tmpHome, ...(env || {}) },
    cwd: path.join(__dirname, '..'),
    timeout: 5000,
  });
}

// Write a minimal hud-state.json so hooks can look up the current sessionId.
function writeState(sessionId, extra) {
  const stateFile = path.join(tmpHome, 'hud-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    sessionId,
    sessionActive: true,
    recentTools: [],
    agents: [],
    ...extra,
  }, null, 2));
}

// Write a minimal session file so mustExist checks pass.
function writeSession(sessionId, fields) {
  const sessionPath = path.join(tmpDataDir, 'sessions', sessionId + '.json');
  fs.writeFileSync(sessionPath, JSON.stringify({
    session_id:  sessionId,
    started_at:  new Date().toISOString(),
    start_month: new Date().toISOString().slice(0, 7),
    model_id:    'claude-sonnet-4.6',
    snapshot:    { total_input_tokens: 0, total_output_tokens: 0, total_cache_write_tokens: 0, total_cache_read_tokens: 0 },
    ...(fields || {}),
  }, null, 2));
}

function readSession(sessionId) {
  const sessionPath = path.join(tmpDataDir, 'sessions', sessionId + '.json');
  return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Unit tests: buildTelemetryFields (no file I/O needed)
// ---------------------------------------------------------------------------

describe('buildTelemetryFields', () => {
  const { buildTelemetryFields } = require('../scripts/session-file');

  test('returns empty object for empty session', () => {
    assert.deepEqual(buildTelemetryFields({}), {});
  });

  test('omits zero turn_count', () => {
    const f = buildTelemetryFields({ turn_count: 0 });
    assert.equal(f.turn_count, undefined);
  });

  test('includes turn_count when > 0', () => {
    const f = buildTelemetryFields({ turn_count: 5 });
    assert.equal(f.turn_count, 5);
  });

  test('includes non-empty tool_counts', () => {
    const f = buildTelemetryFields({ tool_counts: { bash: 3, edit: 1 } });
    assert.deepEqual(f.tool_counts, { bash: 3, edit: 1 });
  });

  test('omits empty tool_counts map', () => {
    const f = buildTelemetryFields({ tool_counts: {} });
    assert.equal(f.tool_counts, undefined);
  });

  test('includes non-empty ext_counts', () => {
    const f = buildTelemetryFields({ ext_counts: { '.ts': 4 } });
    assert.deepEqual(f.ext_counts, { '.ts': 4 });
  });

  test('computes turn_interval stats from intervals array', () => {
    const f = buildTelemetryFields({ turn_intervals: [1000, 3000, 2000] });
    assert.equal(f.turn_interval_p50_ms, 2000);
    assert.equal(f.turn_interval_max_ms, 3000);
    assert.equal(f.turn_interval_count, 3);
  });

  test('p50 of even-length array rounds to average of two middle values', () => {
    const f = buildTelemetryFields({ turn_intervals: [1000, 2000, 3000, 4000] });
    assert.equal(f.turn_interval_p50_ms, 2500);
  });

  test('includes git_branch when set', () => {
    const f = buildTelemetryFields({ git_branch: 'feature/my-branch' });
    assert.equal(f.git_branch, 'feature/my-branch');
  });

  test('includes subagent_count and subagent_types', () => {
    const f = buildTelemetryFields({
      subagents: [
        { type: 'explore', started_at: '2026-01-01' },
        { type: 'explore', started_at: '2026-01-02' },
        { type: 'task',    started_at: '2026-01-03' },
      ],
    });
    assert.equal(f.subagent_count, 3);
    assert.deepEqual(f.subagent_types, { explore: 2, task: 1 });
  });
});

// ---------------------------------------------------------------------------
// Unit tests: updateSession (uses subprocess to avoid module-cache data dir)
// ---------------------------------------------------------------------------

describe('updateSession', () => {
  test('creates session file when mustExist is false (default)', () => {
    const sid = 'test-create-' + Date.now();
    runHook('session-start.js', {
      sessionId: sid,
      session_id: sid,
      model:  { id: 'claude-sonnet-4.6' },
      cwd:    '/tmp',
    });
    const sessionPath = path.join(tmpDataDir, 'sessions', sid + '.json');
    assert.ok(fs.existsSync(sessionPath), 'session file should be created');
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    assert.equal(data.session_id, sid);
  });

  test('does NOT create session file when mustExist is true (telemetry hooks)', () => {
    const sid = 'test-no-create-' + Date.now();
    // Write state.json pointing to this session BUT don't create the session file
    writeState(sid);
    // Fire a pre-tool-use hook — should not create a session file
    runHook('pre-tool-use.js', {
      toolName: 'bash',
      toolArgs: { command: 'ls' },
      timestamp: Date.now(),
    });
    const sessionPath = path.join(tmpDataDir, 'sessions', sid + '.json');
    assert.ok(!fs.existsSync(sessionPath), 'session file should NOT be created by telemetry hook');
  });

  test('merges telemetry without overwriting existing fields', () => {
    const sid = 'test-merge-' + Date.now();
    writeState(sid);
    writeSession(sid, { existing_field: 'preserved' });

    runHook('pre-tool-use.js', {
      toolName: 'bash',
      toolArgs: { command: 'ls' },
      timestamp: Date.now(),
    });

    const data = readSession(sid);
    assert.equal(data.existing_field, 'preserved', 'pre-existing fields must survive');
    assert.equal(data.tool_counts.bash, 1);
  });
});

// ---------------------------------------------------------------------------
// Integration: pre-tool-use.js
// ---------------------------------------------------------------------------

describe('pre-tool-use.js telemetry', () => {
  test('increments tool_counts.bash for bash tool', () => {
    const sid = 'test-bash-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', {
      toolName: 'bash',
      toolArgs: { command: 'ls -la' },
      timestamp: Date.now(),
    });

    const data = readSession(sid);
    assert.equal(data.tool_counts?.bash, 1);
  });

  test('increments tool_counts on repeated calls', () => {
    const sid = 'test-bash-repeat-' + Date.now();
    writeState(sid);
    writeSession(sid);

    const payload = { toolName: 'bash', toolArgs: { command: 'ls' }, timestamp: Date.now() };
    runHook('pre-tool-use.js', payload);
    runHook('pre-tool-use.js', payload);
    runHook('pre-tool-use.js', payload);

    const data = readSession(sid);
    assert.equal(data.tool_counts?.bash, 3);
  });

  test('records ext_counts for edit tool with .ts file', () => {
    const sid = 'test-ext-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', {
      toolName: 'edit',
      toolArgs: { path: 'src/components/Button.ts' },
      timestamp: Date.now(),
    });

    const data = readSession(sid);
    assert.equal(data.ext_counts?.['.ts'], 1, 'ext_counts should have .ts: 1');
  });

  test('records ext_counts for create tool using file_path field', () => {
    const sid = 'test-ext-fp-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', {
      toolName: 'create',
      toolArgs: { file_path: 'lib/utils.js' },
      timestamp: Date.now(),
    });

    const data = readSession(sid);
    assert.equal(data.ext_counts?.['.js'], 1);
  });

  test('accumulates multiple extensions', () => {
    const sid = 'test-ext-multi-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', { toolName: 'edit', toolArgs: { path: 'a.ts' }, timestamp: Date.now() });
    runHook('pre-tool-use.js', { toolName: 'edit', toolArgs: { path: 'b.ts' }, timestamp: Date.now() });
    runHook('pre-tool-use.js', { toolName: 'edit', toolArgs: { path: 'c.js' }, timestamp: Date.now() });

    const data = readSession(sid);
    assert.equal(data.ext_counts?.['.ts'], 2);
    assert.equal(data.ext_counts?.['.js'], 1);
  });

  test('does NOT record ext_counts for view tool (read-only)', () => {
    const sid = 'test-view-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', {
      toolName: 'view',
      toolArgs: { path: 'README.md' },
      timestamp: Date.now(),
    });

    const data = readSession(sid);
    assert.equal(data.ext_counts, undefined, 'view should not track ext_counts');
    assert.equal(data.tool_counts?.view, 1, 'but view should be counted in tool_counts');
  });

  test('records subagents array for task tool', () => {
    const sid = 'test-subagent-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', {
      toolName: 'task',
      toolArgs: { description: 'Explore the codebase', agent_type: 'explore' },
      timestamp: Date.now(),
    });

    const data = readSession(sid);
    assert.ok(Array.isArray(data.subagents), 'subagents should be an array');
    assert.equal(data.subagents.length, 1);
    assert.equal(data.subagents[0].type, 'explore');
  });

  test('skips internal tools (report_intent should not appear in tool_counts)', () => {
    const sid = 'test-internal-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', {
      toolName: 'report_intent',
      toolArgs: { intent: 'Exploring codebase' },
      timestamp: Date.now(),
    });

    const data = readSession(sid);
    assert.equal(data.tool_counts, undefined);
  });

  test('skips update when session file does not exist (mustExist guard)', () => {
    const sid = 'test-no-file-' + Date.now();
    writeState(sid);
    // Intentionally do NOT call writeSession

    runHook('pre-tool-use.js', {
      toolName: 'bash',
      toolArgs: { command: 'ls' },
      timestamp: Date.now(),
    });

    const sessionPath = path.join(tmpDataDir, 'sessions', sid + '.json');
    assert.ok(!fs.existsSync(sessionPath), 'hook must not create missing session files');
  });

  test('skips update when sessionActive is false', () => {
    const sid = 'test-inactive-' + Date.now();
    writeState(sid, { sessionActive: false });
    writeSession(sid);

    runHook('pre-tool-use.js', {
      toolName: 'bash',
      toolArgs: { command: 'ls' },
      timestamp: Date.now(),
    });

    const data = readSession(sid);
    assert.equal(data.tool_counts, undefined, 'inactive session should not get telemetry');
  });
});

// ---------------------------------------------------------------------------
// Integration: user-prompt.js
// ---------------------------------------------------------------------------

describe('user-prompt.js telemetry', () => {
  test('increments turn_count on first prompt', () => {
    const sid = 'test-turn-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('user-prompt.js', { prompt: 'Hello world', timestamp: Date.now() });

    const data = readSession(sid);
    assert.equal(data.turn_count, 1);
    assert.ok(typeof data.last_prompt_at === 'number');
  });

  test('increments turn_count on each successive prompt', () => {
    const sid = 'test-turn-3-' + Date.now();
    writeState(sid);
    writeSession(sid);

    const ts = Date.now();
    runHook('user-prompt.js', { prompt: 'First',  timestamp: ts });
    runHook('user-prompt.js', { prompt: 'Second', timestamp: ts + 500 });
    runHook('user-prompt.js', { prompt: 'Third',  timestamp: ts + 1000 });

    const data = readSession(sid);
    assert.equal(data.turn_count, 3);
  });

  test('records turn_intervals starting from second prompt', () => {
    const sid = 'test-intervals-' + Date.now();
    writeState(sid);
    writeSession(sid);

    const t0 = Date.now();
    runHook('user-prompt.js', { prompt: 'Prompt 1', timestamp: t0 });
    // Simulate a real 50ms gap — prompt 2 fired 50+ms after prompt 1
    // We can't guarantee exact timing, but we just check array has one entry
    runHook('user-prompt.js', { prompt: 'Prompt 2', timestamp: t0 + 1000 });

    const data = readSession(sid);
    assert.ok(Array.isArray(data.turn_intervals), 'turn_intervals should be an array');
    assert.equal(data.turn_intervals.length, 1, 'one interval for two prompts');
    assert.ok(data.turn_intervals[0] > 0, 'interval must be positive');
  });

  test('does not add turn_interval for the very first prompt (no last_prompt_at)', () => {
    const sid = 'test-no-interval-first-' + Date.now();
    writeState(sid);
    writeSession(sid);  // no last_prompt_at in session

    runHook('user-prompt.js', { prompt: 'Only prompt', timestamp: Date.now() });

    const data = readSession(sid);
    assert.equal(data.turn_intervals, undefined);
    assert.equal(data.turn_count, 1);
  });
});

// ---------------------------------------------------------------------------
// Integration: session-end.js includes telemetry in JSONL record
// ---------------------------------------------------------------------------

describe('session-end.js telemetry', () => {
  test('JSONL record includes turn_count, tool_counts, ext_counts from session file', () => {
    const sid = 'test-end-telem-' + Date.now();
    const month = new Date().toISOString().slice(0, 7);

    writeSession(sid, {
      turn_count:  7,
      tool_counts: { bash: 5, edit: 2 },
      ext_counts:  { '.js': 3, '.ts': 1 },
    });

    runHook('session-end.js', { sessionId: sid, session_id: sid });

    const monthlyPath = path.join(tmpDataDir, 'monthly', month + '.jsonl');
    assert.ok(fs.existsSync(monthlyPath), 'monthly JSONL should exist');

    const lines  = fs.readFileSync(monthlyPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.id, sid);
    assert.equal(record.turn_count, 7);
    assert.deepEqual(record.tool_counts, { bash: 5, edit: 2 });
    assert.deepEqual(record.ext_counts, { '.js': 3, '.ts': 1 });
  });

  test('JSONL record includes git_branch when present', () => {
    const sid = 'test-end-branch-' + Date.now();
    const month = new Date().toISOString().slice(0, 7);

    writeSession(sid, { git_branch: 'feature/PLAT-123-my-feature' });

    runHook('session-end.js', { sessionId: sid });

    const monthlyPath = path.join(tmpDataDir, 'monthly', month + '.jsonl');
    const lines  = fs.readFileSync(monthlyPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.git_branch, 'feature/PLAT-123-my-feature');
  });

  test('JSONL record has no telemetry fields when session has none', () => {
    const sid = 'test-end-no-telem-' + Date.now();
    const month = new Date().toISOString().slice(0, 7);

    writeSession(sid);  // minimal session, no telemetry fields

    runHook('session-end.js', { sessionId: sid });

    const monthlyPath = path.join(tmpDataDir, 'monthly', month + '.jsonl');
    const lines  = fs.readFileSync(monthlyPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.turn_count, undefined);
    assert.equal(record.tool_counts, undefined);
    assert.equal(record.ext_counts, undefined);
    assert.equal(record.git_branch, undefined);
  });
});

// ---------------------------------------------------------------------------
// Integration: session-start.js writes git_branch
// ---------------------------------------------------------------------------

describe('session-start.js git_branch', () => {
  test('session file includes git_branch for a valid git repo', () => {
    const sid = 'test-start-branch-' + Date.now();

    // Use this project's own directory as the cwd — it's a git repo
    const gitCwd = path.join(__dirname, '..');
    runHook('session-start.js', {
      sessionId:   sid,
      session_id:  sid,
      model:       { id: 'claude-sonnet-4.6' },
      cwd:         gitCwd,
    });

    const sessionPath = path.join(tmpDataDir, 'sessions', sid + '.json');
    assert.ok(fs.existsSync(sessionPath));

    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    // git_branch should be a non-empty string (whatever branch is checked out)
    assert.ok(typeof data.git_branch === 'string' && data.git_branch.length > 0,
      `git_branch should be set, got: ${JSON.stringify(data.git_branch)}`);
  });

  test('session file has no git_branch for non-git dir', () => {
    const sid = 'test-start-no-branch-' + Date.now();

    runHook('session-start.js', {
      sessionId:  sid,
      session_id: sid,
      model:      { id: 'claude-sonnet-4.6' },
      cwd:        os.tmpdir(),
    });

    const sessionPath = path.join(tmpDataDir, 'sessions', sid + '.json');
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    assert.equal(data.git_branch, undefined);
  });
});
