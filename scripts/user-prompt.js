#!/usr/bin/env node
'use strict';
// user-prompt.js — UserPromptSubmitted hook: captures the user's last prompt
// and its timestamp into hud-state.json for display in future turns.
//
// Stdin schema:
//   prompt:    string — the user's message text
//   timestamp: number — unix ms timestamp

const { withStateLock, readState, STATE_FILE } = require('./state');
const { updateSession, logHookDebug } = require('./session-file');

let raw;
try { raw = require('fs').readFileSync(0, 'utf8'); } catch (_) { process.exit(0); }
try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data   = JSON.parse(raw);
    const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : null;
    const ts     = data.timestamp || Date.now();

    // Log to debug file unconditionally (no-op unless COPILOT_HUD_DEBUG=1)
    const promptState = readState(STATE_FILE);
    logHookDebug('userPromptSubmitted', data, promptState.sessionId || null);

    if (!prompt) process.exit(0);

    withStateLock(state => ({
      ...state,
      lastPrompt:     prompt,
      lastPromptTime: ts,
    }), STATE_FILE);

    // Telemetry: count turns and track inter-prompt intervals.
    // sessionId comes from state.json (not in the userPromptSubmitted payload).
    // turn_intervals measures time between consecutive prompts (user think-time
    // + AI response time combined; NOT pure AI latency).
    const state = readState(STATE_FILE);
    if (state.sessionActive && state.sessionId) {
      const sid = state.sessionId;
      updateSession(sid, session => {
        const now = Date.now();
        if (session.last_prompt_at) {
          const elapsed = now - session.last_prompt_at;
          // Cap at 24 hours to filter stale state from prior sessions
          if (elapsed > 0 && elapsed < 24 * 60 * 60 * 1000) {
            if (!Array.isArray(session.turn_intervals)) session.turn_intervals = [];
            session.turn_intervals.push(elapsed);
          }
        }
        session.turn_count   = (session.turn_count || 0) + 1;
        session.last_prompt_at = now;

        // Prompt length stats — used by buildTelemetryFields at session end
        if (prompt && prompt.length > 0) {
          if (!Array.isArray(session.prompt_lengths)) session.prompt_lengths = [];
          session.prompt_lengths.push(prompt.length);
        }
      }, { mustExist: true });
    }

  } catch (_) {}

  process.exit(0);
