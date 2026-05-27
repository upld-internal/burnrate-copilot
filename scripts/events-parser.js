'use strict';
/**
 * events-parser.js — parse Copilot CLI events.jsonl for cost-relevant data.
 *
 * The events.jsonl file (at ~/.copilot/session-state/<session-id>/events.jsonl)
 * is the authoritative source for per-model token usage. Key events:
 *
 *   session.shutdown → data.modelMetrics: per-model token breakdown
 *   subagent.completed → data.totalTokens, data.model, data.durationMs
 *   session.compaction_complete → data.compactionTokensUsed
 *
 * This module extracts modelMetrics and computes accurate multi-model cost.
 *
 * IMPORTANT: events.jsonl may not always be available:
 *   - Session ended normally → file exists, session.shutdown event present
 *   - Ctrl+C / crash → file may exist but no session.shutdown event
 *   - Session-state cleaned up → file gone entirely
 *
 * Callers must handle null returns gracefully and fall back to single-model pricing.
 *
 * Exports:
 *   getSessionStateDir(sessionId)           → string
 *   parseShutdownMetrics(sessionId)         → modelMetrics object | null
 *   parseShutdownEnriched(sessionId)        → enriched fields object | null
 *   computeMultiModelCost(modelMetrics, pricingTable) → { total, perModel, models }
 *   computeMultiModelCostForSession(sessionId, pricingTable) → result | null
 *   loadPricingTable(dataDir, scriptDir)    → { modelId: { input, output, ... } }
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
  const subagents = [];
  const compactions = [];

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
        } else if (event.type === 'subagent.completed' || event.type === 'subagent.failed') {
          subagents.push(event.data || {});
        } else if (event.type === 'session.compaction_complete') {
          const d = event.data || {};
          if (d.compactionTokensUsed) {
            compactions.push({
              ...d.compactionTokensUsed,
              preCompactionTokens: d.preCompactionTokens || 0,
              timestamp: event.timestamp,
            });
          }
        }
      } catch (_) {}
    }
  } catch (_) {
    return null;
  }

  return { shutdownMetrics, shutdownData, subagents, compactions };
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

/**
 * Parse subagent.completed events and compute per-agent cost.
 *
 * Returns array of:
 *   { name, model, tokens, cost_usd, duration_ms, tool_calls }
 *
 * Note: subagent.completed.totalTokens = inputTokens + outputTokens only (no cache).
 * We approximate cost as: totalTokens split 95% input / 5% output for pricing.
 * This is approximate — the authoritative total comes from modelMetrics.
 *
 * @param {string} sessionId
 * @param {Object} pricingTable — full pricing table
 * @returns {Array|null} — null if events.jsonl not available
 */
function parseSubagentCompletions(sessionId, pricingTable) {
  const result = parseEventsFile(sessionId);
  if (!result || result.subagents.length === 0) return null;

  return result.subagents.map(sa => {
    const model = sa.model || 'unknown';
    const totalTokens = sa.totalTokens || 0;
    const pricing = pricingTable[model];

    // Approximate cost: totalTokens ≈ input + output.
    // From empirical data, subagent token splits are roughly 95% input / 5% output.
    // Use weighted average rate: (0.95 * input_rate + 0.05 * output_rate) per token
    let costUsd = 0;
    if (pricing && totalTokens > 0) {
      const inputTokens  = Math.round(totalTokens * 0.95);
      const outputTokens = totalTokens - inputTokens;
      costUsd = inputTokens / 1e6 * (pricing.input || 0) +
                outputTokens / 1e6 * (pricing.output || 0);
    }

    return {
      name:        sa.agentName || sa.agentDisplayName || 'unnamed',
      model:       model,
      tokens:      totalTokens,
      cost_usd:    Math.round(costUsd * 1e6) / 1e6, // 6 decimal places
      duration_ms: sa.durationMs || 0,
      tool_calls:  sa.totalToolCalls || 0,
    };
  });
}

/**
 * Parse compaction costs from events.jsonl.
 * Returns summary of compaction API calls (tokens consumed by compaction itself).
 *
 * @param {string} sessionId
 * @param {Object} pricingTable
 * @returns {{ count, total_cost_usd, compactions: [] } | null}
 */
function parseCompactionCosts(sessionId, pricingTable) {
  const result = parseEventsFile(sessionId);
  if (!result || result.compactions.length === 0) return null;

  let totalCost = 0;
  const compactions = result.compactions.map(c => {
    const model = c.model || 'unknown';
    const pricing = pricingTable[model];
    let cost = 0;
    if (pricing) {
      cost = (c.inputTokens || 0) / 1e6 * (pricing.input || 0) +
             (c.outputTokens || 0) / 1e6 * (pricing.output || 0) +
             (c.cacheReadTokens || 0) / 1e6 * (pricing.cache_read || 0) +
             (c.cacheWriteTokens || 0) / 1e6 * (pricing.cache_write || 0);
    }
    totalCost += cost;
    return {
      model,
      input_tokens: c.inputTokens || 0,
      output_tokens: c.outputTokens || 0,
      cost_usd: Math.round(cost * 1e6) / 1e6,
      duration_ms: c.duration || 0,
    };
  });

  return {
    count: compactions.length,
    total_cost_usd: Math.round(totalCost * 1e6) / 1e6,
    compactions,
  };
}

/**
 * Compute accurate multi-model cost from modelMetrics.
 *
 * @param {Object} modelMetrics — from session.shutdown event
 * @param {Object} pricingTable — { modelId: { input, output, cache_write, cache_read } }
 * @returns {{ total: number, perModel: Object, models: string[], missingPricing: string[] }}
 */
function computeMultiModelCost(modelMetrics, pricingTable) {
  if (!modelMetrics || typeof modelMetrics !== 'object') {
    return null;
  }

  let total = 0;
  const perModel = {};
  const models = [];
  const missingPricing = [];

  for (const [modelId, data] of Object.entries(modelMetrics)) {
    const usage = data.usage || {};
    const pricing = pricingTable[modelId];
    models.push(modelId);

    if (!pricing) {
      missingPricing.push(modelId);
      perModel[modelId] = {
        cost: 0,
        hasPricing: false,
        tokens: {
          input: usage.inputTokens || 0,
          output: usage.outputTokens || 0,
          cache_write: usage.cacheWriteTokens || 0,
          cache_read: usage.cacheReadTokens || 0,
        },
        requests: (data.requests || {}).count || 0,
      };
      continue;
    }

    const input      = (usage.inputTokens || 0) / 1e6 * (pricing.input || 0);
    const output     = (usage.outputTokens || 0) / 1e6 * (pricing.output || 0);
    const cacheWrite = (usage.cacheWriteTokens || 0) / 1e6 * (pricing.cache_write || 0);
    const cacheRead  = (usage.cacheReadTokens || 0) / 1e6 * (pricing.cache_read || 0);
    const cost = input + output + cacheWrite + cacheRead;

    total += cost;
    perModel[modelId] = {
      cost,
      hasPricing: true,
      tokens: {
        input: usage.inputTokens || 0,
        output: usage.outputTokens || 0,
        cache_write: usage.cacheWriteTokens || 0,
        cache_read: usage.cacheReadTokens || 0,
      },
      requests: (data.requests || {}).count || 0,
    };
  }

  return { total, perModel, models, missingPricing };
}

/**
 * High-level convenience: parse events.jsonl + compute multi-model cost in one call.
 *
 * @param {string} sessionId
 * @param {Object} pricingTable — full pricing table (all models)
 * @returns {{ total, perModel, models, missingPricing } | null} — null if no data
 */
function computeMultiModelCostForSession(sessionId, pricingTable) {
  const metrics = parseShutdownMetrics(sessionId);
  if (!metrics) return null;
  return computeMultiModelCost(metrics, pricingTable);
}

/**
 * Load the full pricing table (all models) from pricing.json.
 *
 * Searches:
 *   1. <dataDir>/pricing.json (user override)
 *   2. <scriptDir>/../pricing.json (bundled default)
 *
 * Returns { modelId: { input, output, cache_write, cache_read } }
 */
function loadPricingTable(dataDir, scriptDir) {
  const candidates = [
    dataDir   ? path.join(dataDir,   'pricing.json')       : '',
    scriptDir ? path.join(scriptDir, '..', 'pricing.json') : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const table = {};
      for (const [key, val] of Object.entries(data)) {
        if (!key.startsWith('_') && typeof val === 'object' && val !== null) {
          table[key] = val;
        }
      }
      return table;
    } catch (_) {}
  }
  return {};
}

module.exports = {
  getSessionStateDir,
  parseEventsFile,
  parseShutdownMetrics,
  parseShutdownEnriched,
  parseSubagentCompletions,
  parseCompactionCosts,
  computeMultiModelCost,
  computeMultiModelCostForSession,
  loadPricingTable,
};
