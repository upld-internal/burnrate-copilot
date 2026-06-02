#!/usr/bin/env node
'use strict';
// post-tool-use.js — PostToolUse hook: updates tool status after completion.
// Also handles agent completion via `read_agent` postToolUse events.
// Called by Copilot CLI after each tool invocation.
//
// Stdin schema:
//   toolName:   string — tool that completed
//   toolResult: { resultType: "success" | "failure" | "denied" }
//   timestamp:  number — unix ms timestamp

const { withStateLock, readState, STATE_FILE } = require('./state');
const { updateSession, logHookDebug } = require('./session-file');

// Internal tools to skip, with the exception of `read_agent`
// (which signals agent completion — handled separately below).
const SKIP_TOOLS = new Set([
  'report_intent', 'task_complete', 'thinking', 'list_agents', 'write_agent',
]);

function mapResultType(resultType) {
  switch (resultType) {
    case 'success': return 'success';
    case 'failure': return 'failure';
    case 'denied':  return 'denied';
    default:        return 'success';
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
setTimeout(() => process.exit(0), 4000).unref(); // safety: exit if stdin never closes (Windows)
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data       = JSON.parse(raw);
    const toolName   = (data.toolName || '').trim();
    const resultType = (data.toolResult || {}).resultType || 'success';
    const ts         = data.timestamp || Date.now();
    const status     = mapResultType(resultType);

    if (!toolName) process.exit(0);

    // Log all postToolUse events to debug log (no-op unless COPILOT_HUD_DEBUG=1)
    const postState = readState(STATE_FILE);
    logHookDebug('postToolUse', data, postState.sessionId || null);
    if (SKIP_TOOLS.has(toolName)) process.exit(0);

    // `task` postToolUse fires when the task CALL completes (the agent is now
    // spawned and running) — NOT when the agent finishes. Skip it; agent
    // completion is signalled via `read_agent` below.
    if (toolName === 'task') process.exit(0);

    // `read_agent` postToolUse fires when an agent's result is retrieved,
    // meaning the agent has completed. Mark the oldest running agent as done.
    if (toolName === 'read_agent') {
      withStateLock(state => {
        const agents = Array.isArray(state.agents) ? state.agents : [];
        // Find the first (oldest appended) running agent
        const runningIdx = agents.findIndex(a => a.status === 'running');
        if (runningIdx === -1) return null; // nothing to update — return null means no write
        const updated = agents.map((a, i) =>
          i === runningIdx ? { ...a, status, endTime: ts } : a
        );
        return { ...state, agents: updated };
      }, STATE_FILE);
      process.exit(0);
    }

    // Regular tool: update the first running entry matching this tool name
    withStateLock(state => {
      const tools = Array.isArray(state.recentTools) ? state.recentTools : [];

      // Find the first running entry for this tool
      let updated = false;
      const newTools = tools.map(t => {
        if (!updated && t.name === toolName && t.status === 'running') {
          updated = true;
          return { ...t, status, timestamp: ts };
        }
        return t;
      });

      // If no running entry exists, prepend a completed entry
      if (!updated) {
        const { MAX_RECENT_TOOLS } = require('./state');
        return {
          ...state,
          recentTools: [{ name: toolName, target: null, status, timestamp: ts }, ...tools]
            .slice(0, MAX_RECENT_TOOLS),
        };
      }

      return { ...state, recentTools: newTools };
    }, STATE_FILE);

    // Tool duration tracking — pop oldest start time from FIFO queue
    const state = readState(STATE_FILE);
    if (state.sessionActive && state.sessionId) {
      updateSession(state.sessionId, session => {
        const queue = session.tool_start_times && session.tool_start_times[toolName];
        if (Array.isArray(queue) && queue.length > 0) {
          const start = queue.shift();
          session.tool_start_times[toolName] = queue;
          const dur = ts - start;
          // Cap at 5 minutes — longer durations are likely stale state from a prior session
          if (dur > 0 && dur < 300_000) {
            if (!Array.isArray(session.tool_durations_ms)) session.tool_durations_ms = [];
            session.tool_durations_ms.push(dur);
          }
        }
      }, { mustExist: true });
    }

  } catch (_) {}

  process.exit(0);
});
