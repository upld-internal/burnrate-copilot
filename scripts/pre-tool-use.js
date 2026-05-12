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
const { withStateLock, STATE_FILE, MAX_RECENT_TOOLS } = require('./state');

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

  } catch (_) {
    // Never crash — hook failures are silent
  }

  process.exit(0);
});
