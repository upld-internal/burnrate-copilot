'use strict';
/**
 * events-parser.js — parse Copilot CLI events.jsonl for session-enrichment data.
 *
 * The events.jsonl file (at ~/.copilot/session-state/<session-id>/events.jsonl)
 * contains lifecycle events for a session. Key events used here:
 *
 *   session.shutdown → enriched fields: files modified, premium requests, lines added/removed, etc.
 *
 * Cost is now authoritative from ai_used.total_nano_aiu in the statusline payload.
 * This module no longer handles pricing or cost computation.
 *
 * Exports:
 *   getSessionStateDir(sessionId)    → string
 *   parseShutdownMetrics(sessionId)  → modelMetrics object | null
 *   parseShutdownEnriched(sessionId) → enriched fields object | null
 */

const fs   = require('fs');
const path = require('path');
const { getCopilotConfigDir } = require('./paths');

/**
 * Returns the session-state directory for a given session ID.
 * This is where Copilot CLI stores events.jsonl, checkpoints, etc.
 */
function getSessionStateDir(sessionId) {
  return path.join(getCopilotConfigDir(), 'session-state', sessionId);
}

/**
 * Parse events.jsonl for a session, extracting cost-relevant data in one pass.
 *
 * Returns { shutdownMetrics, subagents } or null if file doesn't exist.
 *   shutdownMetrics: modelMetrics object from session.shutdown, or null
 *   subagents: array of subagent.completed event data objects
 */
function parseEventsFile(sessionId) {
  const eventsFile = path.join(getSessionStateDir(sessionId), 'events.jsonl');
  if (!fs.existsSync(eventsFile)) return null;

  let shutdownMetrics = null;
  let shutdownData = null;

  try {
    const content = fs.readFileSync(eventsFile, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'session.shutdown') {
          shutdownData = event.data || {};
          shutdownMetrics = shutdownData.modelMetrics || null;
        }
      } catch (_) {}
    }
  } catch (_) {
    return null;
  }

  return { shutdownMetrics, shutdownData };
}

/**
 * Parse the events.jsonl for a session and extract session.shutdown.modelMetrics.
 * Returns the modelMetrics object if found, null otherwise.
 */
function parseShutdownMetrics(sessionId) {
  const result = parseEventsFile(sessionId);
  return result ? result.shutdownMetrics : null;
}

/**
 * Parse the events.jsonl for a session and extract enriched fields from session.shutdown.
 *
 * Returns an object with all available enriched fields, or null if no shutdown event found.
 * All fields are optional — callers should only write non-undefined values to JSONL.
 *
 * Returned shape:
 *   {
 *     files_modified: string[],         — paths of files changed during session
 *     files_modified_count: number,     — count of modified files
 *     premium_requests: number,         — from totalPremiumRequests
 *     api_duration_ms: number,          — from totalApiDurationMs
 *     reasoning_tokens: number,         — sum of reasoningTokens across all models
 *     context_breakdown: { system, conversation, tool_definitions },
 *     models_used: string[],            — all model IDs from modelMetrics keys
 *     lines_added: number,              — from codeChanges.linesAdded
 *     lines_removed: number,            — from codeChanges.linesRemoved
 *   }
 */
function parseShutdownEnriched(sessionId) {
  const result = parseEventsFile(sessionId);
  if (!result || !result.shutdownData) return null;

  const d = result.shutdownData;
  const enriched = {};

  // Code changes — files modified
  if (d.codeChanges) {
    const cc = d.codeChanges;
    if (Array.isArray(cc.filesModified) && cc.filesModified.length > 0) {
      enriched.files_modified = cc.filesModified;
      enriched.files_modified_count = cc.filesModified.length;
    }
    if (typeof cc.linesAdded === 'number')   enriched.lines_added = cc.linesAdded;
    if (typeof cc.linesRemoved === 'number') enriched.lines_removed = cc.linesRemoved;
  }

  // Premium requests
  if (typeof d.totalPremiumRequests === 'number') {
    enriched.premium_requests = d.totalPremiumRequests;
  }

  // API duration
  if (typeof d.totalApiDurationMs === 'number') {
    enriched.api_duration_ms = d.totalApiDurationMs;
  }

  // Context breakdown (token allocation)
  if (d.systemTokens || d.conversationTokens || d.toolDefinitionsTokens) {
    enriched.context_breakdown = {
      system: d.systemTokens || 0,
      conversation: d.conversationTokens || 0,
      tool_definitions: d.toolDefinitionsTokens || 0,
    };
  }

  // Models used + reasoning tokens (from modelMetrics)
  if (d.modelMetrics && typeof d.modelMetrics === 'object') {
    const models = Object.keys(d.modelMetrics);
    if (models.length > 0) {
      enriched.models_used = models;
    }

    let totalReasoning = 0;
    for (const data of Object.values(d.modelMetrics)) {
      const usage = data.usage || {};
      totalReasoning += usage.reasoningTokens || 0;
    }
    if (totalReasoning > 0) {
      enriched.reasoning_tokens = totalReasoning;
    }
  }

  return Object.keys(enriched).length > 0 ? enriched : null;
}

module.exports = {
  getSessionStateDir,
  parseEventsFile,
  parseShutdownMetrics,
  parseShutdownEnriched,
};
