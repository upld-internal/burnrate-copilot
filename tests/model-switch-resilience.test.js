'use strict';
// tests/model-switch-resilience.test.js
//
// Regression tests for the model-switch bug where Copilot fires a new
// SessionStart when the user changes models mid-session, causing the old
// session file to be archived and deleted by recoverOrphanedSessions().
// The statusline then receives the original session_id but finds no file,
// making all second-line widgets return null (blank footer line).
//
// Fix 1 (compositor.js): lazy session file recreation — if a session_id
//   arrives with no matching file, create a minimal recovery file on the spot
//   so duration/model widgets keep rendering.
//
// Fix 2 (session-start.js): conservative orphan window — use last_known_at
//   (written by compositor every turn, so always recent for live sessions)
//   with a 10-minute guard rather than the old combined last_known_at||started_at
//   with a 2-minute guard that could delete active long-running sessions.

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { spawnSync } = require('child_process');

const { render }      = require('../scripts/compositor');
const { loadConfig, mergeConfig, DEFAULT_CONFIG } = require('../scripts/compositor');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpHome;
let tmpDataDir;

before(() => {
  tmpHome    = fs.mkdtempSync(path.join(os.tmpdir(), 'burnrate-switch-test-'));
  tmpDataDir = path.join(tmpHome, 'burnrate-copilot');
  fs.mkdirSync(path.join(tmpDataDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(tmpDataDir, 'monthly'),  { recursive: true });
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function runHook(scriptName, payload) {
  const scriptPath = path.join(__dirname, '..', 'scripts', scriptName);
  return spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    env: { ...process.env, COPILOT_HOME: tmpHome },
    cwd: path.join(__dirname, '..'),
    timeout: 5000,
  });
}

function sessionPath(sessionId) {
  return path.join(tmpDataDir, 'sessions', sessionId + '.json');
}

function writeSession(sessionId, overrides = {}) {
  fs.writeFileSync(sessionPath(sessionId), JSON.stringify({
    session_id:  sessionId,
    started_at:  new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    start_month: new Date().toISOString().slice(0, 7),
    model_id:    'claude-opus-4.6',
    snapshot:    { total_input_tokens: 0, total_output_tokens: 0,
                   total_cache_write_tokens: 0, total_cache_read_tokens: 0 },
    ...overrides,
  }, null, 2));
}

// Build a minimal statusLine stdin payload.
function makeStdin(sessionId, overrides = {}) {
  return {
    session_id:     sessionId,
    model:          { id: 'claude-sonnet-4.6', display_name: 'Sonnet 4.6' },
    context_window: {
      used_percentage: 0,
      total_input_tokens: 100, total_output_tokens: 50,
      total_cache_write_tokens: 0, total_cache_read_tokens: 0,
    },
    cwd: tmpDataDir,
    ...overrides,
  };
}

// Use a minimal single-widget config so render() output is predictable.
function writeConfig(segments) {
  fs.writeFileSync(
    path.join(tmpDataDir, 'config.json'),
    JSON.stringify({ powerline: false, segments })
  );
}

// ---------------------------------------------------------------------------
// Fix 1: compositor lazy session file recreation
// ---------------------------------------------------------------------------

describe('compositor lazy session file recreation (Fix 1)', () => {
  test('renders session_duration when session file is missing', () => {
    // Simulate the post-model-switch state: statusline receives session_id
    // but the file was archived by recoverOrphanedSessions.
    const sid = 'missing-file-' + Date.now();
    // Deliberately do NOT create the session file.
    writeConfig([{ widget: 'session_duration' }]);

    const out = render(makeStdin(sid), tmpDataDir, path.join(__dirname, '../scripts'));

    // session_duration requires startedAt from the session file.
    // With lazy recreation the widget should now return a value.
    assert.ok(out.length > 0, `expected non-empty output, got: "${out}"`);
    assert.ok(/\d+m/.test(out), `expected duration like "0m" in output, got: "${out}"`);
  });

  test('creates session file on disk when file is missing', () => {
    const sid = 'lazy-create-' + Date.now();
    writeConfig([{ widget: 'model_name' }]);

    render(makeStdin(sid), tmpDataDir, path.join(__dirname, '../scripts'));

    assert.ok(fs.existsSync(sessionPath(sid)), 'compositor should have created the session file');
    const data = JSON.parse(fs.readFileSync(sessionPath(sid), 'utf8'));
    assert.equal(data.session_id, sid);
    assert.ok(data.snapshot, 'recovered file should have a snapshot');
    assert.equal(data.recovered_by_compositor, true, 'recovered file should be marked');
  });

  test('uses stdin token counts as baseline snapshot in recreated file', () => {
    const sid = 'lazy-snapshot-' + Date.now();
    writeConfig([{ widget: 'model_name' }]);

    render(makeStdin(sid, {
      context_window: {
        total_input_tokens: 500, total_output_tokens: 200,
        total_cache_write_tokens: 10, total_cache_read_tokens: 5,
      },
    }), tmpDataDir, path.join(__dirname, '../scripts'));

    const data = JSON.parse(fs.readFileSync(sessionPath(sid), 'utf8'));
    assert.equal(data.snapshot.total_input_tokens, 500);
    assert.equal(data.snapshot.total_output_tokens, 200);
  });

  test('does not overwrite an existing session file', () => {
    const sid = 'no-overwrite-' + Date.now();
    const startedAt = '2026-01-01T10:00:00Z';
    writeSession(sid, { started_at: startedAt, model_id: 'claude-opus-4.6' });
    writeConfig([{ widget: 'session_duration' }]);

    render(makeStdin(sid), tmpDataDir, path.join(__dirname, '../scripts'));

    const data = JSON.parse(fs.readFileSync(sessionPath(sid), 'utf8'));
    assert.equal(data.started_at, startedAt, 'existing started_at should be preserved');
    assert.equal(data.model_id, 'claude-opus-4.6', 'existing model_id should be preserved');
    assert.equal(data.recovered_by_compositor, undefined, 'should not be marked as recovered');
  });
});

// ---------------------------------------------------------------------------
// Fix 2: orphan recovery — last_known_at guard
// ---------------------------------------------------------------------------

describe('recoverOrphanedSessions last_known_at guard (Fix 2)', () => {
  test('does not archive a session with recent last_known_at (< 10 min)', () => {
    const oldSid  = 'old-active-' + Date.now();
    const newSid  = 'new-trigger-' + Date.now();

    // Write a session that looks old by started_at but has recent compositor activity.
    writeSession(oldSid, {
      started_at:    new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3h ago
      last_known_at: new Date(Date.now() - 30 * 1000).toISOString(),           // 30s ago
    });

    // Trigger a new SessionStart — this runs recoverOrphanedSessions.
    runHook('session-start.js', {
      sessionId: newSid,
      session_id: newSid,
      model: { id: 'claude-sonnet-4.6' },
      cwd: os.tmpdir(),
    });

    assert.ok(
      fs.existsSync(sessionPath(oldSid)),
      'active session (recent last_known_at) should NOT be archived'
    );
  });

  test('archives a session with stale last_known_at (> 10 min)', () => {
    const oldSid  = 'old-stale-' + Date.now();
    const newSid  = 'new-trigger-stale-' + Date.now();
    const month   = new Date().toISOString().slice(0, 7);

    writeSession(oldSid, {
      started_at:    new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
      last_known_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 min ago
    });

    runHook('session-start.js', {
      sessionId: newSid,
      session_id: newSid,
      model: { id: 'claude-sonnet-4.6' },
      cwd: os.tmpdir(),
    });

    assert.ok(
      !fs.existsSync(sessionPath(oldSid)),
      'stale session (last_known_at > 10 min) should be archived and deleted'
    );

    const monthlyFile = path.join(tmpDataDir, 'monthly', month + '.jsonl');
    const lines = fs.readFileSync(monthlyFile, 'utf8').trim().split('\n');
    const record = lines.map(l => JSON.parse(l)).find(r => r.id === oldSid);
    assert.ok(record, 'stale session should appear in monthly JSONL as recovered');
    assert.equal(record.recovered, true);
  });

  test('does not archive a session with no last_known_at but recent started_at (< 2 min)', () => {
    const oldSid = 'brand-new-' + Date.now();
    const newSid = 'new-trigger-brand-' + Date.now();

    // Very new session — compositor hasn't written last_known_at yet.
    writeSession(oldSid, {
      started_at:    new Date(Date.now() - 30 * 1000).toISOString(), // 30s ago
      last_known_at: undefined,
    });
    // Remove last_known_at if present (writeSession may inject it).
    const raw = JSON.parse(fs.readFileSync(sessionPath(oldSid), 'utf8'));
    delete raw.last_known_at;
    fs.writeFileSync(sessionPath(oldSid), JSON.stringify(raw, null, 2));

    runHook('session-start.js', {
      sessionId: newSid,
      session_id: newSid,
      model: { id: 'claude-sonnet-4.6' },
      cwd: os.tmpdir(),
    });

    assert.ok(
      fs.existsSync(sessionPath(oldSid)),
      'brand-new session (no last_known_at, recent started_at) should NOT be archived'
    );
  });
});
