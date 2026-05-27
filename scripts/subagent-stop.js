#!/usr/bin/env node
'use strict';
// subagent-stop.js — SubagentStop hook.
// Fired when a subagent completes (success or failure).
// Marks the agent as completed in hud-state.json and records metrics.
//
// Expected stdin schema (based on subagent.completed event structure):
//   sessionId          — session UUID
//   toolCallId         — unique ID matching the start event
//   agentName          — short name
//   agentDisplayName   — human-friendly name
//   model              — model used by the subagent
//   totalToolCalls     — number of tool calls made by the subagent
//   totalTokens        — input + output tokens consumed
//   durationMs         — wall-clock time in ms
//   stopReason         — "completed" | "failed" | "cancelled"
//   error              — error message (present on failure)
//   timestamp          — unix ms or ISO timestamp

const { withStateLock, STATE_FILE } = require('./state');
const { updateSession, logHookDebug } = require('./session-file');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data = JSON.parse(raw);
    const sessionId    = (data.sessionId || data.session_id || '').trim();
    const toolCallId   = data.toolCallId || '';
    const agentName    = data.agentName || 'unnamed';
    const totalTokens  = data.totalTokens || 0;
    const durationMs   = data.durationMs || 0;
    const totalToolCalls = data.totalToolCalls || 0;
    const model        = data.model || '';
    const stopReason   = data.stopReason || (data.error ? 'failed' : 'completed');
    const ts           = data.timestamp || Date.now();

    logHookDebug('subagentStop', data, sessionId);

    if (!sessionId) process.exit(0);

    // Update hud-state.json — mark agent as completed/failed
    withStateLock(state => {
      const agents = Array.isArray(state.agents) ? state.agents : [];
      const updated = agents.map(a => {
        if (a.id === toolCallId || (!a.id && a.name === agentName && a.status === 'running')) {
          return {
            ...a,
            status:     stopReason === 'failed' ? 'failed' : 'completed',
            endTime:    ts,
            durationMs: durationMs,
            tokens:     totalTokens,
          };
        }
        return a;
      });
      return { ...state, agents: updated };
    }, STATE_FILE);

    // Update session file — add completion metrics to the matching subagent
    updateSession(sessionId, session => {
      if (!Array.isArray(session.subagents)) return;
      // Find matching subagent (by toolCallId or by last running agent with same name)
      const match = session.subagents.find(s => s.id === toolCallId) ||
                    [...session.subagents].reverse().find(s => s.type === agentName && !s.ended_at);
      if (match) {
        match.ended_at    = new Date(typeof ts === 'number' ? ts : Date.now()).toISOString();
        match.duration_ms = durationMs;
        match.tokens      = totalTokens;
        match.tool_calls  = totalToolCalls;
        match.status      = stopReason;
        if (data.error) match.error = data.error;
      }
    }, { mustExist: true });

  } catch (_) {
    // Never crash — hook failures are silent
  }
  process.exit(0);
});
