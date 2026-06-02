#!/usr/bin/env node
'use strict';
// pre-compact.js — PreCompact hook.
// Fired before context compaction. Records compaction events for telemetry.
//
// Key finding: Copilot CLI's statusline tokens are CUMULATIVE across compactions
// (they never reset). This means our delta-based cost calculation works correctly
// without needing to "bank" pre-compaction cost.
//
// This hook's purpose is telemetry only:
// - Increment compaction_count in the session file
// - Record the pre-compaction token level for analysis
//
// Expected stdin schema (based on session.compaction_start event):
//   sessionId             — session UUID
//   systemTokens          — system prompt token count
//   conversationTokens    — conversation history token count
//   toolDefinitionsTokens — tool definitions token count
//   timestamp             — unix ms or ISO timestamp

const { updateSession, logHookDebug } = require('./session-file');
const { readState, STATE_FILE } = require('./state');

let raw = '';
process.stdin.setEncoding('utf8');
setTimeout(() => process.exit(0), 4000).unref(); // safety: exit if stdin never closes (Windows)
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data = JSON.parse(raw);
    const sessionId = (data.sessionId || data.session_id || '').trim();

    // Fall back to state.json for sessionId if not in payload
    const resolvedSessionId = sessionId || (readState(STATE_FILE) || {}).sessionId || '';

    logHookDebug('preCompact', data, resolvedSessionId);

    if (!resolvedSessionId) process.exit(0);

    // Update session file — increment compaction counter
    updateSession(resolvedSessionId, session => {
      session.compaction_count = (session.compaction_count || 0) + 1;

      // Record pre-compaction context size for analysis
      if (!session.compactions) session.compactions = [];
      session.compactions.push({
        timestamp: data.timestamp || Date.now(),
        system_tokens: data.systemTokens || 0,
        conversation_tokens: data.conversationTokens || 0,
        tool_definition_tokens: data.toolDefinitionsTokens || 0,
      });
    }, { mustExist: true });

  } catch (_) {
    // Never crash — hook failures are silent
  }
  process.exit(0);
});
