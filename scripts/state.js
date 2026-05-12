'use strict';
// state.js — read/write hud-state.json for tool and agent activity tracking.
//
// Phase 1: read-only stub. readState() returns current state (or empty default).
// Phase 3: adds writeState() with file locking for pre/post-tool-use hooks.
//
// hud-state.json lives at ~/.copilot/hud-state.json.
// It is written by hook scripts (pre/postToolUse, userPromptSubmitted)
// and read by the statusline compositor.

const fs   = require('fs');
const path = require('path');
const { getCopilotConfigDir } = require('./paths');

const STATE_FILE = path.join(getCopilotConfigDir(), 'hud-state.json');

const EMPTY_STATE = {
  sessionId:     null,
  sessionStart:  null,
  cwd:           null,
  lastPrompt:    null,
  lastPromptTime: null,
  recentTools:   [],
  agents:        [],
  sessionActive: false,
};

function readState() {
  if (!fs.existsSync(STATE_FILE)) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
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

module.exports = { readState, STATE_FILE };
