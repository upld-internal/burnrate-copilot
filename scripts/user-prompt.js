#!/usr/bin/env node
'use strict';
// user-prompt.js — UserPromptSubmitted hook: captures the user's last prompt
// and its timestamp into hud-state.json for display in future turns.
//
// Stdin schema:
//   prompt:    string — the user's message text
//   timestamp: number — unix ms timestamp

const { withStateLock, STATE_FILE } = require('./state');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data   = JSON.parse(raw);
    const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : null;
    const ts     = data.timestamp || Date.now();

    if (!prompt) process.exit(0);

    withStateLock(state => ({
      ...state,
      lastPrompt:     prompt,
      lastPromptTime: ts,
    }), STATE_FILE);

  } catch (_) {}

  process.exit(0);
});
