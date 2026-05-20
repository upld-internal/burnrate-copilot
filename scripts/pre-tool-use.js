#!/usr/bin/env node
'use strict';
// pre-tool-use.js — PreToolUse hook: marks tools as "running" in hud-state.json.
// Detects agent spawns via the `task` tool.
// Called by Copilot CLI before each tool invocation.
//
// Stdin schema:
//   toolName:  string  — tool being called
//   toolArgs:  object  — tool arguments (path, command, etc.)
//   timestamp: number  — unix ms timestamp

const path = require('path');
const { withStateLock, readState, STATE_FILE, MAX_RECENT_TOOLS } = require('./state');
const { updateSession, logHookDebug } = require('./session-file');

// Internal tools that should not appear in the tool activity display.
// These are Copilot/GSD framework tools, not user-visible work.
const INTERNAL_TOOLS = new Set([
  'report_intent', 'task_complete', 'thinking', 'read_agent', 'list_agents', 'write_agent',
]);

// Extract a short human-readable target string from common tool arguments.
function extractTarget(toolName, toolArgs) {
  if (!toolArgs || typeof toolArgs !== 'object') return null;

  switch (toolName) {
    case 'edit':
    case 'view':
    case 'create':
      return toolArgs.path || toolArgs.file_path || null;

    case 'bash': {
      const cmd = typeof toolArgs.command === 'string' ? toolArgs.command : null;
      if (!cmd) return null;
      // Strip "cd /path && " preamble that Copilot prepends to commands
      return cmd.replace(/^cd [^ ]+ && /, '').slice(0, 80);
    }

    case 'glob':
    case 'grep':
    case 'rg':
      return toolArgs.pattern || toolArgs.glob || null;

    default:
      return null;
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data      = JSON.parse(raw);
    const toolName  = (data.toolName || '').trim();
    const toolArgs  = data.toolArgs  || {};
    const ts        = data.timestamp || Date.now();

    if (!toolName) process.exit(0);

    // Skip internal framework tools
    if (INTERNAL_TOOLS.has(toolName)) process.exit(0);

    // agent spawn detection: `task` tool creates a sub-agent
    if (toolName === 'task') {
      const description  = (typeof toolArgs.description === 'string' ? toolArgs.description : '').trim();
      const subagentType = typeof toolArgs.agent_type  === 'string' ? toolArgs.agent_type  : null;

      if (!description) process.exit(0);

      withStateLock(state => {
        const agents = Array.isArray(state.agents) ? state.agents : [];
        return {
          ...state,
          agents: [...agents, {
            description,
            subagentType: subagentType || null,
            status:       'running',
            startTime:    ts,
          }],
        };
      }, STATE_FILE);

      // Telemetry: record subagent spawn in session file
      const taskState = readState(STATE_FILE);
      if (taskState.sessionActive && taskState.sessionId) {
        const sid = taskState.sessionId;
        updateSession(sid, session => {
          if (!Array.isArray(session.subagents)) session.subagents = [];
          session.subagents.push({ type: subagentType || 'unknown', started_at: new Date().toISOString() });
        }, { mustExist: true });
        logHookDebug('preToolUse', data, sid);
      }

      process.exit(0);
    }

    // Regular tool: mark as running and prepend to recentTools
    const target = extractTarget(toolName, toolArgs);

    withStateLock(state => {
      const tools = Array.isArray(state.recentTools) ? state.recentTools : [];
      const entry = {
        name:      toolName,
        target:    target || null,
        status:    'running',
        timestamp: ts,
      };
      return {
        ...state,
        recentTools: [entry, ...tools].slice(0, MAX_RECENT_TOOLS),
      };
    }, STATE_FILE);

    // Telemetry: increment tool_counts and track ext_counts for file edits.
    // sessionId comes from state.json (not in the preToolUse payload).
    const state = readState(STATE_FILE);
    if (state.sessionActive && state.sessionId) {
      const sid = state.sessionId;
      updateSession(sid, session => {
        if (!session.tool_counts) session.tool_counts = {};
        session.tool_counts[toolName] = (session.tool_counts[toolName] || 0) + 1;

        if (toolName === 'edit' || toolName === 'create') {
          const filePath = (toolArgs.path || toolArgs.file_path || '').trim();
          if (filePath) {
            const ext = path.extname(filePath).toLowerCase() || '[no-ext]';
            if (!session.ext_counts) session.ext_counts = {};
            session.ext_counts[ext] = (session.ext_counts[ext] || 0) + 1;
          }
        }
      }, { mustExist: true });
      logHookDebug('preToolUse', data, sid);
    }

  } catch (_) {
    // Never crash — hook failures are silent
  }

  process.exit(0);
});
