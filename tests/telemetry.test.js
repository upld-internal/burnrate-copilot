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

  test('computes prompt_count and prompt_length stats from prompt_lengths array', () => {
    const f = buildTelemetryFields({ prompt_lengths: [100, 500, 200] });
    assert.equal(f.prompt_count, 3);
    assert.equal(f.prompt_length_p50_bytes, 200);
    assert.equal(f.prompt_length_max_bytes, 500);
  });

  test('omits prompt stats when prompt_lengths is absent', () => {
    const f = buildTelemetryFields({});
    assert.equal(f.prompt_count, undefined);
    assert.equal(f.prompt_length_p50_bytes, undefined);
  });

  test('includes web_search_requests when > 0', () => {
    const f = buildTelemetryFields({ web_search_requests: 3 });
    assert.equal(f.web_search_requests, 3);
  });

  test('omits web_search_requests when 0', () => {
    const f = buildTelemetryFields({ web_search_requests: 0 });
    assert.equal(f.web_search_requests, undefined);
  });

  test('includes web_fetch_requests when > 0', () => {
    const f = buildTelemetryFields({ web_fetch_requests: 5 });
    assert.equal(f.web_fetch_requests, 5);
  });

  test('computes tool_duration_p50_ms and tool_duration_max_ms from tool_durations_ms', () => {
    const f = buildTelemetryFields({ tool_durations_ms: [50, 200, 100, 400, 150] });
    assert.equal(f.tool_duration_p50_ms, 150);
    assert.equal(f.tool_duration_max_ms, 400);
  });

  test('omits tool duration stats when tool_durations_ms is absent', () => {
    const f = buildTelemetryFields({});
    assert.equal(f.tool_duration_p50_ms, undefined);
  });

  test('includes turn_tokens when array is non-empty', () => {
    const turns = [
      { turn: 1, input: 1000, output: 300, cache_write: 0, cache_read: 0 },
      { turn: 2, input: 2500, output: 450, cache_write: 100, cache_read: 800 },
    ];
    const f = buildTelemetryFields({ turn_tokens: turns });
    assert.deepEqual(f.turn_tokens, turns);
  });

  test('omits turn_tokens when absent', () => {
    const f = buildTelemetryFields({});
    assert.equal(f.turn_tokens, undefined);
  });

  test('omits turn_tokens when array is empty', () => {
    const f = buildTelemetryFields({ turn_tokens: [] });
    assert.equal(f.turn_tokens, undefined);
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

  test('increments web_search_requests for web_search tool', () => {
    const sid = 'test-websearch-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', { toolName: 'web_search', toolArgs: { query: 'node.js docs' }, timestamp: Date.now() });
    runHook('pre-tool-use.js', { toolName: 'web_search', toolArgs: { query: 'typescript' },   timestamp: Date.now() });

    const data = readSession(sid);
    assert.equal(data.web_search_requests, 2, 'should count 2 web_search calls');
  });

  test('increments web_fetch_requests for web_fetch tool', () => {
    const sid = 'test-webfetch-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('pre-tool-use.js', { toolName: 'web_fetch', toolArgs: { url: 'https://example.com' }, timestamp: Date.now() });

    const data = readSession(sid);
    assert.equal(data.web_fetch_requests, 1, 'should count 1 web_fetch call');
  });

  test('records tool_start_times queue for duration tracking', () => {
    const sid = 'test-start-times-' + Date.now();
    writeState(sid);
    writeSession(sid);

    const ts = Date.now();
    runHook('pre-tool-use.js', { toolName: 'bash', toolArgs: { command: 'ls' }, timestamp: ts });

    const data = readSession(sid);
    assert.ok(Array.isArray(data.tool_start_times?.bash), 'tool_start_times.bash should be an array');
    assert.equal(data.tool_start_times.bash.length, 1, 'should have one start time queued');
  });
});

// ---------------------------------------------------------------------------
// Integration: post-tool-use.js tool duration
// ---------------------------------------------------------------------------

describe('post-tool-use.js tool duration', () => {
  test('accumulates tool_durations_ms when pre+post fire for same tool', () => {
    const sid = 'test-duration-' + Date.now();
    writeState(sid);
    writeSession(sid);

    const start = Date.now();
    runHook('pre-tool-use.js',  { toolName: 'bash', toolArgs: { command: 'ls' }, timestamp: start });
    runHook('post-tool-use.js', { toolName: 'bash', toolResult: { resultType: 'success' }, timestamp: start + 150 });

    const data = readSession(sid);
    assert.ok(Array.isArray(data.tool_durations_ms), 'tool_durations_ms should be an array');
    assert.equal(data.tool_durations_ms.length, 1, 'one duration recorded');
    assert.ok(data.tool_durations_ms[0] > 0, 'duration should be positive');
  });

  test('clears start time from queue after matching post fires', () => {
    const sid = 'test-duration-clear-' + Date.now();
    writeState(sid);
    writeSession(sid);

    const start = Date.now();
    runHook('pre-tool-use.js',  { toolName: 'bash', toolArgs: { command: 'pwd' }, timestamp: start });
    runHook('post-tool-use.js', { toolName: 'bash', toolResult: { resultType: 'success' }, timestamp: start + 200 });

    const data = readSession(sid);
    assert.equal(data.tool_start_times?.bash?.length ?? 0, 0, 'start time queue should be empty after post fires');
  });

  test('handles two sequential same-tool calls correctly (FIFO)', () => {
    const sid = 'test-fifo-' + Date.now();
    writeState(sid);
    writeSession(sid);

    const t0 = Date.now();
    runHook('pre-tool-use.js',  { toolName: 'bash', toolArgs: { command: 'ls' }, timestamp: t0 });
    runHook('pre-tool-use.js',  { toolName: 'bash', toolArgs: { command: 'pwd' }, timestamp: t0 + 100 });
    runHook('post-tool-use.js', { toolName: 'bash', toolResult: { resultType: 'success' }, timestamp: t0 + 250 });
    runHook('post-tool-use.js', { toolName: 'bash', toolResult: { resultType: 'success' }, timestamp: t0 + 500 });

    const data = readSession(sid);
    assert.equal(data.tool_durations_ms?.length, 2, 'should have 2 duration entries for 2 calls');
  });
});



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

  test('records prompt_lengths array', () => {
    const sid = 'test-prompt-len-' + Date.now();
    writeState(sid);
    writeSession(sid);

    runHook('user-prompt.js', { prompt: 'Short',                        timestamp: Date.now() });
    runHook('user-prompt.js', { prompt: 'A longer prompt message here', timestamp: Date.now() });

    const data = readSession(sid);
    assert.ok(Array.isArray(data.prompt_lengths), 'prompt_lengths should be an array');
    assert.equal(data.prompt_lengths.length, 2);
    assert.equal(data.prompt_lengths[0], 'Short'.length);
    assert.equal(data.prompt_lengths[1], 'A longer prompt message here'.length);
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

// ---------------------------------------------------------------------------
// Unit tests: compositor turn_tokens accumulation
// ---------------------------------------------------------------------------

describe('compositor turn_tokens accumulation', () => {
  const { loadSessionData } = require('../scripts/compositor');

  // Build a minimal stdinData payload for the compositor
  function makeStdin(sessionId, totalInput, totalOutput, cacheWrite = 0, cacheRead = 0) {
    return {
      session_id: sessionId,
      model: { id: 'claude-sonnet-4.6', display_name: 'Claude Sonnet' },
      context_window: {
        context_window_size: 200000,
        used_percentage: 10,
        remaining_tokens: 180000,
        total_input_tokens:       totalInput,
        total_output_tokens:      totalOutput,
        total_cache_write_tokens: cacheWrite,
        total_cache_read_tokens:  cacheRead,
      },
      cost: { total_api_duration_ms: 5000, total_duration_ms: 10000, total_premium_requests: 0 },
      cwd: os.tmpdir(),
    };
  }

  test('creates first turn_tokens entry on first compositor fire with tokens', () => {
    const sid = 'test-turnk-first-' + Date.now();
    // Seed session file with snapshot baseline of 0
    writeSession(sid, { turn_count: 1, snapshot: { total_input_tokens: 0, total_output_tokens: 0, total_cache_write_tokens: 0, total_cache_read_tokens: 0 } });

    loadSessionData(makeStdin(sid, 1000, 300), tmpDataDir, path.join(__dirname, '..'));

    const data = readSession(sid);
    assert.ok(Array.isArray(data.turn_tokens), 'turn_tokens should be an array');
    assert.equal(data.turn_tokens.length, 1, 'one entry for the first fire');
    assert.equal(data.turn_tokens[0].turn, 1);
    assert.equal(data.turn_tokens[0].input, 1000);
    assert.equal(data.turn_tokens[0].output, 300);
  });

  test('accumulates into same entry on second fire for same turn', () => {
    const sid = 'test-turnk-accum-' + Date.now();
    writeSession(sid, { turn_count: 1, snapshot: { total_input_tokens: 0, total_output_tokens: 0, total_cache_write_tokens: 0, total_cache_read_tokens: 0 } });

    // First fire: 1000/300 tokens
    loadSessionData(makeStdin(sid, 1000, 300), tmpDataDir, path.join(__dirname, '..'));
    // Second fire for same turn_count=1: 200 more input, 50 more output
    loadSessionData(makeStdin(sid, 1200, 350), tmpDataDir, path.join(__dirname, '..'));

    const data = readSession(sid);
    assert.equal(data.turn_tokens.length, 1, 'still one entry — same turn');
    assert.equal(data.turn_tokens[0].input, 1200, 'accumulated input');
    assert.equal(data.turn_tokens[0].output, 350, 'accumulated output');
  });

  test('creates a new entry when turn_count advances', () => {
    const sid = 'test-turnk-new-' + Date.now();
    writeSession(sid, { turn_count: 1, snapshot: { total_input_tokens: 0, total_output_tokens: 0, total_cache_write_tokens: 0, total_cache_read_tokens: 0 } });

    // Turn 1 fire
    loadSessionData(makeStdin(sid, 1000, 300), tmpDataDir, path.join(__dirname, '..'));

    // Advance turn_count to 2 (simulate user-prompt.js firing)
    const sessionPath = path.join(tmpDataDir, 'sessions', sid + '.json');
    const s = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    s.turn_count = 2;
    fs.writeFileSync(sessionPath, JSON.stringify(s, null, 2));

    // Turn 2 fire: 500 more input, 100 more output
    loadSessionData(makeStdin(sid, 1500, 400), tmpDataDir, path.join(__dirname, '..'));

    const data = readSession(sid);
    assert.equal(data.turn_tokens.length, 2, 'two entries for two turns');
    assert.equal(data.turn_tokens[0].turn, 1);
    assert.equal(data.turn_tokens[1].turn, 2);
    assert.equal(data.turn_tokens[1].input, 500, 'delta for turn 2');
    assert.equal(data.turn_tokens[1].output, 100, 'delta for turn 2');
  });

  test('does not append entry when delta is zero', () => {
    const sid = 'test-turnk-zero-' + Date.now();
    writeSession(sid, { turn_count: 1, snapshot: { total_input_tokens: 500, total_output_tokens: 100, total_cache_write_tokens: 0, total_cache_read_tokens: 0 } });

    // Cumulative totals match snapshot exactly → delta is 0 → no entry
    loadSessionData(makeStdin(sid, 500, 100), tmpDataDir, path.join(__dirname, '..'));

    const data = readSession(sid);
    assert.equal(data.turn_tokens, undefined, 'no entry when delta is zero');
  });
});

// ---------------------------------------------------------------------------
// Integration: session-end.js includes turn_tokens in JSONL record
// ---------------------------------------------------------------------------

describe('session-end.js turn_tokens', () => {
  test('JSONL record includes turn_tokens when session has them', () => {
    const sid = 'test-end-turntok-' + Date.now();
    const month = new Date().toISOString().slice(0, 7);

    const turns = [
      { turn: 1, input: 1000, output: 300, cache_write: 0, cache_read: 0 },
      { turn: 2, input: 2500, output: 450, cache_write: 100, cache_read: 800 },
    ];
    writeSession(sid, { turn_tokens: turns });

    runHook('session-end.js', { sessionId: sid, session_id: sid });

    const monthlyPath = path.join(tmpDataDir, 'monthly', month + '.jsonl');
    const lines  = fs.readFileSync(monthlyPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.ok(Array.isArray(record.turn_tokens), 'turn_tokens should be in JSONL');
    assert.equal(record.turn_tokens.length, 2);
    assert.deepEqual(record.turn_tokens[0], turns[0]);
    assert.deepEqual(record.turn_tokens[1], turns[1]);
  });

  test('JSONL record has no turn_tokens when session has none', () => {
    const sid = 'test-end-no-turntok-' + Date.now();
    const month = new Date().toISOString().slice(0, 7);

    writeSession(sid);  // no turn_tokens

    runHook('session-end.js', { sessionId: sid, session_id: sid });

    const monthlyPath = path.join(tmpDataDir, 'monthly', month + '.jsonl');
    const lines  = fs.readFileSync(monthlyPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.equal(record.turn_tokens, undefined);
  });
});
