'use strict';
/**
 * events-watcher.js — Tail events.jsonl for live subagent display.
 *
 * Supplements the subagentStart/subagentStop hooks by reading events.jsonl
 * for subagent lifecycle events. This provides a fallback for Copilot CLI
 * versions that may not dispatch those hooks.
 *
 * Usage: Called by the compositor on each statusline render. Maintains a
 * file offset in the session file to avoid re-reading the entire file.
 *
 * Design:
 *   - On each call, reads only new lines since last known offset
 *   - Extracts subagent.started / subagent.completed / subagent.failed events
 *   - Returns agents that aren't already tracked in hud-state.json
 *   - Performance target: < 50ms added to statusline render
 *
 * Exports:
 *   pollSubagentEvents(sessionId, knownAgentIds) → { started: [], completed: [] }
 */

const fs   = require('fs');
const path = require('path');
const { getCopilotConfigDir, getDataDir } = require('./paths');

/**
 * Poll events.jsonl for new subagent events since last read.
 *
 * @param {string} sessionId — current session ID
 * @param {Set<string>|string[]} knownAgentIds — agent IDs already in hud-state (from hooks)
 * @returns {{ started: Array, completed: Array }} — new agents not in knownAgentIds
 */
function pollSubagentEvents(sessionId, knownAgentIds) {
  const result = { started: [], completed: [] };
  if (!sessionId) return result;

  const eventsFile = path.join(getCopilotConfigDir(), 'session-state', sessionId, 'events.jsonl');
  if (!fs.existsSync(eventsFile)) return result;

  const knownSet = knownAgentIds instanceof Set
    ? knownAgentIds
    : new Set(Array.isArray(knownAgentIds) ? knownAgentIds : []);

  // Read the session file to get last watcher offset
  const dataDir = getDataDir();
  const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');

  let offset = 0;
  let sessionRaw = null;
  try {
    if (fs.existsSync(sessionPath)) {
      sessionRaw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      offset = sessionRaw._watcher_offset || 0;
    }
  } catch (_) {}

  // Check file size — if unchanged from offset, nothing new
  let stat;
  try {
    stat = fs.statSync(eventsFile);
  } catch (_) {
    return result;
  }

  if (stat.size <= offset) return result;

  // Read only new bytes since last offset
  let newContent;
  try {
    const fd = fs.openSync(eventsFile, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    newContent = buf.toString('utf8');
  } catch (_) {
    return result;
  }

  // Parse new lines for subagent events
  const lines = newContent.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const type = event.type;
      const data = event.data || {};
      const id = data.toolCallId || '';

      if (type === 'subagent.started' && id && !knownSet.has(id)) {
        result.started.push({
          id,
          name:        data.agentName || 'unnamed',
          displayName: data.agentDisplayName || data.agentName || 'unnamed',
          model:       data.model || '',
          status:      'running',
          startTime:   event.timestamp || Date.now(),
        });
      } else if ((type === 'subagent.completed' || type === 'subagent.failed') && id) {
        result.completed.push({
          id,
          name:       data.agentName || 'unnamed',
          model:      data.model || '',
          status:     type === 'subagent.completed' ? 'completed' : 'failed',
          tokens:     data.totalTokens || 0,
          durationMs: data.durationMs || 0,
          toolCalls:  data.totalToolCalls || 0,
        });
      }
    } catch (_) {}
  }

  // Persist new offset to session file
  if (sessionRaw) {
    try {
      sessionRaw._watcher_offset = stat.size;
      fs.writeFileSync(sessionPath, JSON.stringify(sessionRaw, null, 2));
    } catch (_) {}
  }

  return result;
}

module.exports = { pollSubagentEvents };
