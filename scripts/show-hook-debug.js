#!/usr/bin/env node
'use strict';
// show-hook-debug.js — CLI viewer for ~/.copilot/burnrate-copilot/debug/hooks.jsonl
//
// Pretty-prints hook debug entries grouped by hook type, newest first.
// Useful for validating that field names and payload shapes match expectations.
//
// Usage:
//   node scripts/show-hook-debug.js [options]
//
// Options:
//   --hook <type>     Filter to a single hook type (e.g. sessionStart, preToolUse)
//   --session <id>    Filter to a specific session ID (prefix match)
//   --limit <n>       Show at most N entries per hook type (default: 5)
//   --raw             Dump raw JSON lines without formatting
//   --clear           Delete the hooks.jsonl file and exit
//   --fields          Show only stdin_fields (quick field-name audit)
//   --help            Show this help

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getDataDir() {
  const envHome = (process.env.COPILOT_HOME || '').trim();
  const copilotDir = envHome || path.join(os.homedir(), '.copilot');
  return path.join(copilotDir, 'burnrate-copilot');
}

const dataDir   = getDataDir();
const debugFile = path.join(dataDir, 'debug', 'hooks.jsonl');

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const BLUE   = '\x1b[34m';

const HOOK_COLORS = {
  sessionStart:        GREEN,
  sessionEnd:          RED,
  preToolUse:          CYAN,
  postToolUse:         BLUE,
  userPromptSubmitted: YELLOW,
};

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${BOLD}show-hook-debug.js${RESET} — viewer for copilot-hud hook debug log

${BOLD}Usage:${RESET}
  node scripts/show-hook-debug.js [options]

${BOLD}Options:${RESET}
  --hook <type>     Filter to a single hook type (sessionStart | sessionEnd |
                    preToolUse | postToolUse | userPromptSubmitted)
  --session <id>    Filter to a specific session ID (prefix match)
  --limit <n>       Max entries per hook type (default: 5)
  --raw             Dump raw JSON lines
  --clear           Delete hooks.jsonl and exit
  --fields          Show only the stdin_fields list (quick field-name audit)
  --help            Show this help

${BOLD}Enable debug capture:${RESET}
  Set COPILOT_HUD_DEBUG=1 in your shell or in hooks.json env config.
  Debug log: ${debugFile}
`.trim());
  process.exit(0);
}

function argValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const filterHook    = argValue('--hook');
const filterSession = argValue('--session');
const limitPerHook  = parseInt(argValue('--limit') || '5', 10);
const rawMode       = args.includes('--raw');
const clearMode     = args.includes('--clear');
const fieldsMode    = args.includes('--fields');

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

if (clearMode) {
  if (fs.existsSync(debugFile)) {
    fs.unlinkSync(debugFile);
    console.log(`Deleted: ${debugFile}`);
  } else {
    console.log('No debug log found.');
  }
  process.exit(0);
}

if (!fs.existsSync(debugFile)) {
  console.log(`${YELLOW}No debug log found at:${RESET} ${debugFile}`);
  console.log(`\nTo enable debug capture, set ${BOLD}COPILOT_HUD_DEBUG=1${RESET} before starting Copilot CLI.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Load and parse entries
// ---------------------------------------------------------------------------

const raw = fs.readFileSync(debugFile, 'utf8');
const lines = raw.split('\n').filter(Boolean);

if (lines.length === 0) {
  console.log('Debug log is empty.');
  process.exit(0);
}

const entries = lines
  .map(line => {
    try { return JSON.parse(line); } catch (_) { return null; }
  })
  .filter(Boolean)
  .reverse(); // newest first

if (rawMode) {
  entries.forEach(e => console.log(JSON.stringify(e, null, 2)));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

let filtered = entries;
if (filterHook)    filtered = filtered.filter(e => e.hook === filterHook);
if (filterSession) filtered = filtered.filter(e =>
  e.session_id && e.session_id.startsWith(filterSession)
);

if (filtered.length === 0) {
  console.log(`${YELLOW}No entries match the given filters.${RESET}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Group by hook type
// ---------------------------------------------------------------------------

const groups = {};
for (const e of filtered) {
  const h = e.hook || 'unknown';
  if (!groups[h]) groups[h] = [];
  groups[h].push(e);
}

const HOOK_ORDER = [
  'sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'sessionEnd',
];
const hookTypes = [
  ...HOOK_ORDER.filter(h => groups[h]),
  ...Object.keys(groups).filter(h => !HOOK_ORDER.includes(h)),
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const totalShown = filtered.length;
const totalFile  = entries.length;
console.log(
  `\n${BOLD}copilot-hud hook debug log${RESET}  ` +
  `${DIM}${debugFile}${RESET}\n` +
  `${DIM}${totalShown} entries shown / ${totalFile} total${RESET}\n`
);

for (const hookType of hookTypes) {
  const group  = groups[hookType];
  const color  = HOOK_COLORS[hookType] || RESET;
  const toShow = group.slice(0, limitPerHook);
  const extra  = group.length - toShow.length;

  console.log(`${color}${BOLD}── ${hookType}${RESET}  ${DIM}(${group.length} entries)${RESET}`);

  for (const e of toShow) {
    const ts  = e.ts ? new Date(e.ts).toLocaleTimeString() : '?';
    const sid = e.session_id ? `${DIM}${e.session_id.slice(0, 16)}…${RESET}` : `${DIM}no-session${RESET}`;

    console.log(`  ${DIM}${ts}${RESET}  ${sid}`);

    if (fieldsMode) {
      const fields = Array.isArray(e.stdin_fields) ? e.stdin_fields : [];
      console.log(`    ${DIM}stdin fields:${RESET} ${fields.join(', ') || '(none)'}`);
    } else {
      // Show key stdin fields
      const stdin = e.stdin || {};
      const highlights = [];

      if (hookType === 'preToolUse' || hookType === 'postToolUse') {
        if (stdin.toolName) highlights.push(`tool=${BOLD}${stdin.toolName}${RESET}`);
        if (stdin.toolResult) highlights.push(`result=${stdin.toolResult.resultType || '?'}`);
        if (stdin.toolArgs && stdin.toolArgs.path)
          highlights.push(`${DIM}path=${stdin.toolArgs.path.split('/').slice(-2).join('/')}${RESET}`);
      } else if (hookType === 'sessionStart') {
        if (stdin.sessionId || stdin.session_id)
          highlights.push(`id=${stdin.sessionId || stdin.session_id}`);
        if (stdin.model && stdin.model.id) highlights.push(`model=${stdin.model.id}`);
        if (stdin.cwd) highlights.push(`cwd=${DIM}${stdin.cwd.split('/').slice(-2).join('/')}${RESET}`);
      } else if (hookType === 'sessionEnd') {
        if (stdin.sessionId || stdin.session_id)
          highlights.push(`id=${stdin.sessionId || stdin.session_id}`);
      } else if (hookType === 'userPromptSubmitted') {
        const promptPreview = typeof stdin.prompt === 'string'
          ? stdin.prompt.slice(0, 60).replace(/\n/g, '↵')
          : null;
        if (promptPreview) highlights.push(`"${DIM}${promptPreview}${RESET}"`);
      }

      if (highlights.length) {
        console.log(`    ${highlights.join('  ')}`);
      }

      // Show stdin fields summary
      const fields = Array.isArray(e.stdin_fields) ? e.stdin_fields : [];
      console.log(`    ${DIM}fields: [${fields.join(', ')}]${RESET}`);
    }
  }

  if (extra > 0) {
    console.log(`  ${DIM}… ${extra} more (use --limit ${group.length} to see all)${RESET}`);
  }
  console.log();
}
