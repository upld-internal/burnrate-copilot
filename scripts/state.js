'use strict';
// state.js — read/write hud-state.json for tool and agent activity tracking.
//
// hud-state.json lives at ~/.copilot/hud-state.json.
// Written by hook scripts (session-start, pre/postToolUse, userPromptSubmitted).
// Read by the statusline compositor on every turn.
//
// writeState uses mkdir-based atomic locking (same pattern as griches/burnrate-copilot).
// Multiple concurrent Copilot sessions will contend for the lock safely.

const fs   = require('fs');
const path = require('path');
const { getCopilotConfigDir } = require('./paths');

const STATE_FILE = path.join(getCopilotConfigDir(), 'hud-state.json');
const MAX_RECENT_TOOLS = 8;

const EMPTY_STATE = {
  sessionId:      null,
  sessionStart:   null,
  cwd:            null,
  lastPrompt:     null,
  lastPromptTime: null,
  recentTools:    [],
  agents:         [],
  sessionActive:  false,
};

function readState(stateFile) {
  const file = stateFile || STATE_FILE;
  if (!fs.existsSync(file)) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...EMPTY_STATE,
      ...parsed,
      recentTools: Array.isArray(parsed.recentTools) ? parsed.recentTools : [],
      agents:      Array.isArray(parsed.agents)      ? parsed.agents      : [],
    };
  } catch (_) {
    return { ...EMPTY_STATE };
  }
}

// ---------------------------------------------------------------------------
// Atomic locking (mkdir-based, same pattern as griches/burnrate-copilot bash impl)
// ---------------------------------------------------------------------------

function syncSleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {} // busy wait — acceptable in short-lived hook scripts
}

function acquireLock(lockDir) {
  const MAX_RETRIES = 40;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      fs.mkdirSync(lockDir);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') return false;
      syncSleepMs(50);
    }
  }
  // Stale lock — force remove and try once more
  try { fs.rmdirSync(lockDir); } catch (_) {}
  try { fs.mkdirSync(lockDir); return true; } catch (_) {}
  return false;
}

function releaseLock(lockDir) {
  try { fs.rmdirSync(lockDir); } catch (_) {}
}

// withStateLock(fn) — acquire lock, call fn(currentState) → newState, write back.
// fn receives the parsed current state and must return the new state object.
// Lock is always released regardless of errors in fn.
function withStateLock(fn, stateFile) {
  const file    = stateFile || STATE_FILE;
  const lockDir = file + '.lock';
  const tmpFile = file + '.tmp';

  acquireLock(lockDir);
  try {
    const current = readState(file);
    const next    = fn(current);
    if (next) {
      fs.writeFileSync(tmpFile, JSON.stringify(next, null, 2));
      fs.renameSync(tmpFile, file);
    }
  } finally {
    releaseLock(lockDir);
  }
}

// writeState — write state without locking (caller must hold lock or be session-start).
function writeState(state, stateFile) {
  const file    = stateFile || STATE_FILE;
  const tmpFile = file + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, file);
}

module.exports = { readState, writeState, withStateLock, STATE_FILE, MAX_RECENT_TOOLS };
