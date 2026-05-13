'use strict';
// widgets/tools.js — tool_activity and agent_activity widgets.
//
// Reads from sessionData.recentTools and sessionData.agents, populated by
// pre-tool-use.js and post-tool-use.js via hud-state.json.
// Only displays tools/agents matching the current session (sessionId check).

const path = require('path');
const { R, B, D, YL, RD, GR } = require('../themes');

// ---------------------------------------------------------------------------
// Tool icons and status icons
// ---------------------------------------------------------------------------

const TOOL_ICONS = {
  bash:    '⌨',
  edit:    '✎',
  view:    '◉',
  create:  '✚',
  glob:    '⊛',
  grep:    '⊛',
  rg:      '⊛',
  find:    '⊛',
  task:    '⟳',
};
const DEFAULT_TOOL_ICON = '◈';

function toolIcon(name) {
  return TOOL_ICONS[(name || '').toLowerCase()] || DEFAULT_TOOL_ICON;
}

function statusIcon(status) {
  switch (status) {
    case 'success': return '✓';
    case 'failure': return '✗';
    case 'running': return '◐';
    case 'denied':  return '⊘';
    default:        return '·';
  }
}

function statusColor(status) {
  switch (status) {
    case 'success': return GR;
    case 'failure': return RD;
    case 'running': return YL;
    case 'denied':  return D;
    default:        return '';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Deduplicate recentTools by name: keep total count and last status/target.
function summariseTools(tools) {
  const map = new Map();
  for (const tool of tools) {
    const existing = map.get(tool.name);
    if (existing) {
      existing.count++;
      existing.lastStatus = tool.status;
      existing.lastTarget = tool.target;
    } else {
      map.set(tool.name, { count: 1, lastStatus: tool.status, lastTarget: tool.target });
    }
  }
  return map;
}

function formatAgentDuration(startTime, endTime) {
  const end = endTime || Date.now();
  const ms   = end - startTime;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins    = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

// tool_activity — compact summary of recent tools with status icons.
// Format: "✓ ⌨ Bash: ls ×3  ◐ ✎ Edit: auth.js"
// opts.max_tools:  max tools to show (default 4)
// opts.show_label: boolean (default false)
function tool_activity(stdinData, sessionData, opts) {
  const tools = sessionData.recentTools;
  if (!Array.isArray(tools) || tools.length === 0) return null;

  const maxTools = opts.max_tools || 4;
  const summary  = summariseTools(tools);

  const segments = [];
  let i = 0;
  for (const [toolName, info] of summary.entries()) {
    if (i >= maxTools) break;

    const c    = statusColor(info.lastStatus);
    const sI   = statusIcon(info.lastStatus);
    const tI   = toolIcon(toolName);
    const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);

    let part;
    if (opts._powerline) {
      part = `${sI} ${tI} ${name}`;
      if (info.lastTarget) {
        const short = path.isAbsolute(info.lastTarget)
          ? path.basename(info.lastTarget)
          : info.lastTarget.slice(0, 30);
        part += `: ${short}`;
      }
      if (info.count > 1) part += ` ×${info.count}`;
    } else {
      part = `${c}${sI} ${tI}${R} ${B}${name}${R}`;
      if (info.lastTarget) {
        const short = path.isAbsolute(info.lastTarget)
          ? path.basename(info.lastTarget)
          : info.lastTarget.slice(0, 30);
        part += `${D}: ${short}${R}`;
      }
      if (info.count > 1) part += `${D} ×${info.count}${R}`;
    }

    segments.push(part);
    i++;
  }

  if (!segments.length) return null;
  return segments.join('  ');
}

// agent_activity — one entry per spawned sub-agent with status and duration.
// Format: "◐ [explore] Analyzing codebase (12s…)"
// Multiple agents are joined with newlines.
// opts.max_agents: max agents to show (default 3, most recent first)
function agent_activity(stdinData, sessionData, opts) {
  const agents = sessionData.agents;
  if (!Array.isArray(agents) || agents.length === 0) return null;

  const maxAgents = opts.max_agents || 3;
  const lines     = [];

  // Most recent agents first (they're appended, so iterate backwards)
  const start = Math.max(0, agents.length - maxAgents);
  for (let i = agents.length - 1; i >= start; i--) {
    const agent    = agents[i];
    const c        = statusColor(agent.status);
    const sI       = statusIcon(agent.status);
    const typeLabel = agent.subagentType ? agent.subagentType.toLowerCase() : 'agent';
    const dur       = formatAgentDuration(agent.startTime, agent.endTime);
    const durText   = agent.status === 'running' ? `${dur}…` : dur;

    let line;
    if (opts._powerline) {
      line = `${sI} [${typeLabel}] ${agent.description} (${durText})`;
    } else {
      line = `${c}${sI}${R} ${D}[${typeLabel}]${R} ${agent.description} ${D}(${durText})${R}`;
    }
    lines.push(line);
  }

  if (!lines.length) return null;
  return lines.join('\n');
}

module.exports = { tool_activity, agent_activity };

