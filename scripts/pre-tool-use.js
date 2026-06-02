#!/usr/bin/env node
'use strict';
// pre-tool-use.js — PreToolUse hook.

// Diagnostic: same as session-start.js, writes to os.tmpdir().
try {
  const _fs = require('fs'), _os = require('os'), _path = require('path');
  const _line = new Date().toISOString() + ' pre-tool-use.js invoked PLUGIN_ROOT=' + (process.env.PLUGIN_ROOT || '(unset)') + '\n';
  _fs.appendFileSync(_path.join(_os.tmpdir(), 'burnrate-pre-tool-use.log'), _line);
} catch (_) {}

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

let raw;
try { raw = require('fs').readFileSync(0, 'utf8'); } catch (_) { process.exit(0); }
try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data      = JSON.parse(raw);
    const toolName  = (data.toolName || '').trim();
    const toolArgs  = data.toolArgs  || {};
    const ts        = data.timestamp || Date.now();

    if (!toolName) process.exit(0);

    // Log all preToolUse events to debug log (no-op unless COPILOT_HUD_DEBUG=1)
    const currentState = readState(STATE_FILE);
    logHookDebug('preToolUse', data, currentState.sessionId || null);

    // Skip internal framework tools
    if (INTERNAL_TOOLS.has(toolName)) process.exit(0);

    // agent spawn detection: `task` tool creates a sub-agent.
    // This is a fallback for Copilot CLI versions that don't fire subagentStart hook.
    // When subagentStart hook is active, this produces a duplicate entry that the
    // subagent-start.js script deduplicates by toolCallId.
    if (toolName === 'task') {
      const description  = (typeof toolArgs.description === 'string' ? toolArgs.description : '').trim();
      const subagentType = typeof toolArgs.agent_type  === 'string' ? toolArgs.agent_type  : null;

      if (!description) process.exit(0);

      withStateLock(state => {
        const agents = Array.isArray(state.agents) ? state.agents : [];
        // Skip if subagentStart hook already registered this (by matching description)
        const alreadyRegistered = agents.some(a =>
          a.status === 'running' && (a.name === subagentType || a.description === description)
        );
        if (alreadyRegistered) return state;

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

        // Web search / web fetch counts
        const tl = toolName.toLowerCase();
        if (tl === 'web_search' || tl === 'websearch') {
          session.web_search_requests = (session.web_search_requests || 0) + 1;
        } else if (tl === 'web_fetch' || tl === 'webfetch') {
          session.web_fetch_requests = (session.web_fetch_requests || 0) + 1;
        }

        // Tool start time — FIFO queue per tool name for parallel-safe duration tracking
        if (!session.tool_start_times) session.tool_start_times = {};
        if (!Array.isArray(session.tool_start_times[toolName])) session.tool_start_times[toolName] = [];
        session.tool_start_times[toolName].push(ts);

        if (toolName === 'edit' || toolName === 'create') {
          const filePath = (toolArgs.path || toolArgs.file_path || '').trim();
          if (filePath) {
            const ext = path.extname(filePath).toLowerCase() || '[no-ext]';
            if (!session.ext_counts) session.ext_counts = {};
            session.ext_counts[ext] = (session.ext_counts[ext] || 0) + 1;
          }
        }
      }, { mustExist: true });
    }

  } catch (_) {
    // Never crash — hook failures are silent
  }

  process.exit(0);
