#!/usr/bin/env node
'use strict';
// subagent-start.js — SubagentStart hook.
// Fired when Copilot CLI spawns a subagent (background task, explore, etc.).
// Updates hud-state.json with agent metadata and session file with subagent record.
//
// Expected stdin schema (based on subagent.started event structure):
//   sessionId          — session UUID
//   toolCallId         — unique ID for this agent invocation
//   agentName          — short name (e.g. "gsd-executor", "explore", "rubber-duck")
//   agentDisplayName   — human-friendly name
//   agentDescription   — longer description of agent purpose
//   model              — model used by the subagent (e.g. "claude-haiku-4.5")
//   timestamp          — unix ms or ISO timestamp

const { withStateLock, readState, STATE_FILE } = require('./state');
const { updateSession, logHookDebug } = require('./session-file');

let raw = require('fs').readFileSync(0, 'utf8');
  try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data = JSON.parse(raw);
    const sessionId        = (data.sessionId || data.session_id || '').trim();
    const toolCallId       = data.toolCallId || '';
    const agentName        = data.agentName || 'unnamed';
    const agentDisplayName = data.agentDisplayName || agentName;
    const model            = data.model || '';
    const ts               = data.timestamp || Date.now();

    logHookDebug('subagentStart', data, sessionId);

    if (!sessionId) process.exit(0);

    // Update hud-state.json — add agent to active list
    withStateLock(state => {
      const agents = Array.isArray(state.agents) ? state.agents : [];
      return {
        ...state,
        agents: [...agents, {
          id:          toolCallId,
          name:        agentName,
          displayName: agentDisplayName,
          model:       model,
          status:      'running',
          startTime:   ts,
        }],
      };
    }, STATE_FILE);

    // Update session file — record subagent spawn with model info
    updateSession(sessionId, session => {
      if (!Array.isArray(session.subagents)) session.subagents = [];
      session.subagents.push({
        id:         toolCallId,
        type:       agentName,
        model:      model,
        started_at: new Date(typeof ts === 'number' ? ts : Date.now()).toISOString(),
      });
    }, { mustExist: true });

  } catch (_) {
    // Never crash — hook failures are silent
  }
  process.exit(0);
