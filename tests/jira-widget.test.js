'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { jira_ticket } = require('../scripts/widgets/jira');
const { render }      = require('../scripts/compositor');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-jira-widget-'));
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'monthly'),  { recursive: true });
  return dir;
}

// Write a minimal session file. Uses Copilot field names for snapshot tokens.
function writeSession(dataDir, sessionId, overrides = {}) {
  const session = Object.assign({
    session_id:  sessionId,
    started_at:  new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    start_month: new Date().toISOString().slice(0, 7),
    model_id:    '',
    snapshot: {
      total_input_tokens:       0,
      total_output_tokens:      0,
      total_cache_write_tokens: 0,
      total_cache_read_tokens:  0,
    },
  }, overrides);
  fs.writeFileSync(
    path.join(dataDir, 'sessions', sessionId + '.json'),
    JSON.stringify(session, null, 2)
  );
}

// Build a minimal statusLine stdin payload with Copilot field names.
function makeStdin(sessionId, cwd, overrides = {}) {
  return Object.assign({
    session_id:     sessionId,
    model:          { id: 'claude-sonnet-4.6', display_name: 'Sonnet 4.6' },
    context_window: {
      used_percentage:          0,
      total_input_tokens:       0,
      total_output_tokens:      0,
      total_cache_write_tokens: 0,
      total_cache_read_tokens:  0,
    },
    cwd,
  }, overrides);
}

// ---------------------------------------------------------------------------
// Direct widget tests
// ---------------------------------------------------------------------------

describe('jira_ticket widget (direct)', () => {
  test('returns null when no jira key is present', () => {
    const out = jira_ticket({}, { lastKnownJiraKey: '', jiraKey: '' }, {});
    assert.equal(out, null);
  });

  test('renders jira key', () => {
    const out = jira_ticket({}, { lastKnownJiraKey: 'PLAT-101', lastKnownJiraSource: 'branch' }, {});
    assert.ok(out, 'expected non-null output');
    assert.ok(out.includes('PLAT-101'), `expected PLAT-101 in: ${out}`);
  });

  test('renders source icon when show_source=true', () => {
    const out = jira_ticket({}, { lastKnownJiraKey: 'PLAT-101', lastKnownJiraSource: 'branch' }, { show_source: true });
    assert.ok(out.includes('⎇'), `expected branch icon in: ${out}`);
  });

  test('renders label when show_label=true', () => {
    const out = jira_ticket({}, { lastKnownJiraKey: 'PLAT-101' }, { show_label: true });
    assert.ok(out.includes('Jira:'), `expected Jira: label in: ${out}`);
  });

  test('omits OSC 8 link when link=false', () => {
    const ESC = '\x1b';
    const out = jira_ticket({}, { lastKnownJiraKey: 'PLAT-101' }, { link: false });
    assert.ok(!out.includes(`${ESC}]8;`), 'expected no OSC 8 escape in output');
    assert.ok(out.includes('PLAT-101'));
  });

  test('includes OSC 8 link by default', () => {
    const ESC = '\x1b';
    const out = jira_ticket({}, { lastKnownJiraKey: 'PLAT-101' }, {});
    assert.ok(out.includes(`${ESC}]8;`), 'expected OSC 8 escape in output');
  });

  test('uses custom base_url when provided', () => {
    const ESC = '\x1b';
    const out = jira_ticket(
      {},
      { lastKnownJiraKey: 'ENG-42' },
      { base_url: 'https://mycompany.atlassian.net/browse' }
    );
    assert.ok(out.includes('mycompany.atlassian.net'), `expected custom URL in: ${out}`);
  });
});

// ---------------------------------------------------------------------------
// Compositor integration tests
// ---------------------------------------------------------------------------

describe('jira_ticket widget (compositor integration)', () => {
  let dataDir;
  after(() => { try { fs.rmSync(dataDir, { recursive: true }); } catch (_) {} });

  test('reads jira key from session file via sessionData', () => {
    dataDir = tmpDataDir();
    const sessionId = 'jira-widget-session';
    writeSession(dataDir, sessionId, {
      last_known_jira_key:    'PLAT-4821',
      last_known_jira_source: 'branch',
    });

    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
      powerline: false,
      segments: [{ widget: 'jira_ticket', link: false }],
    }));

    const out = render(
      makeStdin(sessionId, dataDir),
      dataDir,
      path.join(__dirname, '../scripts')
    );

    assert.ok(out.includes('PLAT-4821'), `expected PLAT-4821 in output: "${out}"`);
  });

  test('returns empty string when no jira key in session or branch', () => {
    dataDir = tmpDataDir();
    const sessionId = 'no-jira-session';
    writeSession(dataDir, sessionId);

    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
      powerline: false,
      segments: [{ widget: 'jira_ticket' }],
    }));

    // cwd points to a non-git dir (tmpDataDir itself) so detectJiraKey returns null
    const out = render(
      makeStdin(sessionId, dataDir),
      dataDir,
      path.join(__dirname, '../scripts')
    );

    assert.equal(out.trim(), '', `expected empty output, got: "${out}"`);
  });
});
