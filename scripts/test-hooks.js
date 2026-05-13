#!/usr/bin/env node
'use strict';
// test-hooks.js — smoke-test harness for copilot-hud hook scripts and statusline.
//
// Usage:
//   node scripts/test-hooks.js
//
// Runs 6 end-to-end tests in a temporary COPILOT_HOME directory so the real
// ~/.copilot/copilot-hud data is never touched. Each test pipes a fixture
// payload into the target script and verifies the expected side-effects.

const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const { spawnSync } = require('child_process');

const SCRIPTS_DIR = __dirname;
const TEST_HOME   = path.join(os.tmpdir(), 'copilot-hud-test-' + process.pid);
const TEST_DATA   = path.join(TEST_HOME, 'copilot-hud');
const STATE_FILE  = path.join(TEST_HOME, 'hud-state.json');
const SESSION_ID  = 'test-session-001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scriptPath(name) {
  return path.join(SCRIPTS_DIR, name);
}

function runScript(name, payload) {
  return spawnSync(process.execPath, [scriptPath(name)], {
    input:    JSON.stringify(payload),
    encoding: 'utf8',
    env:      { ...process.env, COPILOT_HOME: TEST_HOME },
    timeout:  5000,
  });
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function readLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim().split('\n')
      .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) { return []; }
}

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixture payloads
// ---------------------------------------------------------------------------

const TS_BASE = 1747000000000;

const SESSION_START_PAYLOAD = {
  sessionId: SESSION_ID,
  model:     { id: 'claude-sonnet-4.6', display_name: 'Claude Sonnet 4.6' },
  cwd:       '/Users/test/projects/my-app',
  timestamp: TS_BASE,
};

const PRE_TOOL_PAYLOAD = {
  toolName:  'bash',
  toolArgs:  { command: 'ls -la' },
  timestamp: TS_BASE + 1000,
};

const POST_TOOL_PAYLOAD = {
  toolName:   'bash',
  toolResult: { resultType: 'success' },
  timestamp:  TS_BASE + 2000,
};

const USER_PROMPT_PAYLOAD = {
  prompt:    'How do I write a test?',
  timestamp: TS_BASE + 3000,
};

const STATUSLINE_PAYLOAD = {
  session_id:   SESSION_ID,
  session_name: 'test-session',
  cwd:          '/Users/test/projects/my-app',
  model: {
    id:           'claude-sonnet-4.6',
    display_name: 'Claude Sonnet 4.6',
  },
  context_window: {
    context_window_size:      200000,
    used_percentage:          35,
    remaining_tokens:         130000,
    total_input_tokens:       24100,
    total_output_tokens:      8420,
    total_cache_read_tokens:  5200,
    total_cache_write_tokens: 1100,
    last_call_input_tokens:   3200,
    last_call_output_tokens:  820,
  },
  cost: {
    total_api_duration_ms: 45000,
    total_duration_ms:     300000,
    total_premium_requests: 3,
    total_lines_added:     42,
    total_lines_removed:   5,
  },
};

const SESSION_END_PAYLOAD = {
  sessionId: SESSION_ID,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

console.log('copilot-hud test harness\n');
console.log(`Test home: ${TEST_HOME}\n`);

// Clean slate
try { fs.rmSync(TEST_HOME, { recursive: true, force: true }); } catch (_) {}
fs.mkdirSync(path.join(TEST_DATA, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(TEST_DATA, 'monthly'),  { recursive: true });

// ---------------------------------------------------------------------------
// Test 1 — sessionStart: creates session file with zero-baseline snapshot
// ---------------------------------------------------------------------------

console.log('Test 1: sessionStart');
{
  const result = runScript('session-start.js', SESSION_START_PAYLOAD);
  check('exits with code 0', result.status === 0, `exit ${result.status}`);

  const sessionFile = path.join(TEST_DATA, 'sessions', SESSION_ID + '.json');
  const session = readJson(sessionFile);
  check('session file created', !!session, 'file missing');
  check('session_id matches', session && session.session_id === SESSION_ID);
  check('snapshot is zero baseline',
    session && session.snapshot &&
    session.snapshot.total_input_tokens  === 0 &&
    session.snapshot.total_output_tokens === 0
  );
  check('model_id captured', session && session.model_id === 'claude-sonnet-4.6');
  check('project extracted', session && session.project === 'my-app');
}

// ---------------------------------------------------------------------------
// Test 2 — preToolUse: records running tool in state file
// ---------------------------------------------------------------------------

console.log('\nTest 2: preToolUse (bash)');
{
  const result = runScript('pre-tool-use.js', PRE_TOOL_PAYLOAD);
  check('exits with code 0', result.status === 0, `exit ${result.status}`);

  const state = readJson(STATE_FILE);
  check('state file created', !!state, 'file missing');
  const tool = state && state.recentTools && state.recentTools[0];
  check('tool entry present', !!tool, JSON.stringify(state && state.recentTools));
  check('tool name is bash', tool && tool.name === 'bash');
  check('tool status is running', tool && tool.status === 'running');
}

// ---------------------------------------------------------------------------
// Test 3 — postToolUse: marks bash tool as success
// ---------------------------------------------------------------------------

console.log('\nTest 3: postToolUse (bash success)');
{
  const result = runScript('post-tool-use.js', POST_TOOL_PAYLOAD);
  check('exits with code 0', result.status === 0, `exit ${result.status}`);

  const state = readJson(STATE_FILE);
  const tool = state && state.recentTools &&
    state.recentTools.find(t => t.name === 'bash');
  check('bash tool present', !!tool);
  check('tool status is success', tool && tool.status === 'success');
}

// ---------------------------------------------------------------------------
// Test 4 — userPromptSubmitted: captures last prompt
// ---------------------------------------------------------------------------

console.log('\nTest 4: userPromptSubmitted');
{
  const result = runScript('user-prompt.js', USER_PROMPT_PAYLOAD);
  check('exits with code 0', result.status === 0, `exit ${result.status}`);

  const state = readJson(STATE_FILE);
  check('lastPrompt captured',
    state && state.lastPrompt === 'How do I write a test?',
    state && state.lastPrompt
  );
}

// ---------------------------------------------------------------------------
// Test 5 — statusline: renders non-empty output with no error marker
// ---------------------------------------------------------------------------

console.log('\nTest 5: statusline');
{
  const result = runScript('statusline.js', STATUSLINE_PAYLOAD);
  check('exits with code 0', result.status === 0, `exit ${result.status}`);

  const out = (result.stdout || '').trim();
  check('produces output', out.length > 0, '(empty)');
  check('no error marker', !out.includes('[copilot-hud error]'), out.slice(0, 80));

  // Verify session file was updated with last_known_tokens by compositor
  const sessionFile = path.join(TEST_DATA, 'sessions', SESSION_ID + '.json');
  const session = readJson(sessionFile);
  check('compositor wrote last_known_tokens',
    session && session.last_known_tokens &&
    session.last_known_tokens.total_input_tokens === 24100
  );
}

// ---------------------------------------------------------------------------
// Test 6 — sessionEnd: writes JSONL record and removes session file
// ---------------------------------------------------------------------------

console.log('\nTest 6: sessionEnd');
{
  const result = runScript('session-end.js', SESSION_END_PAYLOAD);
  check('exits with code 0', result.status === 0, `exit ${result.status}`);

  const sessionFile = path.join(TEST_DATA, 'sessions', SESSION_ID + '.json');
  check('session file removed', !fs.existsSync(sessionFile));

  const monthKey    = new Date().toISOString().slice(0, 7);
  const monthlyFile = path.join(TEST_DATA, 'monthly', monthKey + '.jsonl');
  const records     = readLines(monthlyFile);
  const rec         = records.find(r => r && r.id === SESSION_ID);
  check('JSONL record written', !!rec, `records: ${JSON.stringify(records)}`);
  check('cost_pending is false', rec && rec.cost_pending === false);
  check('cost_usd is computed', rec && typeof rec.cost_usd === 'number' && rec.cost_usd > 0,
    `cost_usd=${rec && rec.cost_usd}`);
  check('final_tokens preserved',
    rec && rec.final_tokens && rec.final_tokens.total_input_tokens === 24100
  );
}

// ---------------------------------------------------------------------------
// Cleanup and summary
// ---------------------------------------------------------------------------

try { fs.rmSync(TEST_HOME, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${'─'.repeat(40)}`);
const total = passed + failed;
console.log(`${passed}/${total} tests passed${failed > 0 ? ` (${failed} failed)` : ''}`);
process.exit(failed > 0 ? 1 : 0);
