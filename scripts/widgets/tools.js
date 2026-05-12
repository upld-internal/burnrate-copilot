'use strict';
// widgets/tools.js — tool_activity and agent_activity widgets.
//
// Phase 3 stubs: return null until Phase 3 implements tool/agent tracking
// via pre-tool-use.js, post-tool-use.js, and state.js.
//
// Phase 3 implementation will:
//   tool_activity  — show recent tool calls with status icons (✓/✗/◐/⊘)
//   agent_activity — show spawned agents with type, description, duration, status

// tool_activity — recent tool calls and their status.
// Phase 3: reads from sessionData.recentTools (loaded via state.js).
function tool_activity(stdinData, sessionData, opts) {
  // Phase 1/2 stub: return null until Phase 3 is implemented.
  return null;
}

// agent_activity — spawned sub-agents and their status.
// Phase 3: reads from sessionData.agents (loaded via state.js).
function agent_activity(stdinData, sessionData, opts) {
  // Phase 1/2 stub: return null until Phase 3 is implemented.
  return null;
}

module.exports = { tool_activity, agent_activity };
